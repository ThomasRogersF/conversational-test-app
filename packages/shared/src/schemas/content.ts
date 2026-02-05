import { z } from 'zod';
import type { Timing } from './timing';

// ============================================================================
// Level Schema
// ============================================================================

export const LevelSchema = z.object({
    /** Unique identifier for the level (e.g., "A1", "A2", "B1") */
    id: z.string().min(1),
    /** Display name for the level */
    name: z.string().min(1),
    /** Brief description of the level's content and objectives */
    description: z.string().min(1),
    /** Order in which levels should be presented */
    order: z.number().int().positive(),
});

export type Level = z.infer<typeof LevelSchema>;

// ============================================================================
// Persona Schema
// ============================================================================

export const PersonaSchema = z.object({
    /** Unique identifier for the persona (e.g., "jorge", "valentina") */
    id: z.string().min(1),
    /** Display name for the persona */
    name: z.string().min(1),
    /** Role or occupation of the persona (e.g., "Taxi Driver", "Spanish Tutor") */
    role: z.string().min(1),
    /** Optional voice identifier for TTS integration */
    voiceId: z.string().optional(),
    /** Optional Inworld TTS voice ID override (used by worker when calling TTS API) */
    ttsVoiceId: z.string().optional(),
    /** System instructions that define the persona's behavior and speaking style */
    instructions: z.string().min(1),
});

export type Persona = z.infer<typeof PersonaSchema>;

// ============================================================================
// Quiz Schema
// ============================================================================

export const QuizItemSchema = z.object({
    /** The question to ask */
    question: z.string().min(1),
    /** Available answer options */
    options: z.array(z.string().min(1)).min(2),
    /** Index of the correct answer (0-based) */
    correctIndex: z.number().int().min(0),
    /** Optional explanation shown after answering */
    explanation: z.string().optional(),
});

export type QuizItem = z.infer<typeof QuizItemSchema>;

export const QuizSchema = z.object({
    /** Unique identifier for the quiz */
    id: z.string().min(1),
    /** ID of the scenario this quiz belongs to (optional, for documentation) */
    scenarioId: z.string().optional(),
    /** Quiz questions */
    items: z.array(QuizItemSchema).min(1),
});

export type Quiz = z.infer<typeof QuizSchema>;

// ============================================================================
// Scenario Schema
// ============================================================================

export const ScenarioSchema = z.object({
    /** Unique identifier for the scenario */
    id: z.string().min(1),
    /** Reference to the level this scenario belongs to */
    levelId: z.string().min(1),
    /** Display title for the scenario */
    title: z.string().min(1),
    /** Brief description of the scenario */
    description: z.string().min(1),
    /** Reference to the persona for this scenario */
    personaId: z.string().min(1),
    /** Optional tags for categorization */
    tags: z.array(z.string()).default([]),
    /** Learning goals for this scenario */
    learningGoals: z.array(z.string().min(1)).min(1),
    /** Initial message the persona says when scenario starts */
    initialMessage: z.string().min(1),
    /** Conditions that determine scenario success (data-only text) */
    successConditions: z.array(z.string().min(1)).min(1),
    /** Rules governing the conversation (data-only text) */
    conversationRules: z.array(z.string().min(1)).min(1),
    /** Optional reference to a quiz to take after completing the scenario */
    postQuizId: z.string().optional(),
});

export type Scenario = z.infer<typeof ScenarioSchema>;

// ============================================================================
// Content Pack Schema (Cross-Reference Validation)
// ============================================================================

/**
 * Validates that all cross-references in the content pack are valid.
 * - scenario.levelId must reference an existing level
 * - scenario.personaId must reference an existing persona
 * - scenario.postQuizId (if provided) must reference an existing quiz
 */
export function createContentPackSchema() {
    return z.object({
        levels: z.array(LevelSchema),
        personas: z.array(PersonaSchema),
        scenarios: z.array(ScenarioSchema),
        quizzes: z.array(QuizSchema),
    }).superRefine((data, ctx) => {
        // Create sets for faster lookup
        const levelIds = new Set(data.levels.map((l) => l.id));
        const personaIds = new Set(data.personas.map((p) => p.id));
        const quizIds = new Set(data.quizzes.map((q) => q.id));

        // Validate scenario cross-references
        data.scenarios.forEach((scenario, index) => {
            // Validate levelId
            if (!levelIds.has(scenario.levelId)) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: `Scenario "${scenario.id}" references non-existent levelId "${scenario.levelId}"`,
                    path: ['scenarios', index, 'levelId'],
                });
            }

            // Validate personaId
            if (!personaIds.has(scenario.personaId)) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: `Scenario "${scenario.id}" references non-existent personaId "${scenario.personaId}"`,
                    path: ['scenarios', index, 'personaId'],
                });
            }

            // Validate postQuizId (if provided)
            if (scenario.postQuizId && !quizIds.has(scenario.postQuizId)) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: `Scenario "${scenario.id}" references non-existent postQuizId "${scenario.postQuizId}"`,
                    path: ['scenarios', index, 'postQuizId'],
                });
            }
        });
    });
}

export type ContentPack = z.infer<ReturnType<typeof createContentPackSchema>>;

// ============================================================================
// Tool Schemas (Server-Authoritative Tool Calling)
// ============================================================================

/**
 * Union of all available tool names
 */
export const ToolNameSchema = z.enum([
    'start_quiz',
    'grade_quiz',
    'get_hint',
    'log_mistake',
    'mark_complete',
]);

export type ToolName = z.infer<typeof ToolNameSchema>;

/**
 * Arguments for start_quiz tool
 */
export const StartQuizArgsSchema = z.object({
    /** The quiz ID to start */
    quizId: z.string().min(1),
});

export type StartQuizArgs = z.infer<typeof StartQuizArgsSchema>;

/**
 * Arguments for grade_quiz tool
 */
export const GradeQuizArgsSchema = z.object({
    /** The quiz ID being graded */
    quizId: z.string().min(1),
    /** Array of answers indexed by question order (answers[i] = answer to question i, -1 for unanswered) */
    answers: z.array(z.number().int().min(-1)),
});

export type GradeQuizArgs = z.infer<typeof GradeQuizArgsSchema>;

/**
 * Arguments for get_hint tool
 */
export const GetHintArgsSchema = z.object({
    /** Optional topic to get a hint about */
    topic: z.string().optional(),
});

export type GetHintArgs = z.infer<typeof GetHintArgsSchema>;

/**
 * Arguments for log_mistake tool
 */
export const LogMistakeArgsSchema = z.object({
    /** The original incorrect input */
    original: z.string().min(1),
    /** The corrected version */
    corrected: z.string().min(1),
    /** Optional type of mistake (e.g., 'grammar', 'vocabulary') */
    type: z.string().optional(),
});

export type LogMistakeArgs = z.infer<typeof LogMistakeArgsSchema>;

/**
 * Arguments for mark_complete tool
 */
export const MarkCompleteArgsSchema = z.object({
    /** Summary of the lesson completion */
    summary: z.string().min(1),
});

export type MarkCompleteArgs = z.infer<typeof MarkCompleteArgsSchema>;

/**
 * Discriminated union of all possible tool calls.
 * Each tool has strictly validated arguments at schema level.
 */
export const ToolSchema = z.union([
    z.object({
        name: z.literal('start_quiz'),
        args: StartQuizArgsSchema,
    }),
    z.object({
        name: z.literal('grade_quiz'),
        args: GradeQuizArgsSchema,
    }),
    z.object({
        name: z.literal('get_hint'),
        args: GetHintArgsSchema,
    }),
    z.object({
        name: z.literal('log_mistake'),
        args: LogMistakeArgsSchema,
    }),
    z.object({
        name: z.literal('mark_complete'),
        args: MarkCompleteArgsSchema,
    }),
]);

export type Tool = z.infer<typeof ToolSchema>;

// ============================================================================
// Active Quiz State (used in SessionState)
// ============================================================================

export const ActiveQuizSchema = z.object({
    /** The quiz ID */
    quizId: z.string().min(1),
    /** When the quiz was started */
    startedAt: z.string().datetime(),
});

export type ActiveQuiz = z.infer<typeof ActiveQuizSchema>;

// ============================================================================
// Quiz Result State (used in SessionState)
// ============================================================================

export const QuizResultSchema = z.object({
    /** The quiz ID that was graded */
    quizId: z.string().min(1),
    /** Score as a percentage (0-100) */
    score: z.number().int().min(0).max(100),
    /** Total number of questions */
    total: z.number().int().positive(),
    /** Array of answers indexed by question order (-1 for unanswered) */
    answers: z.array(z.number().int().min(-1)),
    /** When the quiz was completed */
    completedAt: z.string().datetime(),
});

export type QuizResult = z.infer<typeof QuizResultSchema>;

// ============================================================================
// Session Completion State (used in SessionState)
// ============================================================================

export const SessionCompletionSchema = z.object({
    /** Summary of the lesson completion */
    summary: z.string().min(1),
    /** When the session was completed */
    completedAt: z.string().datetime(),
});

export type SessionCompletion = z.infer<typeof SessionCompletionSchema>;

// ============================================================================
// Pending Retry Schema
// ============================================================================

export const PendingRetrySchema = z.object({
    /** The expected correct response the user should provide */
    expected: z.string().min(1),
    /** Number of retry attempts made so far */
    attempts: z.number().int().nonnegative(),
});

export type PendingRetry = z.infer<typeof PendingRetrySchema>;

// ============================================================================
// Teacher Decision Schema
// ============================================================================

export const TeacherDecisionSchema = z.object({
    /** Feedback to provide to the student */
    feedback: z.string().min(1),
    /** Corrected version of the student's input (required if shouldRetry is true) */
    correction: z.string().optional(),
    /** Whether this was a mistake */
    isMistake: z.boolean(),
    /** Whether the student should retry */
    shouldRetry: z.boolean(),
    /** Next phase of the session */
    nextPhase: z.enum(['roleplay', 'quiz', 'completed']).optional(),
    /** Optional tool to invoke (server-authoritative) */
    tool: z.union([ToolSchema, z.null()]).optional(),
    /** Content of the reply to show to the user (REQUIRED - single source of truth for tutor text) */
    reply: z.string().min(1),
}).superRefine((data, ctx) => {
    // Invariant: if shouldRetry is true, correction must exist and be non-empty
    if (data.shouldRetry && (!data.correction || data.correction.trim().length === 0)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'correction is required when shouldRetry is true',
            path: ['correction'],
        });
    }
});

export type TeacherDecision = z.infer<typeof TeacherDecisionSchema>;

// ============================================================================
// API Response Types
// ============================================================================

export interface ApiResponse<T> {
    ok: true;
    data: T;
    timing?: Timing;
    requestId?: string;
}

export interface ApiError {
    ok: false;
    error: {
        message: string;
        details?: string;
    };
}

export function successResponse<T>(data: T, timing?: Timing, requestId?: string): ApiResponse<T> {
    return {
        ok: true,
        data,
        ...(timing && { timing }),
        ...(requestId && { requestId }),
    };
}

export function errorResponse(message: string, details?: string): ApiError {
    return {
        ok: false,
        error: {
            message,
            ...(details && { details }),
        },
    };
}
