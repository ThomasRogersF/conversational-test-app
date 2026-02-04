import type {
    SessionState,
    SessionPhase,
    TranscriptMessage,
    Mistake,
    Scenario,
    Persona,
    TeacherDecision,
    PendingRetry,
} from '@repo/shared';
import { getScenarioById, getPersonaById } from './content-loader';
import type { SessionStorage } from './sessions-durable-object';
import {
    generateTeacherDecision,
    createFallbackDecision,
    normalizeForExactMatch,
    isExactMatch,
    generateToolNarration,
} from './openai';
import { executeTool, applyToolResultToSession } from './tools';

// ============================================================================
// UUID Generation (using Web Crypto API for Cloudflare Workers)
// ============================================================================

function generateUUID(): string {
    return crypto.randomUUID();
}

// ============================================================================
// Timing Types
// ============================================================================

/**
 * Timing metrics returned from processTurn
 */
export interface ProcessTurnResult {
    /** The updated session state */
    session: SessionState;
    /** LLM teacher decision generation duration in milliseconds */
    llmMs: number;
    /** Tool execution duration in milliseconds (0 if no tool executed) */
    toolMs: number;
}

// ============================================================================
// Session Engine
// ============================================================================

/**
 * SessionEngine handles all session-related business logic.
 * For Phase 4, it integrates with OpenAI GPT-4o-mini for tutor decisions.
 */
export class SessionEngine {
    constructor(private readonly storage: SessionStorage) {}

    /**
     * Create a new session for a given scenario.
     */
    async createSession(levelId: string, scenarioId: string): Promise<SessionState> {
        // Validate scenario exists
        const scenario = getScenarioById(scenarioId);
        if (!scenario) {
            throw new Error(`Scenario not found: ${scenarioId}`);
        }

        // Validate scenario belongs to the requested level
        if (scenario.levelId !== levelId) {
            throw new Error(`Scenario "${scenarioId}" does not belong to level "${levelId}"`);
        }

        // Get persona for initial message
        const persona = getPersonaById(scenario.personaId);

        // Create the session
        const now = new Date().toISOString();
        const sessionId = generateUUID();

        const initialMessage: TranscriptMessage = {
            id: generateUUID(),
            role: 'tutor',
            text: scenario.initialMessage,
            ts: now,
        };

        const session: SessionState = {
            id: sessionId,
            createdAt: now,
            updatedAt: now,
            levelId,
            scenarioId,
            phase: 'roleplay',
            transcript: [initialMessage],
            turnCount: 0,
            mistakes: [],
            postQuizId: scenario.postQuizId,
            pendingRetry: undefined,
            lastDecision: undefined,
        };

        // Store the session
        await this.storage.create(session);

        console.log(`[SessionEngine] Created session ${sessionId} for scenario ${scenarioId}`);

        return session;
    }

    /**
     * Process a user turn and generate a tutor response.
     * Handles retry gating with exact-match normalization.
     * Returns timing metrics for observability.
     */
    async processTurn(sessionId: string, userText: string): Promise<ProcessTurnResult> {
        // Load the session
        let session = await this.storage.load(sessionId);
        if (!session) {
            throw new Error(`Session not found: ${sessionId}`);
        }

        // Validate session is in roleplay phase
        if (session.phase !== 'roleplay') {
            throw new Error(`Cannot process turn in ${session.phase} phase`);
        }

        // Get scenario and persona
        const scenario = getScenarioById(session.scenarioId);
        if (!scenario) {
            throw new Error(`Scenario not found: ${session.scenarioId}`);
        }
        const persona = getPersonaById(scenario.personaId);
        if (!persona) {
            throw new Error(`Persona not found: ${scenario.personaId}`);
        }

        const now = new Date().toISOString();

        // Add user message to transcript
        const userMessage: TranscriptMessage = {
            id: generateUUID(),
            role: 'user',
            text: userText,
            ts: now,
        };

        // Check for pending retry
        let pendingRetry = session.pendingRetry;
        let tutorReply: string;
        let decision: TeacherDecision | undefined;

        if (pendingRetry && typeof pendingRetry === 'object') {
            // There's a pending retry - check if user succeeded
            const retrySuccess = isExactMatch(userText, pendingRetry.expected);

            if (retrySuccess) {
                // Success! Clear pending retry and continue to OpenAI generation
                console.log(`[SessionEngine] Retry success for session ${sessionId}: "${userText}"`);
                pendingRetry = undefined;
            } else {
                // Still failed - increment attempts
                const newAttempts = pendingRetry.attempts + 1;

                if (newAttempts >= 3) {
                    // After 3 failures, continue to OpenAI for a stronger hint
                    console.log(`[SessionEngine] Max retries (3) reached for session ${sessionId}, continuing to OpenAI`);
                    pendingRetry = { expected: pendingRetry.expected, attempts: newAttempts };
                } else {
                    // Generate local retry message (no OpenAI call)
                    const retryMessage = this.generateRetryMessage(
                        pendingRetry.expected,
                        newAttempts,
                        persona
                    );

                    const tutorMessage: TranscriptMessage = {
                        id: generateUUID(),
                        role: 'tutor',
                        text: retryMessage,
                        ts: new Date().toISOString(),
                    };

                    const updatedSession: SessionState = {
                        ...session,
                        updatedAt: new Date().toISOString(),
                        transcript: [...session.transcript, userMessage, tutorMessage],
                        turnCount: session.turnCount + 1,
                        pendingRetry: { expected: pendingRetry.expected, attempts: newAttempts },
                    };

                    // Save and return without calling OpenAI
                    await this.storage.save(updatedSession);
                    console.log(`[SessionEngine] Retry attempt ${newAttempts} for session ${sessionId}`);

                    // Return with zero LLM and tool time since we didn't call them
                    return {
                        session: updatedSession,
                        llmMs: 0,
                        toolMs: 0,
                    };
                }
            }
        }

        // Generate teacher decision using OpenAI (measure LLM time)
        const llmStart = performance.now();
        try {
            const transcriptForApi = session.transcript.map((msg) => ({
                role: msg.role,
                text: msg.text,
            }));

            decision = await generateTeacherDecision({
                transcript: [...transcriptForApi, { role: 'user', text: userText }],
                scenario: {
                    id: scenario.id,
                    title: scenario.title,
                    learningGoals: scenario.learningGoals,
                    conversationRules: scenario.conversationRules,
                    successConditions: scenario.successConditions,
                    tags: scenario.tags,
                },
                persona: {
                    id: persona.id,
                    name: persona.name,
                    role: persona.role,
                    instructions: persona.instructions,
                },
            });
        } catch (error) {
            const llmEnd = performance.now();
            console.error(`[SessionEngine] OpenAI error for session ${sessionId}:`, error);

            // Use fallback decision
            decision = createFallbackDecision();
            console.log(`[SessionEngine] Using fallback decision for session ${sessionId}`);
        }
        const llmEnd = performance.now();
        const llmMs = Math.round(llmEnd - llmStart);

        // Handle tool execution if present (measure tool time)
        const toolStart = performance.now();
        let finalDecision = decision;
        let toolExecutedThisTurn = false;

        if (decision.tool !== null && decision.tool !== undefined) {
            // EXECUTE TOOL (max 1 tool per user turn - enforced by single execution here)
            console.log(`[SessionEngine] Executing tool: ${decision.tool.name}`);

            try {
                const toolResult = await executeTool({
                    tool: decision.tool,
                    session,
                });

                console.log(`[SessionEngine] Tool result: ${toolResult.resultData.success ? 'SUCCESS' : 'FAILURE'} - ${toolResult.resultData.message}`);

                // Apply tool result to session state
                session = applyToolResultToSession(session, toolResult.toolName, toolResult.resultData);
                toolExecutedThisTurn = true;

                // For major tools, optionally narrate the result
                const narrationTools = ['start_quiz', 'grade_quiz', 'mark_complete'];
                if (narrationTools.includes(toolResult.toolName) && toolResult.resultData.success) {
                    try {
                        const narration = await generateToolNarration({
                            toolName: toolResult.toolName,
                            toolResult: toolResult.resultData,
                            scenario: {
                                id: scenario.id,
                                title: scenario.title,
                                learningGoals: scenario.learningGoals,
                                conversationRules: scenario.conversationRules,
                                successConditions: scenario.successConditions,
                                tags: scenario.tags,
                            },
                            persona: {
                                id: persona.id,
                                name: persona.name,
                                role: persona.role,
                                instructions: persona.instructions,
                            },
                        });

                        // Use narration as the tutor message
                        tutorReply = narration;

                        // Final decision with narration and tool: null to prevent loops
                        finalDecision = {
                            ...decision,
                            reply: tutorReply,
                            tool: null,
                        };

                        console.log(`[SessionEngine] Generated tool narration: "${tutorReply}"`);
                    } catch (narrationError) {
                        console.error(`[SessionEngine] Failed to generate narration:`, narrationError);
                        // Fall back to tool result message
                        tutorReply = toolResult.resultData.message;
                        finalDecision = {
                            ...decision,
                            reply: tutorReply,
                            tool: null,
                        };
                    }
                } else {
                    // For non-narration tools, append tool result as reply
                    tutorReply = toolResult.resultData.message;
                    finalDecision = {
                        ...decision,
                        reply: tutorReply,
                        tool: null,
                    };
                }
            } catch (toolError) {
                console.error(`[SessionEngine] Tool execution failed:`, toolError);
                // Continue without tool - use decision.reply
                tutorReply = decision.reply;
                finalDecision = decision;
            }
        } else {
            // No tool - use decision.reply as normal
            tutorReply = decision.reply;
        }
        const toolEnd = performance.now();
        const toolMs = Math.round(toolEnd - toolStart);

        const tutorMessage: TranscriptMessage = {
            id: generateUUID(),
            role: 'tutor',
            text: tutorReply,
            ts: new Date().toISOString(),
        };

        // Update pendingRetry based on decision
        let newPendingRetry: PendingRetry | undefined;
        if (finalDecision.shouldRetry && finalDecision.correction) {
            newPendingRetry = { expected: finalDecision.correction, attempts: 0 };
        }

        // Build updated session
        const updatedSession: SessionState = {
            ...session,
            updatedAt: new Date().toISOString(),
            transcript: [...session.transcript, userMessage, tutorMessage],
            turnCount: session.turnCount + 1,
            pendingRetry: newPendingRetry,
            lastDecision: finalDecision,
        };

        // Save the updated session
        await this.storage.save(updatedSession);

        console.log(`[SessionEngine] Processed turn ${updatedSession.turnCount} for session ${sessionId}, llmMs=${llmMs}, toolMs=${toolMs}, tool=${toolExecutedThisTurn}, retry=${!!newPendingRetry}`);

        return {
            session: updatedSession,
            llmMs,
            toolMs,
        };
    }

    /**
     * Generate a retry message based on attempt count.
     * Uses persona style for consistency.
     */
    private generateRetryMessage(expected: string, attempts: number, persona: Persona): string {
        const normalizedExpected = normalizeForExactMatch(expected);

        // Persona-specific retry messages
        switch (persona.id) {
            case 'jorge':
                if (attempts <= 2) {
                    return `(Jorge) Atrévete a intentarlo de nuevo: "${normalizedExpected}"`;
                } else {
                    return `(Jorge) ¡Vamos, tú puedes! La respuesta correcta es "${normalizedExpected}". ¡Inténtalo de nuevo!`;
                }

            case 'valentina':
                if (attempts <= 2) {
                    return `(Valentina) Casi lo tienes. Recuerda: "${normalizedExpected}". ¿Puedes intentarlo otra vez?`;
                } else {
                    return `(Valentina) ¡No te rindas! La frase correcta es "${normalizedExpected}". ¡Tú puedes!`;
                }

            default:
                if (attempts <= 2) {
                    return `Intenta de nuevo: "${normalizedExpected}"`;
                } else {
                    return `La respuesta correcta es "${normalizedExpected}". Por favor, inténtalo de nuevo.`;
                }
        }
    }

    /**
     * End a session and return the summary.
     */
    async endSession(sessionId: string): Promise<{ session: SessionState; summary: { turns: number; hasQuiz: boolean; quizId?: string } }> {
        // Load the session
        const session = await this.storage.load(sessionId);
        if (!session) {
            throw new Error(`Session not found: ${sessionId}`);
        }

        // Mark session as completed
        const completedSession: SessionState = {
            ...session,
            updatedAt: new Date().toISOString(),
            phase: 'completed',
        };

        // Save the updated session
        await this.storage.save(completedSession);

        // Generate summary
        const summary = {
            turns: session.turnCount,
            hasQuiz: !!session.postQuizId,
            quizId: session.postQuizId,
        };

        console.log(`[SessionEngine] Ended session ${sessionId} with ${summary.turns} turns`);

        return { session: completedSession, summary };
    }

    /**
     * Get a session by ID.
     */
    async getSession(sessionId: string): Promise<SessionState | null> {
        return this.storage.load(sessionId);
    }
}

// ============================================================================
// Session Summary
// ============================================================================

export interface SessionSummary {
    turns: number;
    hasQuiz: boolean;
    quizId?: string;
}
