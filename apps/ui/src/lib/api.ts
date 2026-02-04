/// <reference types="vite/client" />
import type { Level, Scenario, Quiz, SessionState, SessionSummary, ApiResponse, Timing } from '@repo/shared';

// Environment configuration
const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL || '';

/**
 * Helper to get the full API URL
 */
function getApiUrl(path: string): string {
    if (API_BASE_URL) {
        return `${API_BASE_URL}${path}`;
    }
    return path;
}

/**
 * Generic fetch wrapper that handles the { ok: true, data } response format
 */
async function fetchApi<T>(
    path: string,
    options?: RequestInit
): Promise<T> {
    const url = getApiUrl(path);
    
    const response = await fetch(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...options?.headers,
        },
    });

    const data = await response.json();

    // Check for API error response
    const apiData = data as { ok?: boolean; error?: { message?: string; details?: string } };
    if (!response.ok || apiData.ok === false) {
        const errorMessage = apiData.error?.message || 'API request failed';
        throw new Error(errorMessage);
    }

    return (data as ApiResponse<T>).data;
}

// ============================================================================
// Content API
// ============================================================================

/**
 * Fetch all levels
 */
export async function getLevels(): Promise<Level[]> {
    return fetchApi<Level[]>('/api/levels');
}

/**
 * Fetch scenarios for a specific level
 */
export async function getScenarios(levelId: string): Promise<Scenario[]> {
    const params = new URLSearchParams({ level: levelId });
    return fetchApi<Scenario[]>(`/api/scenarios?${params}`);
}

/**
 * Fetch a specific quiz by ID
 */
export async function getQuiz(quizId: string): Promise<Quiz> {
    return fetchApi<Quiz>(`/api/quizzes/${encodeURIComponent(quizId)}`);
}

// ============================================================================
// Session API
// ============================================================================

/**
 * Start a new session for a scenario
 */
export async function startSession(levelId: string, scenarioId: string): Promise<{ sessionId: string; session: SessionState }> {
    return fetchApi<{ sessionId: string; session: SessionState }>('/api/session/start', {
        method: 'POST',
        body: JSON.stringify({ levelId, scenarioId }),
    });
}

/**
 * Send a user message and get a tutor response
 * @param sessionId - The session ID
 * @param userText - The user's message text
 * @param ttsEnabled - Whether to enable tutor voice TTS (default: false)
 * @returns The updated session, optional TTS audio payload, and optional timing metrics
 */
export async function sendSessionTurn(
    sessionId: string,
    userText: string,
    ttsEnabled: boolean = false
): Promise<{
    session: SessionState;
    tts?: { mimeType: string; audioBase64: string };
    requestId?: string;
    timing?: Timing;
}> {
    return fetchApi<{
        session: SessionState;
        tts?: { mimeType: string; audioBase64: string };
        requestId?: string;
        timing?: Timing;
    }>(
        '/api/session/turn',
        {
            method: 'POST',
            body: JSON.stringify({ sessionId, userText, ttsEnabled }),
        }
    );
}

/**
 * End a session and get the summary
 */
export async function endSession(sessionId: string): Promise<{ session: SessionState; summary: SessionSummary }> {
    return fetchApi<{ session: SessionState; summary: SessionSummary }>('/api/session/end', {
        method: 'POST',
        body: JSON.stringify({ sessionId }),
    });
}

/**
 * Get a session by ID (without mutating it)
 */
export async function getSession(sessionId: string): Promise<{ session: SessionState }> {
    return fetchApi<{ session: SessionState }>(`/api/session/${encodeURIComponent(sessionId)}`);
}

/**
 * Submit quiz answers to server for grading
 */
export async function submitQuizAnswers(
    sessionId: string,
    quizId: string,
    answers: number[]
): Promise<{ result: { quizId: string; score: number; total: number; answers: number[]; completedAt: string }; session: SessionState }> {
    return fetchApi<{ result: { quizId: string; score: number; total: number; answers: number[]; completedAt: string }; session: SessionState }>(
        '/api/session/quiz/submit',
        {
            method: 'POST',
            body: JSON.stringify({ sessionId, quizId, answers }),
        }
    );
}

// ============================================================================
// Speech-to-Text (STT) API
// ============================================================================

/**
 * Transcribe audio using the STT endpoint
 *
 * @param sessionId - Optional session ID for tracking
 * @param audioBlob - The recorded audio blob
 * @param language - Optional language hint (e.g., 'es' for Spanish)
 * @returns The transcribed text and optional timing metrics
 * @throws Error if transcription fails
 */
export async function transcribeAudio(
    sessionId: string | undefined,
    audioBlob: Blob,
    language?: string
): Promise<{ text: string; requestId?: string; timing?: Timing }> {
    // Get the full URL for the API
    const apiUrl = getApiUrl('/api/stt/transcribe');
    
    // Create FormData for multipart upload
    const formData = new FormData();
    formData.append('audio', audioBlob, 'audio.webm');
    
    if (language) {
        formData.append('language', language);
    }
    
    if (sessionId) {
        formData.append('sessionId', sessionId);
    }

    const response = await fetch(apiUrl, {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData?.error?.message || `Transcription failed: ${response.status}`;
        throw new Error(errorMessage);
    }

    const data = await response.json();
    
    // Handle the { ok: true, data: { text: "...", requestId?, timing? } } format
    if (data.ok === false) {
        throw new Error(data.error?.message || 'Transcription failed');
    }

    return {
        text: data.data.text as string,
        requestId: data.data.requestId,
        timing: data.data.timing,
    };
}

// ============================================================================
// Type for API error handling in components
// ============================================================================

export interface ApiErrorState {
    message: string;
    details?: string;
}

/**
 * Parse API error for display
 */
export function parseApiError(error: unknown): ApiErrorState {
    if (error instanceof Error) {
        return { message: error.message };
    }
    return { message: 'An unexpected error occurred' };
}
