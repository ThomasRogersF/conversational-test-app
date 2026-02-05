// packages/shared/src/index.ts

export * from './schemas/content';
export * from './schemas/session';
export * from './schemas/stt';
export * from './schemas/timing';

// FIX: We add 'timing' and 'requestId' here so TypeScript stops complaining
export function successResponse<T>(
    data: T, 
    timing?: any, 
    requestId?: string
) {
    return {
        ok: true,
        data,
        timing,
        requestId
    };
}

export function errorResponse(message: string, details?: unknown) {
    return {
        ok: false,
        error: {
            message,
            details
        }
    };
}

export interface ApiResponse<T> {
    ok: boolean;
    data?: T;
    error?: {
        message: string;
        details?: unknown;
    };
    timing?: any;
    requestId?: string;
}

export interface ApiError {
    message: string;
    details?: unknown;
}