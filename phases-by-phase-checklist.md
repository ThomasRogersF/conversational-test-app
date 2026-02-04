# Master Phase Plan (Option 1: STT → LLM → TTS on Cloudflare)

## Phase 0 — Repo & Ground Rules (10/10 important)

**Goal:** Lock conventions so later phases don't thrash.

### Deliverables

- Decision doc (in repo): architecture, constraints, API contracts
- Folder structure for frontend + worker
- Content pack schema draft (Zod)

### Tasks

- Choose framework: React + Vite + TS for UI
- Choose worker structure: Cloudflare Worker + Wrangler
- Define shared types package (or "copy types" approach)
- Define strict content pack schemas (levels/scenarios/personas/quizzes)
- Define TeacherDecision JSON schema (Zod)

### Acceptance Checks

- Repo builds locally (even if UI is placeholder)
- pnpm lint / pnpm typecheck pass (or equivalent)

### Claude Prompt (Phase 0)

```
"Create the monorepo scaffold for Cloudflare Pages (React/Vite/TS/Tailwind) + Cloudflare Worker (Wrangler/TS). Include a /content folder with placeholder JSON and Zod schemas in worker. Include a docs/ARCHITECTURE.md describing Option1 pipeline and API contracts."
```

---

## Phase 1 — Content Pack v1 (Data-first, no AI yet)

**Goal:** Make scenarios "real" as data before touching OpenAI/Inworld.

### Deliverables

- content/levels.json
- content/scenarios.json
- content/personas.json
- content/quizzes.json
- Zod validation for all four
- Content loader utilities + error reporting

### Tasks

- Implement Zod schemas for each JSON file
- Implement loader loadContent() that validates and returns typed objects
- Seed 2 scenarios + 1 quiz (Taxi, Ser/Estar) as JSON
- Write docs: how to add a new scenario/persona/quiz

### Acceptance Checks

- Worker endpoint GET /api/levels returns levels from JSON
- Worker endpoint GET /api/scenarios?level=A1 returns filtered list
- If you break JSON, server fails with a clear message

### Claude Prompt (Phase 1)

```
"Implement the full content pack system: JSON files + Zod schemas + loader with clear errors. Add API routes /api/levels and /api/scenarios. Seed 2 scenarios and 1 quiz in JSON only; no hardcoding."
```

---

## Phase 2 — UI Wireframe (No voice, no AI, just flow)

**Goal:** Prove navigation and "modal" UX work.

### Deliverables

- Screens: Menu → Level → Scenario → Session → Quiz → Completed
- Basic component library (cards, buttons, transcript list)
- "Session screen" works with text input only
- Settings toggles stubbed (audio on/off, mic on/off)

### Tasks

- Build routes/pages for each screen
- Implement scenario browsing from /api/scenarios
- Implement a local "fake session" state to show transcript log
- Add "Start" and "End lesson" navigation
- Add quiz UI capable of rendering quiz items from JSON

### Acceptance Checks

- You can click through the entire flow without any backend logic
- Quiz screen renders from quiz JSON
- UI uses data (level/scenario) from the content pack endpoints

### Claude Prompt (Phase 2)

```
"Build the full UI wireframe flow in React/Vite/TS/Tailwind using the content endpoints. Implement pages for menu, level select, scenario select, session, quiz, completed. Session uses text input and local transcript state only."
```

---

## Phase 3 — Session Engine v1 (Generic state machine, still no AI)

**Goal:** Create the durable backbone: sessions, phases, transcript, completion.

### Deliverables

- Worker session engine (generic)
- Session state machine: roleplay → quiz → completed
- Endpoints:
  - POST /api/session/start
  - POST /api/session/turn (for now: echoes user input + canned tutor placeholder)
  - POST /api/session/end
- Storage: MVP: Durable Objects SQLite or memory map (decide now)

### Tasks

- Define SessionState type
- Implement create session and store state
- Implement transcript append (user/tutor)
- Implement scenario "goals met" placeholder checks (string matching okay for now)
- Implement session end summary generation (simple)

### Acceptance Checks

- Start session returns a sessionId
- Turn endpoint updates transcript and returns updated session state
- End endpoint returns summary/mistakes placeholder + clears/marks session

### Claude Prompt (Phase 3)

```
"Implement the session engine + API routes in the Worker. Use generic SessionState with phase transitions roleplay→quiz→completed. For now, tutor reply is a stub string but everything else is real. Sessions stored in Durable Objects SQLite if possible, otherwise in-memory with clean abstraction."
```

---

## Phase 4 — LLM Teacher Brain (OpenAI) + Strict TeacherDecision JSON

**Goal:** Replace stub tutor with real gpt-4o-mini decisions + correction logic.

### Deliverables

- OpenAI client wrapper in Worker
- Prompt composer:
  - Global teacher prompt
  - Persona/scenario prompt injected from content
- TeacherDecision Zod schema + validation
- Correction/retry rule implemented

### Tasks

- Add env var handling OPENAI_API_KEY
- Implement /api/session/turn:
  - take userText
  - call OpenAI gpt-4o-mini
  - force JSON output
  - validate it
- Implement "correct_and_retry" gating:
  - session does not advance goals or turn logic unless retry success
- Implement mistake logging (in state)

### Acceptance Checks

- Tutor stays in persona/roleplay
- If user makes a basic error (e.g. "Yo ser de…") the tutor corrects and requests retry
- TeacherDecision always parses as valid JSON (otherwise fails with a recoverable fallback)

### Claude Prompt (Phase 4)

```
"Integrate OpenAI gpt-4o-mini into session/turn. Force strict TeacherDecision JSON and validate with Zod. Implement correction_and_retry gating and mistake logging. Keep prompts modular: global teacher prompt + persona prompt from content."
```

---

## Phase 5 — Tool Calling + Quiz Engine (Server-authoritative)

**Goal:** Make the AI able to trigger quizzes and use tools.

### Deliverables

- Tool functions:
  - get_hint
  - log_mistake
  - start_quiz
  - grade_quiz
  - mark_complete
- LLM tool calling interface:
  - model requests tool via TeacherDecision.tool
  - worker executes tool
  - worker optionally sends tool result back to LLM for next decision

### Tasks

- Implement start_quiz(quizId) sets phase quiz
- Implement quiz scoring logic with explanations
- Build hint generation:
  - from scenario content or "hint bank"
- Update UI to handle phase transitions from API response

### Acceptance Checks

- AI can trigger quiz at end of Taxi scenario
- Quiz can be graded and displayed
- Completed screen shows mistakes and score

### Claude Prompt (Phase 5)

```
"Implement server-side tool calling based on TeacherDecision.tool. Add quiz start/grade tools. Wire UI to respect phase changes roleplay→quiz→completed. Ensure AI can reliably trigger quiz for scenario 1."
```

---

## Phase 6 — TTS (Inworld) + Audio Playback Toggle

**Goal:** Tutor speaks.

### Deliverables

- Worker endpoint: POST /api/tts
- Inworld client wrapper
- UI audio playback (HTMLAudioElement) + mute toggle

### Tasks

- Add env var handling INWORLD_API_KEY (Basic auth)
- Implement Inworld TTS call:
  - non-streaming first (simpler)
  - keep code ready for voice:stream upgrade
- UI plays the returned audio
- Add "Audio on/off" toggle persisted in localStorage

### Acceptance Checks

- Tutor response plays as audio when enabled
- Works across multiple turns without leaking memory

### Claude Prompt (Phase 6)

```
"Integrate Inworld TTS with /api/tts. Return audio in a browser-playable format. Add frontend playback + mute toggle persisted in localStorage. Keep a clean abstraction for later streaming upgrade."
```

---

## Phase 7 — STT (OpenAI Transcribe) + Push-to-Talk

**Goal:** User can speak; we transcribe; feed into LLM.

### Deliverables

- Worker endpoint: POST /api/stt
- Frontend push-to-talk (MediaRecorder)
- Flow: record → upload → transcript → /session/turn

### Tasks

- Implement mic capture (wav/webm)
- Base64 or multipart upload to worker
- Worker calls gpt-4o-mini-transcribe
- Show transcript text before sending (optional)
- Add a mic toggle "experimental"

### Acceptance Checks

- Speaking produces a transcript reliably
- Transcript is used as user input and tutor responds normally
- Graceful error messages if mic permission denied

### Claude Prompt (Phase 7)

```
"Add push-to-talk using MediaRecorder. Create /api/stt in Worker using gpt-4o-mini-transcribe. Wire session view so recorded audio transcribes, shows transcript, and then sends it to /api/session/turn."
```

---

## Phase 8 — "Realtime feel" upgrade (optional)

**Goal:** Not true streaming, but feels snappy.

### Deliverables

- Chunked audio upload (250–750ms) OR segmented "voice turns"
- Optional SSE for partial transcript events
- UI partial transcript display

### Tasks

- Add chunking strategy
- Add SSE endpoint if desired
- Smooth UI state (listening, thinking, speaking)

### Acceptance Checks

- UX feels quick and conversational
- No major reliability regressions

### Claude Prompt (Phase 8)

```
"Improve perceived realtime by chunked STT + optional SSE for partial transcripts. Add session UI states (listening/thinking/speaking). Keep it deployable on Cloudflare."
```

---

## Phase 9 — Hardening + Observability

**Goal:** Reduce failures and make debugging easy.

### Deliverables

- Structured logs (per session)
- Basic rate limits per IP/session
- Safety fallbacks:
  - invalid JSON from LLM
  - TTS failures
  - STT failures
- Token/cost guardrails
- "Replay last session" dev page

### Acceptance Checks

- If OpenAI returns malformed output, app recovers with fallback response
- Logs show sessionId, scenarioId, latency timings

### Claude Prompt (Phase 9)

```
"Add robust error handling, structured logs, and guardrails. Implement fallbacks for invalid TeacherDecision JSON. Add basic rate limiting and dev utilities to replay transcript for debugging."
```

---

## How we'll run this together (your workflow)

1. You run Phase 0 prompt in Claude Code.
2. Paste the file tree + key files + any errors back here.
3. I review and generate the next phase prompt tailored to what exists.
4. Repeat.

## What to bring back after each Claude phase (so I can guide precisely)

- File tree
- Any error logs (build or runtime)
- The main files for that phase:
  - content schemas/loaders
  - API routes
  - session engine
  - UI session screen