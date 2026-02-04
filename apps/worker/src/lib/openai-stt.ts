import { successResponse, errorResponse } from '@repo/shared';

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_STT_MODEL = 'gpt-4o-mini-transcribe';
const MAX_AUDIO_SIZE_MB = 10;
const MAX_AUDIO_SIZE_BYTES = MAX_AUDIO_SIZE_MB * 1024 * 1024;

// Supported audio MIME types for transcription
const SUPPORTED_AUDIO_TYPES = [
    'audio/webm',
    'audio/wav',
    'audio/mp3',
    'audio/mpeg',
    'audio/mp4',
    'audio/m4a',
    'audio/aac',
    'audio/ogg',
    'audio/opus',
];

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
// Types
// ============================================================================

export interface TranscribeAudioParams {
    /** Audio data as ArrayBuffer */
    audioBytes: ArrayBuffer;
    /** MIME type of the audio */
    mimeType: string;
    /** Optional filename for the audio file */
    filename?: string;
    /** Optional language hint (ISO 639-1 code like 'es' for Spanish) */
    language?: string;
}

export interface TranscribeAudioResult {
    /** Transcribed text */
    text: string;
}

/** OpenAI transcription API response type */
interface OpenAITranscriptionResponse {
    text?: unknown;
    error?: {
        message?: string;
    };
}

// ============================================================================
// Audio Type Validation
// ============================================================================

/**
 * Check if the MIME type is supported for transcription
 */
function isSupportedAudioType(mimeType: string): boolean {
    return SUPPORTED_AUDIO_TYPES.some((supported) =>
        mimeType.toLowerCase().startsWith(supported)
    );
}

/**
 * Get a user-friendly error message for unsupported audio types
 */
function getSupportedTypesMessage(): string {
    return `Supported formats: ${SUPPORTED_AUDIO_TYPES.map((t) => t.replace('audio/', '')).join(', ')}`;
}

// ============================================================================
// OpenAI Transcription API
// ============================================================================

/**
 * Transcribe audio using OpenAI's transcription API
 *
 * @param params - Audio transcription parameters
 * @returns Transcription result with the transcribed text
 * @throws If API key is missing, audio is invalid, or transcription fails
 */
export async function transcribeAudio(params: TranscribeAudioParams): Promise<TranscribeAudioResult> {
    const { audioBytes, mimeType, filename, language } = params;

    // Validate audio type
    if (!isSupportedAudioType(mimeType)) {
        throw new Error(`Unsupported audio format: ${mimeType}. ${getSupportedTypesMessage()}`);
    }

    // Get API key from environment
    const apiKey = (globalThis as unknown as { OPENAI_API_KEY?: string }).OPENAI_API_KEY;
    if (!apiKey) {
        throw new Error('OPENAI_API_KEY environment variable is not set');
    }

    // Get model from environment, default to gpt-4o-mini-transcribe
    const model = (globalThis as unknown as { OPENAI_STT_MODEL?: string }).OPENAI_STT_MODEL || DEFAULT_STT_MODEL;

    // Create FormData for multipart request
    const formData = new FormData();

    // Create a Blob from the audio bytes
    const audioBlob = new Blob([audioBytes], { type: mimeType });
    formData.append('file', audioBlob, filename || 'audio.webm');

    // Set model
    formData.append('model', model);

    // Add language hint if provided (OpenAI expects ISO-639-1 code like 'en', 'es', etc.)
    if (language) {
        // Only include language if it's a valid-looking language code
        if (/^[a-z]{2}$/i.test(language)) {
            formData.append('language', language.toLowerCase());
        }
    }

    // Optional: Add response format for better reliability
    formData.append('response_format', 'json');

    try {
        const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                // Don't set Content-Type header - let the browser set it with the boundary
            },
            body: formData,
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({})) as OpenAITranscriptionResponse;
            
            if (response.status === 401) {
                throw new Error('OpenAI API authentication failed. Please check your API key.');
            }
            
            if (response.status === 429) {
                throw new Error('OpenAI API rate limit exceeded. Please try again later.');
            }

            const errorMessage = errorData.error?.message || `OpenAI API error: ${response.status}`;
            throw new Error(errorMessage);
        }

        const result: OpenAITranscriptionResponse = await response.json();

        // OpenAI transcription response format:
        // { "text": "transcribed text here" }
        if (!result.text || typeof result.text !== 'string') {
            throw new Error('Invalid response from OpenAI transcription API');
        }

        return {
            text: result.text.trim(),
        };
    } catch (error) {
        // Re-throw with context if it's not already a typed error
        if (error instanceof Error) {
            throw error;
        }
        throw new Error(`Transcription failed: ${String(error)}`);
    }
}

// ============================================================================
// HTTP Handler for /api/stt/transcribe
// ============================================================================

/**
 * Maximum allowed audio size (10MB)
 */
export const MAX_AUDIO_SIZE = MAX_AUDIO_SIZE_BYTES;

/**
 * Parse multipart form data and extract audio file
 * 
 * Note: In Cloudflare Workers, we need to handle multipart parsing manually
 * since the Request.formData() method is available.
 */
export async function handleSttTranscribe(request: Request): Promise<Response> {
    const requestId = generateRequestId();
    const startTime = performance.now();

    // Only accept POST requests
    if (request.method !== 'POST') {
        return new Response(
            JSON.stringify(errorResponse('Method not allowed', 'Only POST is supported for transcription')),
            {
                status: 405,
                headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId },
            }
        );
    }

    try {
        // Parse multipart form data
        const formData = await request.formData();

        // Get audio file
        const audioValue = formData.get('audio');
        if (!audioValue) {
            return new Response(
                JSON.stringify(errorResponse('Missing audio file', 'Please provide an audio recording')),
                {
                    status: 400,
                    headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId },
                }
            );
        }

        // Cast to Blob since formData values from file inputs are always Blob-like
        const audioFile = audioValue as unknown as { size: number; type: string; arrayBuffer: () => Promise<ArrayBuffer> };

        // Check file size
        const audioSize = audioFile.size;
        if (audioSize > MAX_AUDIO_SIZE) {
            return new Response(
                JSON.stringify(errorResponse('Audio file too large', `Maximum size is ${MAX_AUDIO_SIZE_MB}MB`)),
                {
                    status: 413,
                    headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId },
                }
            );
        }

        // Get optional language parameter
        const language = formData.get('language')?.toString() || undefined;

        // Get optional session ID (for logging/tracking)
        const sessionId = formData.get('sessionId')?.toString() || undefined;

        // Get filename if available
        const filename = formData.get('filename')?.toString() || undefined;

        // Validate audio type
        const mimeType = audioFile.type || 'audio/webm';
        if (!isSupportedAudioType(mimeType)) {
            return new Response(
                JSON.stringify(errorResponse('Unsupported audio format', getSupportedTypesMessage())),
                {
                    status: 400,
                    headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId },
                }
            );
        }

        // Get audio bytes
        const audioBytes = await audioFile.arrayBuffer();

        // Perform transcription with timing
        const sttStart = performance.now();
        const result = await transcribeAudio({
            audioBytes,
            mimeType,
            filename,
            language,
        });
        const sttEnd = performance.now();

        const sttMs = Math.round(sttEnd - sttStart);
        const totalMs = Math.round(performance.now() - startTime);

        // Log session ID if provided (for debugging/tracking)
        if (sessionId) {
            console.log(`[STT] Transcription completed for session ${sessionId} requestId=${requestId} sttMs=${sttMs} totalMs=${totalMs}`);
        } else {
            console.log(`[STT] Transcription completed requestId=${requestId} sttMs=${sttMs} totalMs=${totalMs}`);
        }

        // Return success response with the transcribed text and timing
        return new Response(
            JSON.stringify(successResponse({
                text: result.text,
                requestId,
                timing: {
                    sttMs,
                    totalMs,
                },
            })),
            {
                headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId },
            }
        );
    } catch (error) {
        const totalMs = Math.round(performance.now() - startTime);
        console.error(`[STT] Transcription error requestId=${requestId} error=${error} totalMs=${totalMs}`);

        // Return appropriate error response
        const errorMessage = error instanceof Error ? error.message : 'Transcription failed';
        return new Response(
            JSON.stringify(errorResponse('Transcription failed', errorMessage)),
            {
                status: 500,
                headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId },
            }
        );
    }
}
