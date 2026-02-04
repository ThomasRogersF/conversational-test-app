import {
    successResponse,
    errorResponse,
    type ApiResponse,
    type ApiError,
} from '@repo/shared';
import {
    initializeContent,
    getContent,
    getLevels,
    getScenariosByLevel,
    getScenariosByLevel as getScenarios,
    getQuizzes,
    getQuizById,
    formatZodError,
} from './lib/content-loader';
import { SessionRouter } from './lib/sessions-router';
import { handleSttTranscribe } from './lib/openai-stt';
import type { Level, Scenario, Quiz } from '@repo/shared';

export interface Env {
    /** Durable Object binding for sessions */
    SESSIONS_DO?: DurableObjectNamespace;
}

// ============================================================================
// Content Initialization
// ============================================================================

// Initialize content when the worker starts
// Note: In Cloudflare Workers, this runs once per instance
const contentInitialized = initializeContent();

async function ensureContentLoaded(): Promise<void> {
    await contentInitialized;
    // This will throw if content failed to load, which will result in a 500 error
    getContent();
}

// ============================================================================
// Session Router Instance
// ============================================================================

let sessionRouter: SessionRouter | null = null;

function getSessionRouter(): SessionRouter {
    if (!sessionRouter) {
        sessionRouter = new SessionRouter();
    }
    return sessionRouter;
}

// ============================================================================
// API Route Handlers
// ============================================================================

/**
 * GET /api/levels - Returns all levels
 */
async function handleGetLevels(): Promise<Response> {
    try {
        await ensureContentLoaded();
        const levels = getLevels();
        return new Response(
            JSON.stringify(successResponse(levels)),
            {
                headers: { 'Content-Type': 'application/json' },
            }
        );
    } catch (err) {
        if (err instanceof Error && err.message.includes('Failed to initialize content')) {
            return new Response(
                JSON.stringify(errorResponse('Content not available', err.message)),
                { status: 500, headers: { 'Content-Type': 'application/json' } }
            );
        }
        return new Response(
            JSON.stringify(errorResponse('Failed to load levels')),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }
}

/**
 * GET /api/scenarios?level=A1 - Returns scenarios filtered by level
 */
async function handleGetScenarios(request: Request): Promise<Response> {
    try {
        await ensureContentLoaded();
        
        const url = new URL(request.url);
        const levelId = url.searchParams.get('level');
        
        if (!levelId) {
            return new Response(
                JSON.stringify(errorResponse('Missing required query parameter', 'level parameter is required (e.g., ?level=A1)')),
                { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
        }
        
        const scenarios = getScenarios(levelId);
        return new Response(
            JSON.stringify(successResponse(scenarios)),
            { headers: { 'Content-Type': 'application/json' } }
        );
    } catch (err) {
        if (err instanceof Error && err.message.includes('Failed to initialize content')) {
            return new Response(
                JSON.stringify(errorResponse('Content not available', err.message)),
                { status: 500, headers: { 'Content-Type': 'application/json' } }
            );
        }
        return new Response(
            JSON.stringify(errorResponse('Failed to load scenarios')),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }
}

/**
 * GET /api/content/levels - Alias for /api/levels
 */
async function handleGetContentLevels(): Promise<Response> {
    return handleGetLevels();
}

/**
 * GET /api/content/scenarios?level=A1 - Alias for /api/scenarios
 */
async function handleGetContentScenarios(request: Request): Promise<Response> {
    return handleGetScenarios(request);
}

/**
 * GET /api/quizzes/:id - Returns a specific quiz by ID
 */
async function handleGetQuiz(request: Request): Promise<Response> {
    try {
        await ensureContentLoaded();
        
        const url = new URL(request.url);
        const quizId = url.pathname.split('/').pop();
        
        if (!quizId) {
            return new Response(
                JSON.stringify(errorResponse('Missing quiz ID')),
                { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
        }
        
        const quiz = getQuizById(quizId);
        
        if (!quiz) {
            return new Response(
                JSON.stringify(errorResponse('Quiz not found', `No quiz found with id "${quizId}"`)),
                { status: 404, headers: { 'Content-Type': 'application/json' } }
            );
        }
        
        return new Response(
            JSON.stringify(successResponse(quiz)),
            { headers: { 'Content-Type': 'application/json' } }
        );
    } catch (err) {
        if (err instanceof Error && err.message.includes('Failed to initialize content')) {
            return new Response(
                JSON.stringify(errorResponse('Content not available', err.message)),
                { status: 500, headers: { 'Content-Type': 'application/json' } }
            );
        }
        return new Response(
            JSON.stringify(errorResponse('Failed to load quiz')),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }
}

/**
 * GET /api/content/quizzes/:id - Alias for /api/quizzes/:id
 */
async function handleGetContentQuiz(request: Request): Promise<Response> {
    return handleGetQuiz(request);
}

// ============================================================================
// Request Router
// ============================================================================

async function routeRequest(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method;

    // Health check
    if (pathname === '/health' || pathname === '/') {
        return new Response('OK');
    }

    // Session Routes
    if (pathname === '/api/session/start' && method === 'POST') {
        return getSessionRouter().handleStartSession(request);
    }

    if (pathname === '/api/session/turn' && method === 'POST') {
        return getSessionRouter().handleTurn(request);
    }

    if (pathname === '/api/session/end' && method === 'POST') {
        return getSessionRouter().handleEndSession(request);
    }

    // GET /api/session/:id
    if (pathname.startsWith('/api/session/') && method === 'GET') {
        return getSessionRouter().handleGetSession(request);
    }

    // Content API Routes
    if (pathname === '/api/levels' || pathname === '/api/content/levels') {
        if (method !== 'GET') {
            return new Response(
                JSON.stringify(errorResponse('Method not allowed', 'Only GET is supported')),
                { status: 405, headers: { 'Content-Type': 'application/json' } }
            );
        }
        return handleGetLevels();
    }

    if (pathname === '/api/scenarios' || pathname === '/api/content/scenarios') {
        if (method !== 'GET') {
            return new Response(
                JSON.stringify(errorResponse('Method not allowed', 'Only GET is supported')),
                { status: 405, headers: { 'Content-Type': 'application/json' } }
            );
        }
        return handleGetScenarios(request);
    }

    // GET /api/quizzes/:id
    if ((pathname.startsWith('/api/quizzes/') || pathname.startsWith('/api/content/quizzes/')) && method === 'GET') {
        return handleGetQuiz(request);
    }

    // POST /api/stt/transcribe - Speech-to-text transcription
    if (pathname === '/api/stt/transcribe' && method === 'POST') {
        return handleSttTranscribe(request);
    }

    // 404 for unknown routes
    return new Response(
        JSON.stringify(errorResponse('Not found', `Route ${pathname} not found`)),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
}

// ============================================================================
// Worker Entry Point
// ============================================================================

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        try {
            return await routeRequest(request, env);
        } catch (err) {
            console.error('Unhandled error:', err);
            return new Response(
                JSON.stringify(errorResponse('Internal server error', err instanceof Error ? err.message : String(err))),
                { status: 500, headers: { 'Content-Type': 'application/json' } }
            );
        }
    },
} satisfies ExportedHandler<Env>;
