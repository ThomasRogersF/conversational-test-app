// Inworld TTS Client
// Uses env bindings: INWORLD_API_KEY, INWORLD_TTS_VOICE

import { type TtsPayload } from '@repo/shared';

export type { TtsPayload };

export interface InworldTtsEnv {
    INWORLD_API_KEY: string;
    INWORLD_TTS_VOICE?: string;
}

const TTS_MAX_TEXT_LENGTH = 1000;
const TTS_TIMEOUT_MS = 5000;
const INWORLD_TTS_URL = 'https://api.inworld.ai/tts/v1/voice';
const INWORLD_TTS_MODEL = 'inworld-tts-1.5-max';

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
        console.warn('[InworldTTS] INWORLD_API_KEY not configured.');
        return null;
    }

    // 1. Auth Fix: Ensure Basic Auth format
    if (!apiKey.startsWith('Basic ')) {
        if (apiKey.includes(':') && !apiKey.match(/^[a-zA-Z0-9+/=]+$/)) {
            apiKey = `Basic ${btoa(apiKey)}`;
        } else {
            apiKey = `Basic ${apiKey}`;
        }
    }

    // 2. Voice Selection
    let voice = voiceId || env.INWORLD_TTS_VOICE?.trim();

    if (!voice || voice === 'default' || voice === '') {
        voice = 'masculine_us_1';
    }

    try {
        const response = await fetch(INWORLD_TTS_URL, {
            method: 'POST',
            headers: {
                'Authorization': apiKey,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                text,
                modelId: INWORLD_TTS_MODEL,
                // FIX: The API expects 'voiceId', NOT 'voice'
                voiceId: voice, 
            }),
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => 'unknown');
            console.error(`[InworldTTS] API Error ${response.status}: ${errorText}`);
            return null;
        }

        const audioArrayBuffer = await response.arrayBuffer();
        
        let audioBase64 = '';
        const bytes = new Uint8Array(audioArrayBuffer);
        for (let i = 0; i < bytes.byteLength; i++) {
            audioBase64 += String.fromCharCode(bytes[i]);
        }
        audioBase64 = btoa(audioBase64);

        return {
            audioBase64,
            mimeType: 'audio/mp3',
        };
    } catch (error: any) {
        console.warn(`[InworldTTS] Failed: ${error.message}`);
        return null;
    }
}

export function isTtsConfigured(env: InworldTtsEnv): boolean {
    return !!env.INWORLD_API_KEY;
}