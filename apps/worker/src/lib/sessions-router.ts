import {
    successResponse,
    errorResponse,
    QuizSubmitRequestSchema,
    type SessionState,
    type SessionSummary,
    type StartSessionRequest,
    type TurnRequest,
    type EndSessionRequest,
    type QuizSubmitRequest,
    type TtsPayload,
} from '@repo/shared';
import { SessionEngine, type ProcessTurnResult } from './session-engine';
import { InMemorySessionStorage } from './sessions-durable-object';
import { executeTool, applyToolResultToSession } from './tools';
import { synthesizeSpeech } from './inworld-tts';

// ============================================================================
// Request ID Generation
// ============================================================================

/**
 * Generate a UUID v4 for request tracking
 */
function generateRequestId(): string {
    return crypto.randomUUID();
}

// ============================================================================
// Session Router
// ============================================================================

/**
 * SessionRouter handles all session-related API routes.
 */
export class SessionRouter {
    private engine: SessionEngine;
    private storage: InMemorySessionStorage;

    constructor(storage?: InMemorySessionStorage) {
        // Use provided storage or default to in-memory
        this.storage = storage ?? new InMemorySessionStorage();
        this.engine = new SessionEngine(this.storage);
    }

    /**
     * Handle POST /api/session/start
     */
    async startSession(request: Request): Promise<Response> {
        try {
            const body = await request.json() as StartSessionRequest;

            // Validate request
            if (!body.levelId || !body.scenarioId) {
                return new Response(
                    JSON.stringify(errorResponse(
                        'Missing required fields',
                        'Both levelId and scenarioId are required'
                    )),
                    { status: 400, headers: { 'Content-Type': 'application/json' } }
                );
            }

            // Create session (kickoff uses deterministic initialMessage — no REST model call)
            const session = await this.engine.createSession(body.levelId, body.scenarioId);

            return new Response(
                JSON.stringify(successResponse({
                    sessionId: session.id,
                    session,
                })),
                { status: 201, headers: { 'Content-Type': 'application/json' } }
            );
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to create session';
            console.error(`[SessionRouter] Start session error: ${message}`);

            return new Response(
                JSON.stringify(errorResponse('Failed to create session', message)),
                { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
        }
    }

    /**
     * Handle POST /api/session/turn
     */
    async handleTurn(request: Request, env: { OPENAI_API_KEY: string; INWORLD_API_KEY: string; INWORLD_TTS_VOICE?: string }): Promise<Response> {
        const requestId = generateRequestId();
        const startTime = performance.now();

        try {
            const body = await request.json() as TurnRequest;

            // Validate request
            if (!body.sessionId || !body.userText) {
                return new Response(
                    JSON.stringify(errorResponse(
                        'Missing required fields',
                        'Both sessionId and userText are required'
                    )),
                    {
                        status: 400,
                        headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId },
                    }
                );
            }

            // Process turn (returns session and timing metrics)
            const turnResult: ProcessTurnResult = await this.engine.processTurn(body.sessionId, body.userText, env);
            const { session, llmMs, toolMs } = turnResult;

            // Build response data (session + tts only; timing/requestId go on the envelope)
            const responseData: {
                session: SessionState;
                tts?: TtsPayload;
            } = {
                session,
            };

            let ttsMs: number | undefined;

            // Synthesize TTS if enabled and tutor replied
            if (body.ttsEnabled && session.lastDecision?.reply) {
                const ttsStart = performance.now();
                try {
                    const tts = await synthesizeSpeech({
                        text: session.lastDecision.reply,
                        voiceId: undefined,
                        env,
                    });
                    if (tts) {
                        responseData.tts = tts;
                    }
                } catch (ttsError) {
                    // TTS is optional - log and continue without audio
                    const ttsMessage = ttsError instanceof Error ? ttsError.message : 'Unknown error';
                    console.warn(`[SessionRouter] TTS failed, continuing without audio: ${ttsMessage}`);
                }
                const ttsEnd = performance.now();
                ttsMs = Math.round(ttsEnd - ttsStart);
            }

            const totalMs = Math.round(performance.now() - startTime);

            const timing = {
                llmMs,
                toolMs,
                ttsMs,
                totalMs,
            };

            console.log(`[SessionRouter] Turn processed requestId=${requestId} llmMs=${llmMs} toolMs=${toolMs} ttsMs=${ttsMs ?? 'n/a'} totalMs=${totalMs}`);

            return new Response(
                JSON.stringify(successResponse(responseData, timing, requestId)),
                {
                    headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId },
                }
            );
        } catch (err) {
            const totalMs = Math.round(performance.now() - startTime);
            const message = err instanceof Error ? err.message : 'Failed to process turn';
            console.error(`[SessionRouter] Turn error requestId=${requestId} error=${message} totalMs=${totalMs}`);

            // Check if it's a "not found" error
            if (message.includes('not found')) {
                return new Response(
                    JSON.stringify(errorResponse('Session not found', message)),
                    {
                        status: 404,
                        headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId },
                    }
                );
            }

            return new Response(
                JSON.stringify(errorResponse('Failed to process turn', message)),
                {
                    status: 400,
                    headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId },
                }
            );
        }
    }

    /**
     * Handle POST /api/session/end
     */
    async endSession(request: Request): Promise<Response> {
        try {
            const body = await request.json() as EndSessionRequest;

            // Validate request
            if (!body.sessionId) {
                return new Response(
                    JSON.stringify(errorResponse(
                        'Missing required field',
                        'sessionId is required'
                    )),
                    { status: 400, headers: { 'Content-Type': 'application/json' } }
                );
            }

            // End session
            const { session, summary } = await this.engine.endSession(body.sessionId);

            return new Response(
                JSON.stringify(successResponse({ session, summary })),
                { headers: { 'Content-Type': 'application/json' } }
            );
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to end session';
            console.error(`[SessionRouter] End session error: ${message}`);

            if (message.includes('not found')) {
                return new Response(
                    JSON.stringify(errorResponse('Session not found', message)),
                    { status: 404, headers: { 'Content-Type': 'application/json' } }
                );
            }

            return new Response(
                JSON.stringify(errorResponse('Failed to end session', message)),
                { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
        }
    }

    /**
     * Handle GET /api/session/:id
     */
    async getSession(request: Request): Promise<Response> {
        try {
            const url = new URL(request.url);
            const sessionId = url.pathname.split('/').pop();

            if (!sessionId) {
                return new Response(
                    JSON.stringify(errorResponse('Missing session ID')),
                    { status: 400, headers: { 'Content-Type': 'application/json' } }
                );
            }

            // Get session
            const session = await this.engine.getSession(sessionId);

            if (!session) {
                return new Response(
                    JSON.stringify(errorResponse('Session not found', `No session found with id "${sessionId}"`)),
                    { status: 404, headers: { 'Content-Type': 'application/json' } }
                );
            }

            return new Response(
                JSON.stringify(successResponse({ session })),
                { headers: { 'Content-Type': 'application/json' } }
            );
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to get session';
            console.error(`[SessionRouter] Get session error: ${message}`);

            return new Response(
                JSON.stringify(errorResponse('Failed to get session', message)),
                { status: 500, headers: { 'Content-Type': 'application/json' } }
            );
        }
    }

    /**
     * Handle POST /api/session/quiz/submit
     * Server-authoritative quiz grading
     */
    async submitQuiz(request: Request): Promise<Response> {
        try {
            const body = await request.json();

            // Validate request
            const parseResult = QuizSubmitRequestSchema.safeParse(body);
            if (!parseResult.success) {
                return new Response(
                    JSON.stringify(errorResponse(
                        'Invalid request',
                        parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ')
                    )),
                    { status: 400, headers: { 'Content-Type': 'application/json' } }
                );
            }

            const { sessionId, quizId, answers } = parseResult.data;

            // Load session
            const session = await this.engine.getSession(sessionId);
            if (!session) {
                return new Response(
                    JSON.stringify(errorResponse('Session not found', `No session found with id "${sessionId}"`)),
                    { status: 404, headers: { 'Content-Type': 'application/json' } }
                );
            }

            // Verify quiz can be taken:
            // - session.activeQuiz.quizId matches OR
            // - session.postQuizId matches (for scenarios with post-quiz)
            // - session.phase must NOT be "completed"
            if (session.phase === 'completed') {
                return new Response(
                    JSON.stringify(errorResponse(
                        'Session already completed',
                        'Cannot submit quiz for a completed session'
                    )),
                    { status: 400, headers: { 'Content-Type': 'application/json' } }
                );
            }

            const validQuizId = session.activeQuiz?.quizId || session.postQuizId;
            if (!validQuizId || validQuizId !== quizId) {
                return new Response(
                    JSON.stringify(errorResponse(
                        'Invalid quiz',
                        `Quiz "${quizId}" is not active for this session`
                    )),
                    { status: 400, headers: { 'Content-Type': 'application/json' } }
                );
            }

            // Execute grade_quiz tool
            const toolResult = await executeTool({
                tool: {
                    name: 'grade_quiz',
                    args: { quizId, answers },
                },
                session,
            });

            if (!toolResult.resultData.success) {
                return new Response(
                    JSON.stringify(errorResponse('Failed to grade quiz', toolResult.resultData.message)),
                    { status: 400, headers: { 'Content-Type': 'application/json' } }
                );
            }

            // Apply result to session
            const updatedSession = applyToolResultToSession(
                session,
                'grade_quiz',
                toolResult.resultData
            );

            // Save session
            await this.storage.save(updatedSession);

            return new Response(
                JSON.stringify(successResponse({
                    result: toolResult.resultData.data!.quizResult,
                    session: updatedSession,
                })),
                { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to submit quiz';
            console.error(`[SessionRouter] Quiz submit error: ${message}`);

            return new Response(
                JSON.stringify(errorResponse('Failed to submit quiz', message)),
                { status: 500, headers: { 'Content-Type': 'application/json' } }
            );
        }
    }
}
