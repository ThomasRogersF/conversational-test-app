import { z } from 'zod';

// ============================================================================
// Timing Metrics Schema
// ============================================================================

/**
 * Timing metrics schema (all fields optional for backward compatibility)
 */
export const TimingSchema = z.object({
    /** Speech-to-text transcription duration in milliseconds */
    sttMs: z.number().optional(),
    /** LLM teacher decision generation duration in milliseconds */
    llmMs: z.number().optional(),
    /** Tool execution duration in milliseconds */
    toolMs: z.number().optional(),
    /** TTS synthesis duration in milliseconds */
    ttsMs: z.number().optional(),
    /** Total request handler duration in milliseconds */
    totalMs: z.number().optional(),
});

export type Timing = z.infer<typeof TimingSchema>;

// ============================================================================
// Request Metadata Schema
// ============================================================================

/**
 * Request metadata schema for tracing
 */
export const RequestMetadataSchema = z.object({
    /** Unique request ID for tracing (UUID v4) */
    requestId: z.string().uuid().optional(),
    /** Timing metrics for the request */
    timing: TimingSchema.optional(),
});

export type RequestMetadata = z.infer<typeof RequestMetadataSchema>;
