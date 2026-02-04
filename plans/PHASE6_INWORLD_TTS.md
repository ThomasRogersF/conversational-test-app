# PHASE 6: Inworld TTS v1 (Tutor Voice Output)

## Overview

Phase 6 adds Text-to-Speech capability using Inworld TTS to generate audio for tutor responses. TTS is optional and non-blocking - if it fails or times out, the session continues normally without audio.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Phase 6 Architecture                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   UI (SessionScreen)                         Worker (sessions-router)          │
│   ┌──────────────────────┐                  ┌────────────────────────────┐   │
│   │ Tutor Voice Toggle   │ ─── ttsEnabled ──►│ handleTurn()              │   │
│   │ Audio Playback       │ ◄── tts payload ──│                            │   │
│   └──────────────────────┘                  └──────────┬─────────────────┘   │
│                                                         │                    │
│   API Layer (api.ts)                                    │                    │
│   ┌──────────────────────┐                              │                    │
│   │ sendSessionTurn()    │ ─── ttsEnabled ──────────────┤                    │
│   │ now returns tts?     │ ◄── tts payload ─────────────┤                    │
│   └──────────────────────┘                              │                    │
│                                                         ▼                    │
│                                                ┌────────────────────────┐     │
│                                                │ Inworld TTS Client    │     │
│                                                │ (inworld-tts.ts)      │     │
│                                                │                        │     │
│                                                │ synthesizeSpeech()    │     │
│                                                │ → {audioBase64, mime}  │     │
│                                                │ or null on failure    │     │
│                                                │ timeout: 3-5s         │     │
│                                                └────────────────────────┘     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Changes Summary

### Backend Changes

| File | Change |
|------|--------|
| `packages/shared/src/schemas/session.ts` | Add `TtsPayloadSchema`, update `TurnRequestSchema` with `ttsEnabled`, update `TurnResponseSchema` with optional `tts` |
| `apps/worker/src/lib/inworld-tts.ts` | **NEW** - Inworld TTS client module |
| `apps/worker/src/lib/sessions-router.ts` | Wire TTS into `handleTurn()` with optional `ttsEnabled` flag |
| `apps/worker/.env.example` | Add Inworld API credentials |

### UI Changes

| File | Change |
|------|--------|
| `apps/ui/src/lib/api.ts` | Update `sendSessionTurn()` to accept `ttsEnabled` and return optional `tts` payload |
| `apps/ui/src/screens/SessionScreen.tsx` | Add "Tutor Voice" toggle, implement base64→Blob→audio playback |

---

## Detailed Implementation

### 1. Shared Schema Updates (`packages/shared/src/schemas/session.ts`)

```typescript
// Add TTS payload schema
export const TtsPayloadSchema = z.object({
    mimeType: z.string(),
    audioBase64: z.string(),
});

export type TtsPayload = z.infer<typeof TtsPayloadSchema>;

// Update TurnRequestSchema
export const TurnRequestSchema = z.object({
    sessionId: z.string().uuid(),
    userText: z.string().min(1),
    ttsEnabled: z.boolean().optional().default(true),
});

// Update TurnResponseSchema
export const TurnResponseSchema = z.object({
    session: SessionStateSchema,
    tts: TtsPayloadSchema.optional(),
});

export type TurnResponse = z.infer<typeof TurnResponseSchema>;
```

### 2. Inworld TTS Client (`apps/worker/src/lib/inworld-tts.ts`)

```typescript
interface SynthesizeSpeechParams {
    text: string;
    voiceId?: string;
}

interface SynthesizeSpeechResult {
    audioBase64: string;
    mimeType: string;
}

// Environment configuration
const INWORLD_API_KEY = INWORLD_API_KEY?.trim();
const INWORLD_TTS_VOICE = INWORLD_TTS_VOICE?.trim() || 'default-voice';
const TTS_TIMEOUT_MS = 4000;

export async function synthesizeSpeech({
    text,
    voiceId,
}: SynthesizeSpeechParams): Promise<SynthesizeSpeechResult | null> {
    // Validate environment
    if (!INWORLD_API_KEY) {
        console.warn('[InworldTTS] API key not configured, skipping TTS');
        return null;
    }

    // Build request to Inworld TTS API
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TTS_TIMEOUT_MS);

    try {
        const response = await fetch('https://api.inworld.ai/v1/tts', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${INWORLD_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                text,
                voice: voiceId || INWORLD_TTS_VOICE,
                output_format: {
                    type: 'audio/mp3',
                },
            }),
            signal: controller.signal,
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[InworldTTS] API error: ${response.status} - ${errorText}`);
            return null;
        }

        const audioBuffer = await response.arrayBuffer();
        const audioBase64 = Buffer.from(audioBuffer).toString('base64');

        return {
            audioBase64,
            mimeType: 'audio/mp3',
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.warn(`[InworldTTS] Failed to synthesize speech: ${message}`);
        return null;
    } finally {
        clearTimeout(timeoutId);
    }
}
```

### 3. Session Router Updates (`apps/worker/src/lib/sessions-router.ts`)

In `handleTurn()`:
```typescript
// Extract ttsEnabled from request body (default: true)
const ttsEnabled = body.ttsEnabled ?? true;

// After processing turn...
const session = await this.engine.processTurn(body.sessionId, body.userText);

// Build response data
const responseData: { session: SessionState; tts?: TtsPayload } = { session };

// Synthesize TTS if enabled and tutor replied
if (ttsEnabled && session.lastDecision?.reply) {
    try {
        const tts = await synthesizeSpeech({
            text: session.lastDecision.reply,
        });
        if (tts) {
            responseData.tts = tts;
        }
    } catch (ttsError) {
        // Log but don't fail - TTS is optional
        console.warn(`[SessionRouter] TTS failed, continuing without audio: ${ttsError}`);
    }
}

return new Response(
    JSON.stringify(successResponse(responseData)),
    { headers: { 'Content-Type': 'application/json' } }
);
```

### 4. Environment Variables (`apps/worker/.env.example`)

```bash
# Inworld TTS Configuration
# Get credentials from https://inworld.ai/dashboard
INWORLD_API_KEY=your_inworld_api_key_here
INWORLD_TTS_VOICE=default_voice_id_or_name
```

### 5. UI API Updates (`apps/ui/src/lib/api.ts`)

```typescript
export async function sendSessionTurn(
    sessionId: string,
    userText: string,
    ttsEnabled: boolean = true
): Promise<{ session: SessionState; tts?: { mimeType: string; audioBase64: string } }> {
    return fetchApi<{ session: SessionState; tts?: { mimeType: string; audioBase64: string } }>(
        '/api/session/turn',
        {
            method: 'POST',
            body: JSON.stringify({ sessionId, userText, ttsEnabled }),
        }
    );
}
```

### 6. SessionScreen Updates (`apps/ui/src/screens/SessionScreen.tsx`)

Add state for TTS:
```typescript
const [ttsEnabled, setTtsEnabled] = React.useState(true);
const [audioUrl, setAudioUrl] = React.useState<string | null>(null);
const audioRef = React.useRef<HTMLAudioElement | null>(null);
```

Update `handleSendMessage`:
```typescript
const handleSendMessage = async () => {
    if (!sessionId || !messageInput.trim() || sending) return;

    setSending(true);
    const userText = messageInput.trim();
    setMessageInput('');

    try {
        const data = await sendSessionTurn(sessionId, userText, ttsEnabled);
        setSession(data.session);

        // Handle TTS audio playback
        if (ttsEnabled && data.tts?.audioBase64) {
            playAudio(data.tts.audioBase64, data.tts.mimeType);
        }
    } catch (err) {
        setError(parseApiError(err).message);
    } finally {
        setSending(false);
    }
};

const playAudio = (base64Audio: string, mimeType: string) => {
    try {
        // Clean up previous audio URL
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current = null;
        }

        const binaryString = atob(base64Audio);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: mimeType });
        const url = URL.createObjectURL(blob);

        setAudioUrl(url);
        audioRef.current = new Audio(url);
        audioRef.current.play().catch((err) => {
            console.warn('Audio playback failed:', err);
        });

        // Clean up after playback
        audioRef.current.onended = () => {
            URL.revokeObjectURL(url);
            setAudioUrl(null);
        };
    } catch (err) {
        console.warn('Failed to decode/play audio:', err);
    }
};
```

Update header to enable the toggle:
```tsx
<Toggle
    label="Tutor Voice"
    checked={ttsEnabled}
    onChange={setTtsEnabled}
    icon={<span>🔊</span>}
/>
```

---

## Non-Blocking Behavior

TTS is intentionally designed to be non-blocking:

1. **Timeout**: 4-second timeout on TTS requests (configurable via `TTS_TIMEOUT_MS`)
2. **Failure Handling**: If TTS fails, we log a warning and continue without audio
3. **Graceful Degradation**: Session works with or without TTS enabled
4. **No Persistent Storage**: Audio is transient, not stored between sessions

---

## Acceptance Criteria Checklist

- [ ] Turn works with TTS enabled (returns audio)
- [ ] Turn works with TTS disabled (returns no audio)
- [ ] Turn works when TTS fails (returns session, no audio)
- [ ] Audio plays automatically when returned and toggle is enabled
- [ ] Toggle allows users to enable/disable TTS
- [ ] Build passes (`pnpm build`)
- [ ] Lint passes (`pnpm lint`)
- [ ] Typecheck passes (`pnpm typecheck`)
