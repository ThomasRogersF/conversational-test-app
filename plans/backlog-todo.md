# Phase 9 Plan — Backlog / Optional TODOs

These are optional improvements and guardrails to consider later. The Phase 9 plan is good as written.

## 1) Ensure persona lookup uses the correct key
Plan says: “look up the persona using session.scenarioId.”
Better: resolve in this order:
- scenario = getScenarioById(session.scenarioId)
- persona = getPersonaById(scenario.personaId)
This avoids accidental mismatches if multiple scenarios share personas.

## 2) Add minimal validation for ttsVoiceId
If Inworld expects a specific format, add a light validation rule:
- `ttsVoiceId: z.string().min(1).max(128).optional()`
And log when missing/invalid + fallback to env voice.

## 3) Make mime type selection more defensive (Safari)
In getBestMimeType():
- Check `typeof MediaRecorder !== "undefined"`
- Check `typeof MediaRecorder.isTypeSupported === "function"`
If `isTypeSupported` is missing, fallback to trying constructor without specifying mimeType.

Suggested priority:
1) `audio/webm;codecs=opus`
2) `audio/webm`
3) `audio/mp4;codecs=mp4a.40.2` (if supported)
4) `audio/mp4`

## 4) Autoplay policy fallback for TTS
Even with a Play button fallback, consider:
- persist “autoplay failed once” in state and switch to manual play until the user taps play successfully.

## 5) Mic permission UX: avoid repeat banners
If permission denied / unsupported:
- show a single persistent banner with dismiss
- don’t re-toast on every click (prevents spam)

## 6) Recording cleanup robustness
On unmount/navigation:
- stop MediaRecorder if active
- stop tracks
- clear intervals/timers (if any)
- reset “recording/transcribing/sending” flags to avoid stale disabled UI

## 7) Empty transcription threshold
Instead of only whitespace check, consider “too short” check:
- if trimmed length < 2–3 chars, treat as empty and show retry prompt

## 8) Session continuity: avoid race conditions on refresh
If SessionScreen fetch runs while a turn is in-flight:
- use an AbortController or request counter to avoid older fetch overwriting newer state.

## 9) Persona voice mapping doc
Add a short note to docs/CONTENT_PACK_GUIDE.md:
- how to set `ttsVoiceId` per persona
- expected values and fallback behavior
