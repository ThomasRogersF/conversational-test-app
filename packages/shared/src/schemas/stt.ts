import { z } from 'zod';
import { TimingSchema } from './timing';

// ============================================================================
// STT (Speech-to-Text) Types
// ============================================================================

/**
 * Request to transcribe audio
 */
export const SttTranscribeRequestSchema = z.object({
    /** Optional language hint (e.g., 'es' for Spanish) */
    language: z.string().optional(),
    /** Optional session ID for logging/tracking */
    sessionId: z.string().optional(),
});

export type SttTranscribeRequest = z.infer<typeof SttTranscribeRequestSchema>;

/**
 * Response from transcription
 */
export const SttTranscribeResponseSchema = z.object({
    /** Transcription result */
    text: z.string(),
    /** Unique request ID for tracing (UUID v4) */
    requestId: z.string().uuid().optional(),
    /** Timing metrics for the request */
    timing: TimingSchema.optional(),
});

export type SttTranscribeResponse = z.infer<typeof SttTranscribeResponseSchema>;
