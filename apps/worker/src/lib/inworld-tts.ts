// Inworld TTS Client
// Uses env bindings: INWORLD_API_KEY, INWORLD_TTS_VOICE

import { type TtsPayload } from '@repo/shared';

export type { TtsPayload };

// ============================================================================
// Environment Type (minimal subset needed by this module)
// ============================================================================

export interface InworldTtsEnv {
    INWORLD_API_KEY: string;
    INWORLD_TTS_VOICE?: string;
}

// ============================================================================
// Configuration Constants
// ============================================================================

/**
 * Maximum text length for TTS synthesis.
 * Prevents excessive API usage on very long responses.
 */
const TTS_MAX_TEXT_LENGTH = 1000;

/**
 * Timeout for TTS requests in milliseconds.
 */
const TTS_TIMEOUT_MS = 4000;

/**
 * Inworld TTS API endpoint (v1 voice synthesis).
 */
const INWORLD_TTS_URL = 'https://api.inworld.ai/tts/v1/voice';

/**
 * Default Inworld TTS model.
 */
const INWORLD_TTS_MODEL = 'inworld-tts-1.5-max';

// ============================================================================
// TTS Synthesis
// ============================================================================

/**
 * Synthesize speech from text using Inworld TTS API.
 *
 * @param params.text - The text to synthesize (max 1000 characters)
 * @param params.voiceId - Optional voice ID/name to use
 * @param params.env - Worker env bindings containing INWORLD_API_KEY
 * @returns TtsPayload with audioBase64 and mimeType, or null on failure
 */
export async function synthesizeSpeech({
    text,
    voiceId,
    env,
}: {
    text: string;
    voiceId?: string;
    env: InworldTtsEnv;
}): Promise<TtsPayload | null> {
    const apiKey = env.INWORLD_API_KEY?.trim();

    // Guardrail: Check if API key is configured
    if (!apiKey) {
        console.warn('[InworldTTS] INWORLD_API_KEY not configured, skipping TTS');
        return null;
    }

    // Guardrail: Check text length
    if (text.length > TTS_MAX_TEXT_LENGTH) {
        console.warn(
            `[InworldTTS] Text too long (${text.length} chars), max is ${TTS_MAX_TEXT_LENGTH}. Skipping TTS.`
        );
        return null;
    }

    // Guardrail: Check for empty text
    if (!text.trim()) {
        console.warn('[InworldTTS] Empty text provided, skipping TTS');
        return null;
    }

    // Determine voice: explicit arg > env binding > fallback
    const voice = voiceId || env.INWORLD_TTS_VOICE?.trim() || 'default';

    // Set up abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TTS_TIMEOUT_MS);

    try {
        const response = await fetch(INWORLD_TTS_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                text,
                voice,
                modelId: INWORLD_TTS_MODEL,
            }),
            signal: controller.signal,
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => 'unknown error');
            console.error(
                `[InworldTTS] API error: ${response.status} - ${errorText}`
            );
            return null;
        }

        // Get audio as array buffer
        const audioArrayBuffer = await response.arrayBuffer();

        // Convert to base64 in a Workers-compatible way
        const audioBase64 = arrayBufferToBase64(audioArrayBuffer);

        return {
            audioBase64,
            mimeType: 'audio/mp3',
        };
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            console.warn(`[InworldTTS] Request timed out after ${TTS_TIMEOUT_MS}ms`);
        } else {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.warn(`[InworldTTS] Failed to synthesize speech: ${errorMessage}`);
        }

        return null;
    } finally {
        clearTimeout(timeoutId);
    }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Convert an ArrayBuffer to a base64 string.
 * Uses globalThis.Buffer when available (Node-compat), otherwise falls back
 * to Uint8Array + btoa which works in all Workers runtimes.
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
    // Node.js Buffer compat (available when nodejs_compat flag is enabled)
    const g = globalThis as Record<string, unknown>;
    if (typeof g.Buffer === 'function') {
        return (g.Buffer as unknown as { from(b: ArrayBuffer): { toString(e: string): string } })
            .from(buffer)
            .toString('base64');
    }

    // Fallback: manual Uint8Array → binary string → btoa
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

/**
 * Check if Inworld TTS is configured and available.
 */
export function isTtsConfigured(env: InworldTtsEnv): boolean {
    const key = env.INWORLD_API_KEY?.trim();
    return typeof key === 'string' && key.length > 0;
}

/**
 * Get the configured voice ID or null if using default.
 */
export function getConfiguredVoice(env: InworldTtsEnv): string | null {
    const voice = env.INWORLD_TTS_VOICE?.trim();
    return voice && voice.length > 0 ? voice : null;
}
