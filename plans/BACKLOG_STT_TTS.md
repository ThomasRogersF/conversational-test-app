# Improvements Backlog — Phase 7 STT v1 (later hardening)

These are non-blocking improvements to make STT/TTS more robust across browsers and edge cases.

## 1) Worker multipart parsing reliability (/api/stt/transcribe)
Ensure the endpoint handles common failure modes cleanly:
- Missing `audio` field → return 400 with clear error message
- Wrong `Content-Type` (not multipart/form-data) → return 415 or 400 with clear message
- File size over limit (10MB) → return 413 (or 400) with explicit “File too large” message
- If using `request.formData()` in Cloudflare Worker, still validate fields defensively.

## 2) Browser compatibility for MediaRecorder + mimeType
Safari support can be inconsistent for `audio/webm;codecs=opus`.
UI improvements:
- Detect supported mime types:
  1) `audio/webm;codecs=opus`
  2) `audio/webm`
  3) `audio/mp4` (common Safari fallback)
- If no supported type is available, show a friendly message:
  “Your browser doesn’t support recording. Please use typed input.”

## 3) Avoid hardcoding Spanish forever
Hardcoding `language="es"` is fine for MVP.
Later improvement:
- Use scenario/level-driven language hints or a settings dropdown
- Pass `language` from UI to `/api/stt/transcribe`

## 4) UX cleanup: stop recording on navigation/unmount
Prevent “mic stuck on” by ensuring:
- Stop MediaRecorder on unmount/navigation
- Stop all tracks:
  `stream.getTracks().forEach(t => t.stop())`
- Reset recording state safely if the user navigates away mid-recording


### Backlog: Phase 8 timing consistency
- Potential double-measurement of llmMs/toolMs between session-engine and sessions-router.
- Ideal: engine is authoritative for llmMs + toolMs; router is authoritative for ttsMs + totalMs; router merges engine timing (no re-measure).
- Impact: debug numbers only; no user-facing impact. Safe to defer for MVP.
