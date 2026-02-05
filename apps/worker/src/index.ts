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

import { SessionsDurableObject } from "./lib/sessions-durable-object";
export { SessionsDurableObject };


export interface Env {
    /** Durable Object binding for sessions */
    SESSIONS_DO?: DurableObjectNamespace;
    /** OpenAI API key for LLM teacher decisions */
    OPENAI_API_KEY: string;
    /** Inworld API key for TTS synthesis (Basic auth) */
    INWORLD_API_KEY: string;
    /** Optional Inworld TTS voice override */
    INWORLD_TTS_VOICE?: string;
}

// ============================================================================
// CORS Configuration
// ============================================================================

const ALLOWED_ORIGIN = "https://conversational-test-app.pages.dev";

/**
 * Add CORS headers to a Response
 */
function withCors(response: Response): Response {
    const newHeaders = new Headers(response.headers);
    newHeaders.set('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
    newHeaders.set('Vary', 'Origin');
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
    });
}

/**
 * Create a preflight response for OPTIONS requests
 */
function handlePreflight(): Response {
    return new Response(null, {
        status: 204,
        headers: {
            'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '86400',
            'Vary': 'Origin',
        },
    });
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
        return getSessionRouter().startSession(request);
    }

    if (pathname === '/api/session/turn' && method === 'POST') {
        return getSessionRouter().handleTurn(request, env);
    }

    if (pathname === '/api/session/end' && method === 'POST') {
        return getSessionRouter().endSession(request);
    }

    // POST /api/session/quiz/submit - Server-authoritative quiz grading
    if (pathname === '/api/session/quiz/submit' && method === 'POST') {
        return getSessionRouter().submitQuiz(request);
    }

    // GET /api/session/:id
    if (pathname.startsWith('/api/session/') && method === 'GET') {
        return getSessionRouter().getSession(request);
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
        return handleSttTranscribe(request, env);
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
        // Handle OPTIONS preflight requests globally
        if (request.method === 'OPTIONS') {
            return handlePreflight();
        }

        try {
            const response = await routeRequest(request, env);
            return withCors(response);
        } catch (err) {
            console.error('Unhandled error:', err);
            const errorRes = new Response(
                JSON.stringify(errorResponse('Internal server error', err instanceof Error ? err.message : String(err))),
                { status: 500, headers: { 'Content-Type': 'application/json' } }
            );
            return withCors(errorRes);
        }
    },
} satisfies ExportedHandler<Env>;
