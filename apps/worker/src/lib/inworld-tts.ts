// Inworld TTS Client
// Uses env bindings: INWORLD_API_KEY, INWORLD_TTS_VOICE

import { type TtsPayload } from '@repo/shared';

export type { TtsPayload };

// ============================================================================
// Environment Type
// ============================================================================

export interface InworldTtsEnv {
    INWORLD_API_KEY: string;
    INWORLD_TTS_VOICE?: string;
}

// ============================================================================
// Configuration
// ============================================================================

const TTS_MAX_TEXT_LENGTH = 1000;
const TTS_TIMEOUT_MS = 5000; // Increased timeout slightly
const INWORLD_TTS_URL = 'https://api.inworld.ai/tts/v1/voice';
const INWORLD_TTS_MODEL = 'inworld-tts-1.5-max';

// ============================================================================
// TTS Synthesis
// ============================================================================

export async function synthesizeSpeech({
    text,
    voiceId,
    env,
}: {
    text: string;
    voiceId?: string;
    env: InworldTtsEnv;
}): Promise<TtsPayload | null> {
    let apiKey = env.INWORLD_API_KEY?.trim();

    if (!apiKey) {
        console.warn('[InworldTTS] INWORLD_API_KEY not configured, skipping TTS');
        return null;
    }

    // 1. AUTO-FIX AUTH: Base64 encode if the user provided "key:secret" in plaintext
    if (!apiKey.startsWith('Basic ')) {
        if (apiKey.includes(':') && !apiKey.match(/^[a-zA-Z0-9+/=]+$/)) {
            // It looks like raw "key:secret", so we encode it
            apiKey = `Basic ${btoa(apiKey)}`;
        } else {
            // It might be already encoded or just a token, prepend Basic just in case
            apiKey = `Basic ${apiKey}`;
        }
    }

    if (text.length > TTS_MAX_TEXT_LENGTH) {
        console.warn(`[InworldTTS] Text too long (${text.length} chars). Skipping.`);
        return null;
    }

    if (!text.trim()) return null;

    // 2. FIX VOICE: Only use voice if it's a valid string (not "default" or empty)
    let voice = voiceId || env.INWORLD_TTS_VOICE?.trim();
    if (voice === 'default') voice = undefined; // Let API decide default

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TTS_TIMEOUT_MS);

    try {
        const bodyPayload: any = {
            text,
            modelId: INWORLD_TTS_MODEL,
        };
        // Only attach voice if we actually have one
        if (voice) {
            bodyPayload.voice = voice;
        } else {
            // Fallback to a known safe male voice if none provided
            // This prevents "Diego" errors if you forgot to delete the secret
            bodyPayload.gender = "MASCULINE"; 
        }

        const response = await fetch(INWORLD_TTS_URL, {
            method: 'POST',
            headers: {
                'Authorization': apiKey, // Uses the fixed key
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(bodyPayload),
            signal: controller.signal,
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => 'unknown error');
            console.error(`[InworldTTS] API Error ${response.status}: ${errorText}`);
            return null;
        }

        const audioArrayBuffer = await response.arrayBuffer();
        const audioBase64 = arrayBufferToBase64(audioArrayBuffer);

        return {
            audioBase64,
            mimeType: 'audio/mp3',
        };
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn(`[InworldTTS] Failed: ${msg}`);
        return null;
    } finally {
        clearTimeout(timeoutId);
    }
}

// ============================================================================
// Utilities
// ============================================================================

function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const g = globalThis as Record<string, unknown>;
    if (typeof g.Buffer === 'function') {
        return (g.Buffer as unknown as { from(b: ArrayBuffer): { toString(e: string): string } })
            .from(buffer)
            .toString('base64');
    }
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

export function isTtsConfigured(env: InworldTtsEnv): boolean {
    return !!env.INWORLD_API_KEY?.trim();
}