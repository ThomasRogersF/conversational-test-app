import { TeacherDecisionSchema, type TeacherDecision } from '@repo/shared';

// ============================================================================
// Configuration
// ============================================================================

const OPENAI_MODEL = 'gpt-4o-mini';
const MAX_TRANSCRIPT_TURNS = 12;

// ============================================================================
// OpenAI API Types
// ============================================================================

interface OpenAIResponse {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: Array<{
        index: number;
        message: {
            role: string;
            content: string;
        };
        finish_reason: string;
    }>;
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

// ============================================================================
// Normalization Utilities
// ============================================================================

/**
 * Normalizes text for exact match comparison.
 * - Converts to lowercase
 * - Trims whitespace
 * - Collapses multiple whitespace characters to single spaces
 * - Strips surrounding punctuation (periods, exclamation marks, question marks, commas)
 */
export function normalizeForExactMatch(text: string): string {
    return text
        .toLowerCase()
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/^[.,!?;:]+|[.,!?;:]+$/g, '');
}

/**
 * Checks if two texts match exactly after normalization.
 */
export function isExactMatch(text1: string, text2: string): boolean {
    return normalizeForExactMatch(text1) === normalizeForExactMatch(text2);
}

// ============================================================================
// OpenAI Client
// ============================================================================

/**
 * Generates a teacher decision using OpenAI GPT-4o-mini.
 *
 * @param params - The parameters for generating a teacher decision
 * @param params.env - Cloudflare Worker environment containing OPENAI_API_KEY
 * @param params.transcript - Array of {role: 'user' | 'tutor', text: string}
 * @param params.scenario - The scenario configuration
 * @param params.persona - The persona configuration
 * @returns A validated TeacherDecision
 * @throws If the OpenAI call fails or the response doesn't match the schema
 */
export async function generateTeacherDecision(params: {
    env: { OPENAI_API_KEY: string };
    transcript: Array<{ role: 'user' | 'tutor'; text: string }>;
    scenario: {
        id: string;
        title: string;
        learningGoals: string[];
        conversationRules: string[];
        successConditions: string[];
        tags: string[];
    };
    persona: {
        id: string;
        name: string;
        role: string;
        instructions: string;
    };
}): Promise<TeacherDecision> {
    // Get API key from Cloudflare Worker environment
    const apiKey = params.env.OPENAI_API_KEY;
    if (!apiKey) {
        throw new Error('OPENAI_API_KEY is not set in Worker env');
    }

    // Build transcript window (last N turns)
    const recentTranscript = params.transcript.slice(-MAX_TRANSCRIPT_TURNS);
    const transcriptText = recentTranscript
        .map((msg) => `${msg.role}: ${msg.text}`)
        .join('\n');

    // Build the system prompt
    const systemPrompt = `You are a supportive Spanish language tutor AI. Your role is to:

1. Be a supportive, encouraging tutor who helps students learn Spanish
2. Stay in character as the persona specified below
3. Keep your replies SHORT - 1-2 sentences maximum
4. If the student makes a mistake:
   - Set isMistake: true
   - Set shouldRetry: true
   - Provide a clear correction
   - Give brief feedback explaining the error
5. If the student is correct:
   - Set isMistake: false
   - Set shouldRetry: false
   - Give positive reinforcement
   - Move the conversation forward naturally
6. ALWAYS include the reply field - this is the single source of truth for what the tutor says
7. You may request tools to perform actions - see below
8. Output ONLY valid JSON matching the required schema - no markdown, no extra text

// ============================================================================
// TOOL USAGE
// ============================================================================

You can request the following tools by setting the "tool" field in your response:

1. start_quiz - Start a quiz for the student
   - args: { quizId: string }
   - Use when: Student has completed the roleplay successfully and is ready for the quiz
   - Example: { "name": "start_quiz", "args": { "quizId": "taxi-quiz" } }

2. grade_quiz - Grade quiz answers (rarely needed - UI submits directly)
   - args: { quizId: string, answers: number[] }
   - Use when: Manually grading quiz in conversation
   - answers[i] corresponds to question i

3. get_hint - Get a learning hint
   - args: { topic?: string }
   - Use when: Student is struggling and needs guidance
   - Returns a short, server-generated hint

4. log_mistake - Log a mistake for later review
   - args: { original: string, corrected: string, type?: string }
   - Use when: Student makes an error you want to track

5. mark_complete - Mark the session as complete
   - args: { summary: string }
   - Use when: Session should be concluded with a summary
   - Sets phase to "completed" and stores the summary

IMPORTANT:
- You may request at most ONE tool per response
- After a tool executes, you may be asked to narrate the result - set tool to null in follow-up
- The "reply" field is ALWAYS required and is what the student sees

Persona Configuration:
- Name: ${params.persona.name}
- Role: ${params.persona.role}
- Instructions: ${params.persona.instructions}

Scenario: ${params.scenario.title}
Learning Goals:
${params.scenario.learningGoals.map((g) => '- ' + g).join('\n')}
Conversation Rules:
${params.scenario.conversationRules.map((r) => '- ' + r).join('\n')}
Success Conditions:
${params.scenario.successConditions.map((c) => '- ' + c).join('\n')}
Tags: ${params.scenario.tags.join(', ')}

Recent Transcript:
${transcriptText}

Your response must be a JSON object with this exact schema:
{
  "feedback": "string (brief feedback for the student)",
  "correction": "string (corrected version, required if shouldRetry is true)",
  "isMistake": boolean,
  "shouldRetry": boolean,
  "nextPhase": "roleplay" | "quiz" | "completed" (optional),
  "tool": { "name": "toolname", "args": {...} } | null,
  "reply": "string (REQUIRED - the tutor's response)"
}`;

    // Make the API call
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: OPENAI_MODEL,
            messages: [
                { role: 'system', content: systemPrompt },
                // Note: We don't include the transcript in messages because
                // it's already embedded in the system prompt for better control
            ],
            temperature: 0.3,
            response_format: { type: 'json_object' },
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
    }

    const data: OpenAIResponse = await response.json();

    if (!data.choices || data.choices.length === 0) {
        throw new Error('OpenAI response has no choices');
    }

    const content = data.choices[0]?.message?.content;

    if (!content) {
        throw new Error('OpenAI response has no content');
    }

    // Parse and validate the response
    let parsed: unknown;
    try {
        parsed = JSON.parse(content);
    } catch (parseError) {
        throw new Error(`Failed to parse OpenAI response as JSON: ${content}`);
    }

    // Validate against schema
    const result = TeacherDecisionSchema.safeParse(parsed);

    if (!result.success) {
        const errorDetails = result.error.errors
            .map((e) => `${e.path.join('.')}: ${e.message}`)
            .join('; ');
        throw new Error(`OpenAI response doesn't match TeacherDecisionSchema: ${errorDetails}. Raw response: ${content}`);
    }

    return result.data;
}

// ============================================================================
// Tool Narration (Follow-up OpenAI Call)
// ============================================================================

export interface ToolNarrationParams {
    env: { OPENAI_API_KEY: string };
    toolName: string;
    toolResult: {
        success: boolean;
        message: string;
    };
    scenario: {
        id: string;
        title: string;
        learningGoals: string[];
        conversationRules: string[];
        successConditions: string[];
        tags: string[];
    };
    persona: {
        id: string;
        name: string;
        role: string;
        instructions: string;
    };
}

/**
 * Generate a narration for a tool result.
 * Called after a tool executes to explain what happened.
 * IMPORTANT: This function is for generating the narration text ONLY.
 * The calling code must ensure tool is null in this follow-up call.
 */
export async function generateToolNarration(params: ToolNarrationParams): Promise<string> {
    const apiKey = params.env.OPENAI_API_KEY;
    if (!apiKey) {
        throw new Error('OPENAI_API_KEY is not set in Worker env');
    }

    const { toolName, toolResult, scenario, persona } = params;

    const systemPrompt = `You are a supportive Spanish language tutor AI narrating a tool result.

IMPORTANT: This is a follow-up to a tool call.
- Output ONLY a brief narration explaining what happened
- Set "tool" to null in your response
- Keep it SHORT - 1-2 sentences maximum
- Stay in character as the persona

Tool result:
- Tool: ${toolName}
- Success: ${toolResult.success}
- Message: ${toolResult.message}

Persona:
- Name: ${persona.name}
- Role: ${persona.role}

Your response must be JSON with this schema:
{
  "feedback": "string",
  "tool": null,
  "reply": "string (your narration)"
}`;

    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: OPENAI_MODEL,
                messages: [{ role: 'system', content: systemPrompt }],
                temperature: 0.3,
                response_format: { type: 'json_object' },
            }),
        });

        if (!response.ok) {
            return toolResult.success
                ? `¡${toolResult.message}!`
                : `Hubo un problema: ${toolResult.message}`;
        }

        const data: OpenAIResponse = await response.json();
        const content = data.choices[0]?.message?.content;

        if (!content) {
            return toolResult.message;
        }

        const parsed = JSON.parse(content);
        return (parsed as { reply?: string }).reply || toolResult.message;
    } catch {
        return toolResult.message;
    }
}

// ============================================================================
// Fallback Decision
// ============================================================================

/**
 * Creates a fallback teacher decision for when OpenAI fails.
 */
export function createFallbackDecision(): TeacherDecision {
    return {
        feedback: 'fallback',
        isMistake: false,
        shouldRetry: false,
        nextPhase: undefined,
        tool: null,
        reply: 'Sorry—something glitched. Please try that again.',
    };
}
