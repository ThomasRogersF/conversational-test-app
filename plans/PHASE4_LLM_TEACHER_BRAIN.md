# Phase 4 Plan: LLM Teacher Brain (OpenAI gpt-4o-mini)

## Overview

Replace placeholder tutor replies with real tutoring decisions from OpenAI gpt-4o-mini. Implement strict TeacherDecision JSON output with validation and correction/retry gating.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      SessionEngine                                │
│                                                                  │
│  processTurn(sessionId, userText):                              │
│    1. Load session                                             │
│    2. Append user message to transcript                         │
│    3. Check pendingRetry:                                       │
│       - If exists: check retry success (normalized matching)     │
│       - If success: clear pendingRetry, proceed to generation   │
│       - If fail: keep pendingRetry, generate retry message      │
│    4. If no pendingRetry: Call OpenAI teacher decision         │
│    5. Validate TeacherDecision with Zod                         │
│    6. Append tutor message (from decision.say)                 │
│    7. If intent == correct_and_retry: set pendingRetry         │
│    8. Save session, return updated state                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      OpenAIClient                                 │
│                                                                  │
│  generateTeacherDecision(transcript, scenario, persona):          │
│    - Compose system prompt (global + persona + scenario)        │
│    - Include last N turns for context window                    │
│    - Call gpt-4o-mini with JSON mode constraint                │
│    - Validate response against TeacherDecisionSchema            │
│    - Return validated decision or throw                         │
└─────────────────────────────────────────────────────────────────┘
```

## TeacherDecision Schema (already exists)

```typescript
// packages/shared/src/schemas/content.ts

export const TeacherDecisionSchema = z.object({
    /** Feedback to provide to the student */
    feedback: z.string().min(1),
    /** Optional corrected version of the student's input */
    correction: z.string().optional(),
    /** Whether this was a mistake */
    isMistake: z.boolean(),
    /** Whether the student should retry */
    shouldRetry: z.boolean(),
    /** Next phase of the session */
    nextPhase: z.enum(['roleplay', 'quiz', 'completed']).optional(),
    /** Optional tool to invoke */
    tool: z.object({
        name: z.string(),
        args: z.record(z.any()),
    }).optional(),
    /** Content of the reply to show to the user */
    reply: z.string().optional(),
});

export type TeacherDecision = z.infer<typeof TeacherDecisionSchema>;
```

## New Session State Fields

```typescript
// packages/shared/src/schemas/session.ts (additions)

export interface PendingRetry {
    expected: string;      // The corrected phrase expected from user
    attempts: number;     // Number of failed attempts (0-3)
}

export interface SessionState {
    // ... existing fields ...
    
    /** Pending retry state for correction_and_retry gating */
    pendingRetry?: PendingRetry;
    
    /** Last teacher decision for UI reference */
    lastDecision?: TeacherDecision;
}
```

## Retry Logic

**Success Rule (Phase 4 - simple):**
- Normalize: lowercase + trim + collapse multiple spaces to single space
- Success if: normalized user text contains normalized expected phrase
- Examples:
  - Expected: "soy de new york"
  - User: "Yo soy de New York" → ✓ success (contains)
  - User: "Soy de New York" → ✓ success (contains)
  - User: "Yo ser de NY" → ✗ fail (doesn't contain)

**Max Attempts:** 3
- After 3 failed attempts, tutor provides stronger hint (still in roleplay)
- Hint can be generated locally or via OpenAI

## OpenAI Client

### apps/worker/src/lib/openai.ts

```typescript
interface GenerateTeacherDecisionArgs {
    transcript: Array<{ role: 'user' | 'tutor'; text: string }>;
    scenario: Scenario;
    persona: Persona;
}

async function generateTeacherDecision(
    args: GenerateTeacherDecisionArgs
): Promise<TeacherDecision>
```

**Prompt Composition:**

1. **Global Teacher System Prompt:**
```
You are a supportive Spanish language tutor. Rules:
- Keep responses SHORT (1-2 sentences max)
- Stay in character as the persona
- Correct mistakes gently but clearly
- Use "shouldRetry: true" when student makes an error and give the correction
- Use "shouldRetry: false" only when response is correct
- Output ONLY valid JSON matching the required schema
- Be encouraging and supportive
```

2. **Persona + Scenario Prompt:**
```
Persona: {persona.name} - {persona.role}
Style: {persona.instructions}

Scenario: {scenario.title}
Learning Goals:
{scenario.learningGoals.map(g => `- ${g}`).join('\n')}

Conversation Rules:
{scenario.conversationRules.map(r => `- ${r}`).join('\n')}

Current transcript:
{transcript.map(t => `${t.role}: ${t.text}`).join('\n')}

Respond as {persona.name} with a teacher decision.
```

## File Changes

### New Files

1. **apps/worker/src/lib/openai.ts**
   - OpenAIClient class
   - generateTeacherDecision() method
   - Prompt composer
   - Error handling with fallback

2. **apps/worker/.env.example**
   - Add OPENAI_API_KEY

### Modified Files

1. **packages/shared/src/schemas/session.ts**
   - Add PendingRetry interface
   - Update SessionStateSchema with optional pendingRetry and lastDecision

2. **apps/worker/src/lib/session-engine.ts**
   - Add OpenAI client
   - Update processTurn() with retry logic
   - Implement retry success check (normalized matching)
   - Handle max attempts (3) with stronger hints
   - Store lastDecision in session

3. **apps/ui/src/components/TranscriptBubble.tsx**
   - Show correction if present in message metadata

4. **apps/worker/wrangler.toml** (optional)
   - Add OPENAI_API_KEY to [vars] for secrets

## Error Handling Strategy

**If OpenAI fails:**
1. Try to parse partial response
2. If invalid, fall back to a safe "I didn't understand, please try again" message
3. Log error but keep session usable
4. Return success response with fallback tutor message (no retry gating)

## Implementation Order

1. Update `packages/shared/src/schemas/session.ts` with new fields
2. Build shared package
3. Create `apps/worker/src/lib/openai.ts`
4. Update `apps/worker/src/lib/session-engine.ts` with retry logic
5. Create `.env.example`
6. Update UI to show corrections
7. Run build, lint, typecheck

## Quality Checks

- [ ] `pnpm build` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm typecheck` passes
- [ ] "Yo ser de New York" triggers correction and retry
- [ ] "Soy de New York" clears pendingRetry and continues
- [ ] After 3 failed attempts, tutor gives stronger hint
- [ ] OpenAI failure returns usable fallback response
- [ ] Response format: `{ ok: true, data }`
