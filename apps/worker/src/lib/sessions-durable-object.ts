import type { SessionState } from '@repo/shared';

// ============================================================================
// Type Definitions for Cloudflare Durable Objects
// ============================================================================

/**
 * Minimal DurableObject interface for Cloudflare Workers.
 * The actual interface may vary based on the @cloudflare/workers-types version.
 */
interface DurableObjectInterface {
    fetch(request: Request, ...args: unknown[]): Promise<Response> | Response;
}

interface DurableObjectState {
    readonly storage: DurableObjectStorage;
}

interface DurableObjectStorage {
    get(key: string): Promise<unknown>;
    put(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
    list(options?: { prefix?: string }): Promise<Map<string, unknown>>;
}

interface DurableObjectNamespace {
    idFromName(name: string): DurableObjectId;
    get(id: DurableObjectId): DurableObjectStub;
}

interface DurableObjectId {
    toString(): string;
}

interface DurableObjectStub {
    fetch(request: Request, ...args: unknown[]): Promise<Response> | Response;
}

// ============================================================================
// Session Storage Interface
// ============================================================================

/**
 * Interface for session storage.
 * Allows swapping between in-memory, DO, KV, SQLite implementations.
 */
export interface SessionStorage {
    /** Create a new session */
    create(session: SessionState): Promise<void>;
    
    /** Load a session by ID */
    load(id: string): Promise<SessionState | null>;
    
    /** Save/update a session */
    save(session: SessionState): Promise<void>;
    
    /** Delete a session */
    delete(id: string): Promise<void>;
    
    /** List all sessions (optional, for debugging) */
    list(): Promise<SessionState[]>;
}

// ============================================================================
// In-Memory Session Storage (Development/Fallback)
// ============================================================================

/**
 * InMemorySessionStorage - Simple in-memory storage for development/testing.
 * 
 * This is used when Durable Objects are not configured or available.
 * Sessions persist only for the lifetime of the worker instance.
 */
export class InMemorySessionStorage implements SessionStorage {
    private readonly sessions = new Map<string, SessionState>();

    async create(session: SessionState): Promise<void> {
        this.sessions.set(session.id, session);
        console.log(`[InMemoryStorage] Created session: ${session.id}`);
    }

    async load(id: string): Promise<SessionState | null> {
        const session = this.sessions.get(id) ?? null;
        if (session) {
            console.log(`[InMemoryStorage] Loaded session: ${id}`);
        }
        return session;
    }

    async save(session: SessionState): Promise<void> {
        this.sessions.set(session.id, session);
        console.log(`[InMemoryStorage] Saved session: ${session.id}`);
    }

    async delete(id: string): Promise<void> {
        this.sessions.delete(id);
        console.log(`[InMemoryStorage] Deleted session: ${id}`);
    }

    async list(): Promise<SessionState[]> {
        return Array.from(this.sessions.values());
    }
}

// ============================================================================
// Durable Object Session Storage
// ============================================================================

/**
 * SessionsDurableObject - Cloudflare Durable Object for session storage.
 * 
 * Uses the Durable Object's built-in storage (key-value) for persistence.
 * Sessions are stored as JSON strings with the session ID as the key.
 */
export class SessionsDurableObject {
    constructor(
        private readonly ctx: DurableObjectState,
        private readonly env: Env
    ) {}

    /**
     * Create a new session.
     */
    async create(session: SessionState): Promise<void> {
        await this.ctx.storage.put(`session:${session.id}`, JSON.stringify(session));
        console.log(`[SessionsDO] Created session: ${session.id}`);
    }

    /**
     * Load a session by ID.
     */
    async load(id: string): Promise<SessionState | null> {
        const data = await this.ctx.storage.get(`session:${id}`);
        
        if (!data) {
            console.log(`[SessionsDO] Session not found: ${id}`);
            return null;
        }

        try {
            const session = JSON.parse(data as string) as SessionState;
            console.log(`[SessionsDO] Loaded session: ${id}`);
            return session;
        } catch (error) {
            console.error(`[SessionsDO] Failed to parse session ${id}:`, error);
            return null;
        }
    }

    /**
     * Save/update a session.
     */
    async save(session: SessionState): Promise<void> {
        await this.ctx.storage.put(`session:${session.id}`, JSON.stringify(session));
        console.log(`[SessionsDO] Saved session: ${session.id}`);
    }

    /**
     * Delete a session.
     */
    async delete(id: string): Promise<void> {
        await this.ctx.storage.delete(`session:${id}`);
        console.log(`[SessionsDO] Deleted session: ${id}`);
    }

    /**
     * List all sessions (for debugging/admin purposes).
     */
    async list(): Promise<SessionState[]> {
        const keys = await this.ctx.storage.list({ prefix: 'session:' });
        const sessions: SessionState[] = [];

        for (const [key, value] of keys) {
            try {
                const session = JSON.parse(value as string) as SessionState;
                sessions.push(session);
            } catch (error) {
                console.error(`[SessionsDO] Failed to parse session ${key}:`, error);
            }
        }

        return sessions;
    }
}

// ============================================================================
// Durable Object Stub Factory
// ============================================================================

/**
 * Get a SessionsDurableObject stub for a given session ID.
 */
export function getSessionsStub(env: Env, sessionId: string): DurableObjectStub {
    const id = env.SESSIONS_DO.idFromName(sessionId);
    return env.SESSIONS_DO.get(id);
}

// ============================================================================
// Storage Factory
// ============================================================================

/**
 * Create an in-memory storage instance.
 * For DO-based storage, use getSessionsStub() and call methods directly.
 */
export function createInMemoryStorage(): SessionStorage {
    console.log('[SessionStorage] Using in-memory storage (development mode)');
    return new InMemorySessionStorage();
}

// ============================================================================
// Environment Type
// ============================================================================

export interface Env {
    /** Durable Object binding for sessions */
    SESSIONS_DO: DurableObjectNamespace;
}
