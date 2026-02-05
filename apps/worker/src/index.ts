import {
    successResponse,
    errorResponse,
} from '@repo/shared';
import {
    initializeContent,
    getLevels,
    getScenariosByLevel,
} from './lib/content-loader';
import { SessionRouter } from './lib/sessions-router';
import { handleSttTranscribe } from './lib/openai-stt';
import { SessionsDurableObject } from "./lib/sessions-durable-object";

export { SessionsDurableObject };

export interface Env {
    SESSIONS_DO?: DurableObjectNamespace;
    OPENAI_API_KEY: string;
    INWORLD_API_KEY: string;
    INWORLD_TTS_VOICE?: string;
}

const ALLOWED_ORIGIN = "https://conversational-test-app.pages.dev";

function withCors(response: Response): Response {
    const newHeaders = new Headers(response.headers);
    newHeaders.set('Access-Control-Allow-Origin', '*');
    newHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    newHeaders.set('Access-Control-Allow-Headers', 'Content-Type, X-Request-Id');
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders
    });
}

function handlePreflight(): Response {
    return new Response(null, {
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, X-Request-Id',
            'Access-Control-Max-Age': '86400',
        },
    });
}

async function routeRequest(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method;

    // --- Content Routes ---
    if (method === 'GET') {
        if (pathname === '/api/levels') {
            return new Response(JSON.stringify(successResponse(getLevels())), { status: 200 });
        }
        if (pathname === '/api/scenarios') {
            const level = url.searchParams.get('level');
            return new Response(JSON.stringify(successResponse(getScenariosByLevel(level || 'A1'))), { status: 200 });
        }
    }

    // --- Session Routes ---
    const router = new SessionRouter();

    // FIX: Using correct method names (startSession, not handleStartSession)
    if (pathname === '/api/session/start' && method === 'POST') {
        return router.startSession(request); 
    }
    
    if (pathname === '/api/session/turn' && method === 'POST') {
        return router.handleTurn(request, env); // Passed env!
    }

    if (pathname === '/api/session/end' && method === 'POST') {
        return router.endSession(request); 
    }

    if (pathname === '/api/quiz/submit' && method === 'POST') {
        return router.submitQuiz(request);
    }

    const sessionMatch = pathname.match(/^\/api\/session\/([a-zA-Z0-9-]+)$/);
    if (sessionMatch && method === 'GET') {
        return router.getSession(request, sessionMatch[1]);
    }

    // --- STT Route ---
    if (pathname === '/api/stt/transcribe' && method === 'POST') {
        return handleSttTranscribe(request, env);
    }

    return new Response(JSON.stringify(errorResponse('Not found')), { status: 404 });
}

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        if (request.method === 'OPTIONS') return handlePreflight();
        
        initializeContent();

        try {
            const response = await routeRequest(request, env);
            return withCors(response);
        } catch (err: any) {
            return withCors(new Response(JSON.stringify(errorResponse(err.message)), { status: 500 }));
        }
    }
};