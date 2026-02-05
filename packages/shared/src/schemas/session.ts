import { z } from 'zod';
import type {
    TeacherDecision,
    PendingRetry,
    Tool,
    ActiveQuiz,
    QuizResult,
    SessionCompletion,
} from './content';
import {
    TeacherDecisionSchema,
    PendingRetrySchema,
    ActiveQuizSchema,
    QuizResultSchema,
    SessionCompletionSchema,
} from './content';
import { TimingSchema } from './timing';

// ============================================================================
// Session Phase
// ============================================================================

export const SessionPhaseSchema = z.enum(['roleplay', 'quiz', 'completed']);

export type SessionPhase = z.infer<typeof SessionPhaseSchema>;

// ============================================================================
// Transcript Message
// ============================================================================

export const TranscriptMessageSchema = z.object({
    /** Unique message ID */
    id: z.string().uuid(),
    /** Role of the message sender */
    role: z.enum(['user', 'tutor']),
    /** Message content */
    text: z.string().min(1),
    /** ISO timestamp */
    ts: z.string().datetime(),
});

export type TranscriptMessage = z.infer<typeof TranscriptMessageSchema>;

// ============================================================================
// Mistake
// ============================================================================

export const MistakeSchema = z.object({
    /** Unique mistake ID */
    id: z.string().uuid(),
    /** Type of mistake (e.g., 'grammar', 'vocabulary', 'conjugation') */
    type: z.string().min(1),
    /** Original incorrect input */
    original: z.string().min(1),
    /** Corrected version (optional) */
    corrected: z.string().optional(),
    /** ISO timestamp */
    ts: z.string().datetime(),
});

export type Mistake = z.infer<typeof MistakeSchema>;

// ============================================================================

export const SessionStateSchema = z.object({
    /** Unique session ID */
    id: z.string().uuid(),
    /** ISO timestamp when session was created */
    createdAt: z.string().datetime(),
    /** ISO timestamp when session was last updated */
    updatedAt: z.string().datetime(),
    /** Level ID this session belongs to */
    levelId: z.string().min(1),
    /** Scenario ID this session is for */
    scenarioId: z.string().min(1),
    /** Current phase of the session */
    phase: SessionPhaseSchema,
    /** Conversation transcript */
    transcript: z.array(TranscriptMessageSchema),
    /** Number of conversation turns */
    turnCount: z.number().int().nonnegative(),
    /** Mistakes made during the session */
    mistakes: z.array(MistakeSchema),
    /** Optional quiz ID to take after completing roleplay */
    postQuizId: z.string().optional(),
    /** Pending retry state for correction gating */
    pendingRetry: z.union([
        PendingRetrySchema,
        z.literal(false),
    ]).optional(),
    /** Last teacher decision (optional, for debugging/analytics) */
    lastDecision: TeacherDecisionSchema.optional(),
    /** Currently active quiz (set when quiz is started via tool) */
    activeQuiz: ActiveQuizSchema.optional(),
    /** Quiz result after grading (set via tool or quiz submit endpoint) */
    quizResult: QuizResultSchema.optional(),
    /** Session completion data (set via mark_complete tool) */
    completion: SessionCompletionSchema.optional(),
});

export type SessionState = z.infer<typeof SessionStateSchema>;

// ============================================================================
// API Request/Response Types
// ============================================================================

// POST /api/session/start
export const StartSessionRequestSchema = z.object({
    levelId: z.string().min(1),
    scenarioId: z.string().min(1),
});

export type StartSessionRequest = z.infer<typeof StartSessionRequestSchema>;

export const StartSessionResponseSchema = z.object({
    sessionId: z.string().uuid(),
    session: SessionStateSchema,
});

export type StartSessionResponse = z.infer<typeof StartSessionResponseSchema>;

// ============================================================================
// TTS (Text-to-Speech) Types
// ============================================================================

export const TtsPayloadSchema = z.object({
    /** MIME type of the audio (e.g., 'audio/mp3', 'audio/wav') */
    mimeType: z.string().min(1),
    /** Base64-encoded audio data */
    audioBase64: z.string().min(1),
});

export type TtsPayload = z.infer<typeof TtsPayloadSchema>;

// ============================================================================
// POST /api/session/turn
// ============================================================================

export const TurnRequestSchema = z.object({
    sessionId: z.string().uuid(),
    userText: z.string().min(1),
    /** Enable TTS for tutor voice output (default: false for cost/safety) */
    ttsEnabled: z.boolean().optional().default(false),
});

export type TurnRequest = z.infer<typeof TurnRequestSchema>;

export const TurnResponseDataSchema = z.object({
    session: SessionStateSchema,
    /** Optional TTS audio payload (present if TTS succeeded and was enabled) */
    tts: TtsPayloadSchema.optional(),
});

export type TurnResponseData = z.infer<typeof TurnResponseDataSchema>;

/** @deprecated Use TurnResponseDataSchema — timing and requestId are now on the ApiResponse envelope */
export const TurnResponseSchema = TurnResponseDataSchema;
export type TurnResponse = TurnResponseData;

// POST /api/session/end
export const EndSessionRequestSchema = z.object({
    sessionId: z.string().uuid(),
});

export type EndSessionRequest = z.infer<typeof EndSessionRequestSchema>;

export const SessionSummarySchema = z.object({
    turns: z.number().int().nonnegative(),
    hasQuiz: z.boolean(),
    quizId: z.string().optional(),
});

export type SessionSummary = z.infer<typeof SessionSummarySchema>;

export const EndSessionResponseSchema = z.object({
    session: SessionStateSchema,
    summary: SessionSummarySchema,
});

export type EndSessionResponse = z.infer<typeof EndSessionResponseSchema>;

// GET /api/session/:id
export const GetSessionResponseSchema = z.object({
    session: SessionStateSchema,
});

export type GetSessionResponse = z.infer<typeof GetSessionResponseSchema>;

// ============================================================================
// Quiz Submit API Types
// ============================================================================

// POST /api/session/quiz/submit
export const QuizSubmitRequestSchema = z.object({
    /** The session ID */
    sessionId: z.string().uuid(),
    /** The quiz ID being submitted */
    quizId: z.string().min(1),
    /** Array of answers indexed by question order (answers[i] = answer to question i, -1 for unanswered) */
    answers: z.array(z.number().int().min(-1)),
});

export type QuizSubmitRequest = z.infer<typeof QuizSubmitRequestSchema>;

export const QuizSubmitResponseDataSchema = z.object({
    /** The graded quiz result */
    result: QuizResultSchema,
    /** The updated session state */
    session: SessionStateSchema,
});

export type QuizSubmitResponseData = z.infer<typeof QuizSubmitResponseDataSchema>;

export const QuizSubmitResponseSchema = z.object({
    ok: z.literal(true),
    data: QuizSubmitResponseDataSchema,
});

export type QuizSubmitResponse = z.infer<typeof QuizSubmitResponseSchema>;

// ============================================================================
// Session Storage Interface (for DO abstraction)
// ============================================================================

/**
 * Interface for session storage.
 * Allows swapping between in-memory, DO, KV, SQLite implementations.
 */
export interface SessionStorage {
    /** Create a new session */
    create(session: SessionState): Promise<void>;
    
    /** Load a session by ID */
    load(id: string): Promise<SessionState | null>;
    
    /** Save/update a session */
    save(session: SessionState): Promise<void>;
    
    /** Delete a session */
    delete(id: string): Promise<void>;
    
    /** List all sessions (optional, for debugging) */
    list(): Promise<SessionState[]>;
}
