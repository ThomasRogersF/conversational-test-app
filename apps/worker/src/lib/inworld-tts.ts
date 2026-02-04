// Inworld TTS Client
// Uses environment variables: INWORLD_API_KEY, INWORLD_TTS_VOICE

// ============================================================================
// Environment Configuration
// ============================================================================

declare const INWORLD_API_KEY: string | undefined;
declare const INWORLD_TTS_VOICE: string | undefined;

/**
 * Get INWORLD_API_KEY from environment, safely handling Cloudflare Workers globals.
 */
function getInworldApiKey(): string | undefined {
    // @ts-ignore - INWORLD_API_KEY is injected by Cloudflare Workers
    const key = typeof INWORLD_API_KEY !== 'undefined' ? INWORLD_API_KEY : undefined;
    return typeof key === 'string' ? key.trim() : undefined;
}

/**
 * Get INWORLD_TTS_VOICE from environment, safely handling Cloudflare Workers globals.
 */
function getInworldTtsVoice(): string | undefined {
    // @ts-ignore - INWORLD_TTS_VOICE is injected by Cloudflare Workers
    const voice = typeof INWORLD_TTS_VOICE !== 'undefined' ? INWORLD_TTS_VOICE : undefined;
    return typeof voice === 'string' ? voice.trim() : undefined;
}

/**
 * TTS payload returned from successful synthesis.
 */
export interface TtsPayload {
    audioBase64: string;
    mimeType: string;
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
 * 4 seconds is a reasonable baseline for TTS.
 */
const TTS_TIMEOUT_MS = 4000;

/**
 * Inworld TTS API endpoint.
 */
const INWORLD_TTS_URL = 'https://api.inworld.ai/v1/tts';

// ============================================================================
// TTS Synthesis
// ============================================================================

/**
 * Synthesize speech from text using Inworld TTS API.
 * 
 * @param params - Parameters for speech synthesis
 * @param params.text - The text to synthesize (max 1000 characters)
 * @param params.voiceId - Optional voice ID/name to use
 * @returns TtsPayload with audioBase64 and mimeType, or null on failure
 */
export async function synthesizeSpeech({
    text,
    voiceId,
}: {
    text: string;
    voiceId?: string;
}): Promise<TtsPayload | null> {
    const apiKey = getInworldApiKey();

    // Guardrail: Check if API key is configured
    if (!apiKey) {
        console.warn('[InworldTTS] API key not configured, skipping TTS');
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

    // Determine voice to use
    const voice = voiceId || getInworldTtsVoice() || 'default';

    // Set up abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TTS_TIMEOUT_MS);

    try {
        const response = await fetch(INWORLD_TTS_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                text,
                voice,
                output_format: {
                    type: 'audio/mp3',
                },
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

        // Convert to base64 using Cloudflare Workers' Buffer
        // @ts-ignore - Buffer is available in Cloudflare Workers
        const audioBase64 = globalThis.Buffer
            ? // @ts-ignore
              globalThis.Buffer.from(audioArrayBuffer).toString('base64')
            : // Fallback using Uint8Array and btoa
              base64FromUint8Array(new Uint8Array(audioArrayBuffer));

        return {
            audioBase64,
            mimeType: 'audio/mp3',
        };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        
        // Check for timeout
        if (error instanceof Error && error.name === 'AbortError') {
            console.warn(`[InworldTTS] Request timed out after ${TTS_TIMEOUT_MS}ms`);
        } else {
            console.warn(`[InworldTTS] Failed to synthesize speech: ${errorMessage}`);
        }
        
        return null;
    } finally {
        // Clean up timeout
        clearTimeout(timeoutId);
    }
}

/**
 * Fallback base64 encoding using Uint8Array and btoa.
 */
function base64FromUint8Array(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return globalThis.btoa(binary);
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if Inworld TTS is configured and available.
 * Useful for debugging or UI feedback.
 */
export function isTtsConfigured(): boolean {
    return typeof getInworldApiKey() === 'string' && getInworldApiKey()!.length > 0;
}

/**
 * Get the configured voice ID or null if using default.
 */
export function getConfiguredVoice(): string | null {
    const voice = getInworldTtsVoice();
    return voice && voice.length > 0 ? voice : null;
}
