import {
    createContentPackSchema,
    LevelSchema,
    PersonaSchema,
    ScenarioSchema,
    QuizSchema,
    ApiError,
    errorResponse,
} from '@repo/shared';
import { z } from 'zod';
import type { ZodError, ZodIssue } from 'zod';
import type { ContentPack, Level, Persona, Scenario, Quiz } from '@repo/shared';

// Import JSON content files directly for bundling with Cloudflare Workers
import levelsJson from '../../content/levels.json';
import personasJson from '../../content/personas.json';
import scenariosJson from '../../content/scenarios.json';
import quizzesJson from '../../content/quizzes.json';

// Array schemas for validating JSON files (which contain arrays of items)
const LevelsArraySchema = z.array(LevelSchema);
const PersonasArraySchema = z.array(PersonaSchema);
const ScenariosArraySchema = z.array(ScenarioSchema);
const QuizzesArraySchema = z.array(QuizSchema);

// ============================================================================
// Error Formatting Utilities
// ============================================================================

/**
 * Formats a Zod error into a human-readable string.
 * 
 * @param err - The Zod validation error
 * @param filename - The name of the file that failed validation
 * @returns Human-readable error message with file, path, and expected/received info
 */
export function formatZodError(err: ZodError, filename: string): string {
    const issues = err.issues.map((issue) => formatZodIssue(issue));
    return `File: ${filename}\nValidation Errors:\n${issues.join('\n')}`;
}

/**
 * Formats a single Zod issue into a human-readable string.
 */
function formatZodIssue(issue: ZodIssue): string {
    const path = issue.path.join('.');
    let message = `  - Path: ${path || '(root)'}`;
    
    if (issue.message) {
        message += `\n    Message: ${issue.message}`;
    }
    
    // Add expected/received for schema issues
    if ('expected' in issue && issue.expected) {
        message += `\n    Expected: ${String(issue.expected)}`;
    }
    if ('received' in issue && issue.received) {
        message += `\n    Received: ${String(issue.received)}`;
    }
    
    return message;
}

/**
 * Creates a standardized API error from a Zod validation error.
 */
export function createValidationError(
    filename: string,
    err: ZodError
): ApiError {
    const details = formatZodError(err, filename);
    return errorResponse(`Validation failed for ${filename}`, details);
}

// ============================================================================
// Content Loading
// ============================================================================

// Content file names for error reporting
const CONTENT_FILE_NAMES = {
    levels: 'content/levels.json',
    personas: 'content/personas.json',
    scenarios: 'content/scenarios.json',
    quizzes: 'content/quizzes.json',
} as const;

/**
 * Loads all content files and validates them.
 *
 * @returns Validated ContentPack object
 * @throws Error with detailed validation information if any content is invalid
 */
export async function loadContent(): Promise<ContentPack> {
    // Use directly imported JSON files (bundled by Cloudflare Workers)
    const levelsData = levelsJson as unknown;
    const personasData = personasJson as unknown;
    const scenariosData = scenariosJson as unknown;
    const quizzesData = quizzesJson as unknown;

    // Validate array schemas first for better error messages
    const levelResult = LevelsArraySchema.safeParse(levelsData);
    const personaResult = PersonasArraySchema.safeParse(personasData);
    const scenarioResult = ScenariosArraySchema.safeParse(scenariosData);
    const quizResult = QuizzesArraySchema.safeParse(quizzesData);

    // Collect all validation errors
    const validationErrors: Array<{ file: string; error: ZodError }> = [];

    if (!levelResult.success) {
        validationErrors.push({ file: CONTENT_FILE_NAMES.levels, error: levelResult.error });
    }
    if (!personaResult.success) {
        validationErrors.push({ file: CONTENT_FILE_NAMES.personas, error: personaResult.error });
    }
    if (!scenarioResult.success) {
        validationErrors.push({ file: CONTENT_FILE_NAMES.scenarios, error: scenarioResult.error });
    }
    if (!quizResult.success) {
        validationErrors.push({ file: CONTENT_FILE_NAMES.quizzes, error: quizResult.error });
    }

    // If there are individual schema errors, throw with details
    if (validationErrors.length > 0) {
        const errorMessages = validationErrors
            .map(({ file, error }) => formatZodError(error, file))
            .join('\n\n');
        throw new Error(`Content validation failed:\n\n${errorMessages}`);
    }

    // Now validate cross-references using ContentPackSchema
    const contentPackData = {
        levels: levelResult.data,
        personas: personaResult.data,
        scenarios: scenarioResult.data,
        quizzes: quizResult.data,
    };

    const ContentPackSchema = createContentPackSchema();
    const crossRefResult = ContentPackSchema.safeParse(contentPackData);

    if (!crossRefResult.success) {
        const errorMessages = formatZodError(crossRefResult.error, 'cross-references');
        throw new Error(`Cross-reference validation failed:\n\n${errorMessages}`);
    }

    return crossRefResult.data;
}

// ============================================================================
// Cached Content Access
// ============================================================================

// Module-level cache (persists for the lifetime of the worker)
let cachedContent: ContentPack | null = null;
let loadError: Error | null = null;

/**
 * Gets the cached content, loading it if necessary.
 * Uses module-level caching for the worker's lifetime.
 */
export function getContent(): ContentPack {
    if (loadError) {
        throw loadError;
    }
    if (!cachedContent) {
        throw new Error('Content not loaded. Call loadContent() first during worker startup.');
    }
    return cachedContent;
}

/**
 * Initializes the content cache. Call this once during worker startup.
 * Logs errors but doesn't crash - the worker will fail on actual requests.
 */
export async function initializeContent(): Promise<void> {
    try {
        cachedContent = await loadContent();
        console.log(`[ContentLoader] Successfully loaded content:
  - ${cachedContent.levels.length} levels
  - ${cachedContent.personas.length} personas
  - ${cachedContent.scenarios.length} scenarios
  - ${cachedContent.quizzes.length} quizzes`);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        loadError = new Error(`Failed to initialize content: ${message}`);
        console.error('[ContentLoader]', loadError.message);
        // Don't throw - allow worker to start but fail on content requests
    }
}

// ============================================================================
// Query Helpers
// ============================================================================

/**
 * Gets all levels, sorted by order.
 */
export function getLevels(): Level[] {
    return getContent().levels.sort((a, b) => a.order - b.order);
}

/**
 * Gets a level by ID.
 */
export function getLevelById(id: string): Level | undefined {
    return getContent().levels.find((l) => l.id === id);
}

/**
 * Gets all scenarios for a specific level.
 */
export function getScenariosByLevel(levelId: string): Scenario[] {
    return getContent().scenarios.filter((s) => s.levelId === levelId);
}

/**
 * Gets a scenario by ID.
 */
export function getScenarioById(id: string): Scenario | undefined {
    return getContent().scenarios.find((s) => s.id === id);
}

/**
 * Gets all personas.
 */
export function getPersonas(): Persona[] {
    return getContent().personas;
}

/**
 * Gets a persona by ID.
 */
export function getPersonaById(id: string): Persona | undefined {
    return getContent().personas.find((p) => p.id === id);
}

/**
 * Gets a quiz by ID.
 */
export function getQuizById(id: string): Quiz | undefined {
    return getContent().quizzes.find((q) => q.id === id);
}

/**
 * Gets all quizzes.
 */
export function getQuizzes(): Quiz[] {
    return getContent().quizzes;
}
