# Phase 1 Implementation Plan: Content Pack v1

## Summary

This plan implements a data-first content pack system for the conversational Spanish learning app. All scenarios, personas, levels, and quizzes are pure JSON data validated by strict Zod schemas. The worker loads and caches content at startup, with cross-reference validation to ensure data integrity.

## Architecture

```mermaid
flowchart TD
    A[JSON Files] --> B[content-loader.ts]
    B --> C{Zod Validation}
    C -->|Invalid| D[Fail loudly with error details]
    C -->|Valid| E[In-Memory Cache]
    E --> F[API Routes]
    F --> G[/api/levels]
    F --> H[/api/scenarios?level=A1]
    F --> I[/api/content/levels]
    F --> J[/api/content/scenarios?level=A1]
```

---

## Task Breakdown

### 1. Enhance Zod Schemas

**File:** [`packages/shared/src/schemas/content.ts`](packages/shared/src/schemas/content.ts)

**Changes:**
- Add `tags?: string[]` to `ScenarioSchema`
- Add `successConditions: string[]` to `ScenarioSchema` (required)
- Add `conversationRules: string[]` to `ScenarioSchema` (required)
- Add `postQuizId?: string` to `ScenarioSchema` (optional, must reference quiz)
- Rename `goals` to `learningGoals` for clarity
- Add `ContentPackSchema` with cross-reference validation

### 2. Create JSON Content Files

**Location:** [`apps/worker/content/`](apps/worker/content/)

| File | Contents |
|------|----------|
| `levels.json` | A1, A2, B1 levels |
| `personas.json` | Jorge, Valentina |
| `scenarios.json` | Taxi Ride, Ser vs Estar |
| `quizzes.json` | Taxi Post-Quiz |

### 3. Content Loader Utility

**File:** [`apps/worker/src/lib/content-loader.ts`](apps/worker/src/lib/content-loader.ts)

**Features:**
- `loadContent(): ContentPack` - Loads all 4 JSON files, validates, returns typed object
- In-memory cache: content loaded once, reused for all requests
- Cross-reference validation: scenario.personaId → personas, scenario.levelId → levels, scenario.postQuizId → quizzes
- `formatZodError(err, filename): string` - Human-readable error with file, path, expected/received

### 4. API Routes

**File:** [`apps/worker/src/index.ts`](apps/worker/src/index.ts)

**Endpoints:**
| Route | Method | Returns |
|-------|--------|---------|
| `/api/levels` | GET | All levels |
| `/api/scenarios?level=A1` | GET | Filtered scenarios |
| `/api/content/levels` | GET | Alias for /api/levels |
| `/api/content/scenarios?level=A1` | GET | Alias for /api/scenarios |

**Response Format:**
```typescript
// Success
{ ok: true, data: T }

// Error
{ ok: false, error: { message: string, details?: string } }
```

### 5. Documentation

**File:** [`docs/CONTENT_PACK_GUIDE.md`](docs/CONTENT_PACK_GUIDE.md)

**Contents:**
- How to add a new level/persona/scenario/quiz
- Required fields per type
- Reference rules (ID matching)
- Validation failure examples

---

## Implementation Order

1. **Update Zod schemas** - Foundation for all validation
2. **Create JSON content files** - Seed data for testing
3. **Build content loader** - Core loading/validation logic
4. **Wire API routes** - Expose content via HTTP
5. **Add documentation** - Guide for future changes

---

## File Changes Summary

### New Files

| File | Purpose |
|------|---------|
| `apps/worker/content/levels.json` | Level definitions |
| `apps/worker/content/personas.json` | Persona definitions |
| `apps/worker/content/scenarios.json` | Scenario definitions |
| `apps/worker/content/quizzes.json` | Quiz definitions |
| `apps/worker/src/lib/content-loader.ts` | Content loading & validation |
| `docs/CONTENT_PACK_GUIDE.md` | Content authoring guide |

### Modified Files

| File | Changes |
|------|---------|
| `packages/shared/src/schemas/content.ts` | Enhanced schemas + ContentPackSchema |
| `apps/worker/src/index.ts` | API routes for content endpoints |

---

## Validation Rules

### Cross-References (enforced by ContentPackSchema)

1. **scenario.levelId** → must exist in levels[].id
2. **scenario.personaId** → must exist in personas[].id
3. **scenario.postQuizId** (if provided) → must exist in quizzes[].id
4. **quiz.scenarioId** → must exist in scenarios[].id (optional, for documentation)

### Zod Error Format

```
File: scenarios.json
Error: Validation failed at scenarios[0].personaId
Path: scenarios.0.personaId
Expected: string (reference to existing persona)
Received: "jorge" (persona not found in personas.json)
```

---

## Content Seed Data

### Levels

| ID | Name | Description | Order |
|----|------|-------------|-------|
| A1 | Beginner | Basic introductions and daily life | 1 |
| A2 | Elementary | Common situations and routines | 2 |
| B1 | Intermediate | Expressing opinions and experiences | 3 |

### Personas

| ID | Name | Role | Instructions |
|----|------|------|--------------|
| jorge | Jorge | Taxi Driver | Friendly driver from Bogotá. Keep responses short and casual. Use informal "tú". |
| valentina | Valentina | Spanish Tutor | Helpful tutor specializing in ser/estar. Give short corrections. Be encouraging. |

### Scenarios

| ID | Title | Level | Persona | Key Features |
|----|-------|-------|---------|--------------|
| taxi-bogota | Taxi Ride in Bogotá | A1 | jorge | Order taxi, give address, pay |
| ser-estar-confusion | Ser vs Estar Confusion | A1/A2 | valentina | Practice when to use ser vs estar |

### Quizzes

| ID | Scenario | Items |
|----|----------|-------|
| taxi-quiz | taxi-bogota | 3-5 MCQ items about taxi scenario |

---

## Acceptance Verification Checklist

- [ ] `GET /api/levels` returns validated levels from JSON
- [ ] `GET /api/scenarios?level=A1` returns only A1 scenarios
- [ ] Invalid JSON (e.g., missing persona) returns `{ ok: false, error: {...} }`
- [ ] `pnpm build` completes without errors
- [ ] `pnpm lint` passes
- [ ] `pnpm typecheck` passes
