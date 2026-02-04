# Phase 3 Plan: Server-side Session Engine v1

## Overview

Replace the UI's localStorage "fake session" with a real Worker-backed session engine using Cloudflare Durable Objects for persistent storage.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         UI (apps/ui)                             │
│  ScenarioSelect → POST /api/session/start → SessionScreen       │
│  SessionScreen  → POST /api/session/turn    → CompleteScreen    │
│  CompleteScreen → POST /api/session/end                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Worker (apps/worker)                          │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │              SessionsDurableObject                      │     │
│  │  - Stores SessionState in memory (SQLite-backed)       │     │
│  │  - Operations: create, load, update, delete            │     │
│  └─────────────────────────────────────────────────────────┘     │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │              Session Engine                             │     │
│  │  - Validates scenario/level exists                     │     │
│  │  - Generates placeholder tutor responses               │     │
│  │  - Manages phase transitions (roleplay → quiz → done)  │     │
│  └─────────────────────────────────────────────────────────┘     │
│                                                                  │
│  API Endpoints:                                                  │
│  - POST /api/session/start  → Create new session               │
│  - POST /api/session/turn   → Add message, get tutor reply     │
│  - POST /api/session/end    → Complete session, get summary    │
│  - GET  /api/session/:id    → Fetch session (optional)          │
└─────────────────────────────────────────────────────────────────┘
```

## Session State Schema

```typescript
// packages/shared/src/schemas/session.ts

export type SessionPhase = 'roleplay' | 'quiz' | 'completed';

export interface TranscriptMessage {
    id: string;           // unique message ID
    role: 'user' | 'tutor';
    text: string;
    ts: string;           // ISO timestamp
}

export interface Mistake {
    id: string;
    type: string;
    original: string;
    corrected?: string;
    ts: string;
}

export interface SessionState {
    id: string;
    createdAt: string;    // ISO timestamp
    updatedAt: string;    // ISO timestamp
    levelId: string;
    scenarioId: string;
    phase: SessionPhase;
    transcript: TranscriptMessage[];
    turnCount: number;
    mistakes: Mistake[];
    postQuizId?: string;   // Copied from scenario if present
}
```

## API Request/Response Types

```typescript
// packages/shared/src/schemas/session.ts (continued)

// POST /api/session/start
export interface StartSessionRequest {
    levelId: string;
    scenarioId: string;
}

export interface StartSessionResponse {
    sessionId: string;
    session: SessionState;
}

// POST /api/session/turn
export interface TurnRequest {
    sessionId: string;
    userText: string;
}

export interface TurnResponse {
    session: SessionState;
}

// POST /api/session/end
export interface EndSessionRequest {
    sessionId: string;
}

export interface SessionSummary {
    turns: number;
    hasQuiz: boolean;
    quizId?: string;
}

export interface EndSessionResponse {
    session: SessionState;
    summary: SessionSummary;
}

// GET /api/session/:id
export interface GetSessionResponse {
    session: SessionState;
}
```

## File Changes

### New Files

1. **packages/shared/src/schemas/session.ts**
   - SessionState type
   - TranscriptMessage type
   - Mistake type
   - SessionPhase type
   - All API request/response types
   - Zod schemas for validation

2. **packages/shared/src/schemas/index.ts**
   - Export session schema

3. **apps/worker/src/lib/sessions-durable-object.ts**
   - SessionsDurableObject class
   - SessionStorage interface
   - DO implementation with SQLite storage

4. **apps/worker/src/lib/session-engine.ts**
   - SessionEngine class
   - createSession()
   - processTurn()
   - endSession()
   - getSession()
   - getPersonaById() helper for placeholder responses

5. **apps/worker/src/lib/sessions-router.ts**
   - Route handlers for all session endpoints
   - Request validation
   - Error handling

### Modified Files

1. **packages/shared/src/index.ts**
   - Add: `export * from './schemas/session';`

2. **apps/worker/wrangler.toml**
   - Add Durable Objects binding
   - Add migrations section

3. **apps/worker/src/index.ts**
   - Import sessions router
   - Add DO binding to Env type
   - Register session routes

4. **apps/ui/src/lib/api.ts**
   - Add session API functions:
     - `startSession()`
     - `sendSessionTurn()`
     - `endSession()`
     - `getSession()`

5. **apps/ui/src/screens/ScenarioSelect.tsx**
   - Replace `getOrCreateSession()` with `startSession()`
   - Navigate to `/session/:sessionId`

6. **apps/ui/src/screens/SessionScreen.tsx**
   - Remove localStorage session management
   - Fetch session on mount via API
   - Call `sendSessionTurn()` on send
   - Render server transcript

7. **apps/ui/src/screens/CompleteScreen.tsx**
   - Call `endSession()` on mount
   - Show summary from response

8. **apps/ui/src/screens/QuizScreen.tsx**
   - Ensure `sessionId` from URL is used correctly

## Durable Objects Configuration

### wrangler.toml additions:

```toml
[[durable_objects.bindings]]
name = "SESSIONS_DO"
class_name = "SessionsDurableObject"

[migrations]
new_class_names = ["SessionsDurableObject"]
```

### SessionsDurableObject Structure:

```typescript
export class SessionsDurableObject {
    constructor(ctx: DurableObjectState, env: Env) {
        this.ctx = ctx;
        this.env = env;
    }

    // Initialize SQLite storage
    async initialize(): Promise<void> {
        // Create tables if not exist
        // Table: sessions (id, data, updatedAt)
    }

    // Create new session
    async create(session: SessionState): Promise<void> {
        // Insert into SQLite
    }

    // Load session by ID
    async load(id: string): Promise<SessionState | null> {
        // Select from SQLite
    }

    // Save session (update)
    async save(session: SessionState): Promise<void> {
        // Update in SQLite
    }

    // Delete session
    async delete(id: string): Promise<void> {
        // Delete from SQLite
    }
}
```

## Placeholder Tutor Response Logic

For Phase 3, tutor replies are placeholders that reference persona style:

```typescript
function generatePlaceholderReply(persona: Persona): string {
    switch (persona.id) {
        case 'jorge':
            return '(Jorge) ¡Ok, te entendí! ¿Algo más?';
        case 'valentina':
            return '(Valentina) ¡Muy bien! Vamos a seguir practicando.';
        default:
            return '(Tutor) Entiendo. ¿Qué más quieres practicar?';
    }
}
```

## Implementation Order

1. Create `packages/shared/src/schemas/session.ts` with all types/schemas
2. Export session schema from `packages/shared/src/index.ts`
3. Create `apps/worker/src/lib/sessions-durable-object.ts`
4. Update `apps/worker/wrangler.toml` with DO configuration
5. Create `apps/worker/src/lib/session-engine.ts`
6. Create `apps/worker/src/lib/sessions-router.ts`
7. Update `apps/worker/src/index.ts` to wire everything
8. Update `apps/ui/src/lib/api.ts` with session functions
9. Update `apps/ui/src/screens/ScenarioSelect.tsx`
10. Update `apps/ui/src/screens/SessionScreen.tsx`
11. Update `apps/ui/src/screens/CompleteScreen.tsx`
12. Run build, lint, typecheck

## Quality Checks

- [ ] `pnpm build` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm typecheck` passes
- [ ] Response format: `{ ok: true, data }` for success
- [ ] Error format: `{ ok: false, error: { message, details? } }`
- [ ] No scenario logic hardcoded in session engine
- [ ] Session state persists across refresh (DO-backed storage)
- [ ] Placeholder tutor responses reference persona style
