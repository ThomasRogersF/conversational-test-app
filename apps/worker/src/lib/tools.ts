import {
    type SessionState,
    type Quiz,
    type Tool,
    type ToolName,
    type ActiveQuiz,
    type QuizResult,
    type SessionCompletion,
    type Mistake,
    successResponse,
    errorResponse,
} from '@repo/shared';
import { getQuizById } from './content-loader';

// ============================================================================
// Tool Result Types
// ============================================================================

export interface ToolResult {
    toolName: ToolName;
    resultData: {
        success: boolean;
        message: string;
        data?: Record<string, unknown>;
    };
}

// ============================================================================
// Tool Executor
// ============================================================================

export async function executeTool(params: {
    tool: Tool;
    session: SessionState;
    contentPack?: {
        levels: unknown[];
        personas: unknown[];
        scenarios: unknown[];
        quizzes: Quiz[];
    };
}): Promise<ToolResult> {
    const { tool, session } = params;
    const now = new Date().toISOString();

    switch (tool.name) {
        case 'start_quiz': {
            const { quizId } = tool.args;

            // Verify quiz exists
            const quiz = getQuizById(quizId);
            if (!quiz) {
                return {
                    toolName: 'start_quiz',
                    resultData: {
                        success: false,
                        message: `Quiz not found: ${quizId}`,
                    },
                };
            }

            // Build active quiz state
            const activeQuiz: ActiveQuiz = {
                quizId,
                startedAt: now,
            };

            return {
                toolName: 'start_quiz',
                resultData: {
                    success: true,
                    message: `Quiz "${quizId}" started with ${quiz.items.length} questions`,
                    data: { activeQuiz },
                },
            };
        }

        case 'grade_quiz': {
            const { quizId, answers } = tool.args;

            // Verify quiz exists
            const quiz = getQuizById(quizId);
            if (!quiz) {
                return {
                    toolName: 'grade_quiz',
                    resultData: {
                        success: false,
                        message: `Quiz not found: ${quizId}`,
                    },
                };
            }

            // Validate answers length
            if (answers.length !== quiz.items.length) {
                return {
                    toolName: 'grade_quiz',
                    resultData: {
                        success: false,
                        message: `Expected ${quiz.items.length} answers, got ${answers.length}`,
                    },
                };
            }

            // Validate each answer is in valid range
            for (let i = 0; i < answers.length; i++) {
                const answer = answers[i];
                const numOptions = quiz.items[i].options.length;
                if (answer !== -1 && (answer < 0 || answer >= numOptions)) {
                    return {
                        toolName: 'grade_quiz',
                        resultData: {
                            success: false,
                            message: `Answer ${i} (${answer}) is out of range [0, ${numOptions - 1}]`,
                        },
                    };
                }
            }

            // Calculate score
            let correctCount = 0;
            for (let i = 0; i < answers.length; i++) {
                if (answers[i] === quiz.items[i].correctIndex) {
                    correctCount++;
                }
            }

            const score = Math.round((correctCount / quiz.items.length) * 100);

            // Build quiz result
            const quizResult: QuizResult = {
                quizId,
                score,
                total: quiz.items.length,
                answers,
                completedAt: now,
            };

            return {
                toolName: 'grade_quiz',
                resultData: {
                    success: true,
                    message: `Quiz graded: ${correctCount}/${quiz.items.length} correct (${score}%)`,
                    data: { quizResult },
                },
            };
        }

        case 'get_hint': {
            // Return a short hint derived from scenario learningGoals/rules
            // No OpenAI call - server-side derived hint
            const { topic } = tool.args;

            // Basic hints based on common topics
            const hintTemplates: Record<string, string> = {
                greeting: 'Try greeting first with "Hola" or "¿Cómo estás?"',
                polite: 'Use "Por favor" and "Gracias" to be polite',
                directions: 'Ask "¿Dónde está...?" for locations',
                numbers: 'Remember numbers 1-10: uno, dos, tres, cuatro, cinco...',
                time: 'Ask "¿Qué hora es?" to ask for the time',
                food: 'Use "Me gustaria..." to order food',
            };

            const lowerTopic = topic?.toLowerCase() || '';
            let hint = hintTemplates[lowerTopic] ||
                'Review the learning goals and try using the vocabulary from this lesson.';

            // Try to find matching rule for dynamic hint
            if (!topic && session.lastDecision) {
                // Could derive hint from scenario context here
                hint = 'Remember to use the vocabulary and phrases from the learning goals!';
            }

            return {
                toolName: 'get_hint',
                resultData: {
                    success: true,
                    message: hint,
                },
            };
        }

        case 'log_mistake': {
            const { original, corrected, type } = tool.args;

            const mistake: Mistake = {
                id: crypto.randomUUID(),
                type: type || 'general',
                original,
                corrected,
                ts: now,
            };

            return {
                toolName: 'log_mistake',
                resultData: {
                    success: true,
                    message: `Logged mistake: "${original}" → "${corrected}"`,
                    data: { mistake },
                },
            };
        }

        case 'mark_complete': {
            const { summary } = tool.args;

            // Build completion
            const completion: SessionCompletion = {
                summary,
                completedAt: now,
            };

            return {
                toolName: 'mark_complete',
                resultData: {
                    success: true,
                    message: 'Session marked as completed',
                    data: { completion },
                },
            };
        }

        // All tool cases are covered above - exhaustive switch
        return {
            toolName: tool.name,
            resultData: {
                success: false,
                message: `Unreachable: unknown tool type`,
            },
        };
    }
}

// ============================================================================
// Helper to update session with tool result
// ============================================================================

export function applyToolResultToSession(
    session: SessionState,
    toolName: ToolName,
    resultData: ToolResult['resultData']
): SessionState {
    const now = new Date().toISOString();

    const updatedSession: SessionState = {
        ...session,
        updatedAt: now,
    };

    if (!resultData.success) {
        // For failed tools, just update timestamp
        return updatedSession;
    }

    switch (toolName) {
        case 'start_quiz':
            updatedSession.phase = 'quiz';
            updatedSession.activeQuiz = resultData.data?.activeQuiz as ActiveQuiz | undefined;
            break;

        case 'grade_quiz':
            updatedSession.quizResult = resultData.data?.quizResult as QuizResult | undefined;
            // Keep phase as 'quiz' - completion is done via mark_complete
            break;

        case 'log_mistake':
            updatedSession.mistakes = [
                ...session.mistakes,
                resultData.data?.mistake as Mistake,
            ];
            break;

        case 'mark_complete':
            updatedSession.phase = 'completed';
            updatedSession.completion = resultData.data?.completion as SessionCompletion | undefined;
            break;

        case 'get_hint':
            // No state change for hints
            break;
    }

    return updatedSession;
}
