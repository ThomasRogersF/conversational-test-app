# Content Pack Guide

This guide describes how to add and modify content in the conversational Spanish learning app.

## Overview

All content (levels, personas, scenarios, quizzes) is stored as **pure JSON data** in [`apps/worker/content/`](apps/worker/content/). Content is validated at worker startup using **strict Zod schemas** defined in [`packages/shared/src/schemas/content.ts`](packages/shared/src/schemas/content.ts).

**Key principle:** No scenario logic is hardcoded. Everything is data.

---

## Content Files

| File | Purpose |
|------|---------|
| `levels.json` | CEFR proficiency levels (A1, A2, B1, etc.) |
| `personas.json` | Conversation partners (taxi driver, tutor, etc.) |
| `scenarios.json` | Learning scenarios linked to levels/personas |
| `quizzes.json` | Post-scenario assessments |

---

## Adding New Content

### 1. Adding a New Level

Edit [`apps/worker/content/levels.json`](apps/worker/content/levels.json):

```json
{
    "id": "B2",
    "name": "B2 - Upper Intermediate",
    "description": "Can interact with native speakers with a degree of fluency.",
    "order": 4
}
```

**Required fields:**
- `id` (string): Unique identifier (e.g., "A1", "B2")
- `name` (string): Display name
- `description` (string): Brief description
- `order` (number): Sort order

### 2. Adding a New Persona

Edit [`apps/worker/content/personas.json`](apps/worker/content/personas.json):

```json
{
    "id": "carlos",
    "name": "Carlos",
    "role": "Café Barista",
    "voiceId": "es-ES-Standard-C",
    "instructions": "You are Carlos, a friendly barista in Madrid. Use casual, friendly Spanish. Help the learner order coffee and make small talk."
}
```

**Required fields:**
- `id` (string): Unique identifier (lowercase, no spaces)
- `name` (string): Display name
- `role` (string): Persona role/occupation
- `instructions` (string): System prompt defining behavior

**Optional fields:**
- `voiceId` (string): TTS voice identifier

### 3. Adding a New Scenario

Edit [`apps/worker/content/scenarios.json`](apps/worker/content/scenarios.json):

```json
{
    "id": "cafe-ordering",
    "levelId": "A1",
    "title": "Ordering Coffee",
    "description": "Practice ordering a coffee at a café in Madrid.",
    "personaId": "carlos",
    "tags": ["food", "travel", "polite-forms"],
    "learningGoals": [
        "Order a coffee using 'Me gustaría...'",
        "Ask for size options",
        "Thank the barista politely"
    ],
    "initialMessage": "¡Hola! ¿Qué tal? ¿Qué te preparo hoy?",
    "successConditions": [
        "Learner orders using a complete sentence",
        "Learner uses 'por favor' or similar polite form",
        "Learner thanks the barista"
    ],
    "conversationRules": [
        "Barista waits for the learner's order",
        "Barista offers size options if asked",
        "Barista confirms the order before making it"
    ],
    "postQuizId": "cafe-quiz"
}
```

**Required fields:**
- `id` (string): Unique identifier
- `levelId` (string): Must match an existing level's `id`
- `title` (string): Display title
- `description` (string): Brief description
- `personaId` (string): Must match an existing persona's `id`
- `learningGoals` (array): List of learning objectives
- `initialMessage` (string): Persona says this when scenario starts
- `successConditions` (array): What learner must do to succeed
- `conversationRules` (array): Rules governing the conversation

**Optional fields:**
- `tags` (array): Categories for filtering
- `postQuizId` (string): Must match an existing quiz's `id`

### 4. Adding a New Quiz

Edit [`apps/worker/content/quizzes.json`](apps/worker/content/quizzes.json):

```json
{
    "id": "cafe-quiz",
    "scenarioId": "cafe-ordering",
    "items": [
        {
            "question": "How do you say 'I would like a coffee' politely?",
            "options": [
                "Me gustaría un café",
                "Quiero un café",
                "Dame un café",
                "Tráeme un café"
            ],
            "correctIndex": 0,
            "explanation": "¡Muy bien! 'Me gustaría' is the polite form for making requests."
        }
    ]
}
```

**Required fields:**
- `id` (string): Unique identifier
- `items` (array): At least one quiz item

**Optional fields:**
- `scenarioId` (string): Links quiz to a scenario (for documentation)

**Quiz Item fields:**
- `question` (string): The question
- `options` (array): At least 2 options
- `correctIndex` (number): 0-based index of correct answer
- `explanation` (string): Optional feedback

---

## Reference Rules

All cross-references are validated at worker startup:

1. **`scenario.levelId`** → Must exist in `levels[].id`
2. **`scenario.personaId`** → Must exist in `personas[].id`
3. **`scenario.postQuizId`** → Must exist in `quizzes[].id` (if provided)

If references are invalid, the worker will **fail to start** with a clear error message.

---

## Validation Failures

When content is invalid, the worker fails loudly with detailed error messages.

### Example: Missing Persona Reference

If `scenarios.json` references `personaId: "maria"` but no persona with that ID exists:

```
Error: Cross-reference validation failed:

File: cross-references
Validation Errors:
  - Path: scenarios.0.personaId
    Message: Scenario "cafe-ordering" references non-existent personaId "maria"
```

### Example: Invalid Level ID

If `scenarios.json` references `levelId: "C1"` but no level with that ID exists:

```
Error: Cross-reference validation failed:

File: cross-references
Validation Errors:
  - Path: scenarios.0.levelId
    Message: Scenario "cafe-ordering" references non-existent levelId "C1"
```

### Example: Missing Quiz Reference

If `scenarios.json` has `postQuizId: "missing-quiz"` but no quiz exists:

```
Error: Cross-reference validation failed:

File: cross-references
Validation Errors:
  - Path: scenarios.0.postQuizId
    Message: Scenario "cafe-ordering" references non-existent postQuizId "missing-quiz"
```

---

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/levels` | Returns all levels |
| `GET /api/scenarios?level=A1` | Returns scenarios filtered by level |
| `GET /api/content/levels` | Alias for `/api/levels` |
| `GET /api/content/scenarios?level=A1` | Alias for `/api/scenarios` |

### Response Format

**Success:**
```json
{
    "ok": true,
    "data": [...]
}
```

**Error:**
```json
{
    "ok": false,
    "error": {
        "message": "Human-readable error message",
        "details": "Optional detailed information"
    }
}
```

---

## Best Practices

1. **Use descriptive IDs**: `taxi-bogota` is better than `s1`
2. **Keep descriptions concise**: Under 200 characters
3. **Use consistent naming**: All lowercase, hyphens for spaces
4. **Test references**: Verify all `levelId`, `personaId`, and `postQuizId` references exist
5. **Run validation**: After any content change, verify with `pnpm build`

---

## Quick Reference: ID Matching

| Reference | Must Match |
|-----------|------------|
| `scenario.levelId` | `level.id` |
| `scenario.personaId` | `persona.id` |
| `scenario.postQuizId` | `quiz.id` |
| `quiz.scenarioId` | `scenario.id` (optional, for docs) |
