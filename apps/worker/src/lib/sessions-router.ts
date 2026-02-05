import {
    successResponse,
    errorResponse,
    StartSessionRequestSchema,
    TurnRequestSchema,
    EndSessionRequestSchema,
    QuizSubmitRequestSchema,
    type TtsPayload,
} from '@repo/shared';
import { SessionEngine } from './session-engine';
import { InMemorySessionStorage } from './sessions-durable-object';
import { executeTool, applyToolResultToSession } from './tools';
import { synthesizeSpeech } from './inworld-tts';

function generateRequestId(): string {
    return crypto.randomUUID();
}

export class SessionRouter {
    private engine: SessionEngine;
    private storage: InMemorySessionStorage;

    constructor(storage?: InMemorySessionStorage) {
        this.storage = storage ?? new InMemorySessionStorage();
        this.engine = new SessionEngine(this.storage);
    }

    // 1. Start Session
    async startSession(request: Request): Promise<Response> {
        const requestId = generateRequestId();
        try {
            const json = await request.json();
            const parseResult = StartSessionRequestSchema.safeParse(json);

            if (!parseResult.success) {
                // FIX: Pass .message (string) instead of the whole error object
                return new Response(JSON.stringify(errorResponse('Invalid body', parseResult.error.message)), { status: 400 });
            }

            const { scenarioId, levelId } = parseResult.data;
            const session = await this.engine.createSession(scenarioId, levelId);

            return new Response(
                JSON.stringify(successResponse({ session }, undefined, requestId)),
                { status: 200, headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId } }
            );
        } catch (err: any) {
            return new Response(JSON.stringify(errorResponse(err.message)), { status: 500 });
        }
    }

    // 2. Get Session
    async getSession(request: Request, sessionId: string): Promise<Response> {
        try {
            const session = await this.storage.load(sessionId);
            if (!session) {
                return new Response(JSON.stringify(errorResponse('Session not found')), { status: 404 });
            }
            return new Response(
                JSON.stringify(successResponse({ session })),
                { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
        } catch (err: any) {
            return new Response(JSON.stringify(errorResponse(err.message)), { status: 500 });
        }
    }

    // 3. Handle Turn
    async handleTurn(request: Request, env: any): Promise<Response> {
        const requestId = generateRequestId();
        const startTime = performance.now();

        try {
            const json = await request.json();
            const parseResult = TurnRequestSchema.safeParse(json);
            if (!parseResult.success) {
                // FIX: Pass .message (string)
                return new Response(JSON.stringify(errorResponse('Invalid body', parseResult.error.message)), { status: 400 });
            }

            const body: any = parseResult.data; 
            const textInput = body.text || body.userText; 

            // Process turn
            const processResult = await this.engine.processTurn(body.sessionId, textInput, env);
            
            // FIX: Removed 'decision' from destructuring. We get it from session.lastDecision
            const { session: updatedSession, llmMs, toolMs } = processResult;
            const decision = updatedSession.lastDecision;

            // Generate TTS
            let ttsResult: TtsPayload | null = null;
            let ttsMs = 0;

            // Check if decision exists and has text
            if (body.ttsEnabled && decision?.response?.text) {
                const ttsStart = performance.now();
                ttsResult = await synthesizeSpeech({
                    text: decision.response.text,
                    env: env
                });
                ttsMs = Math.round(performance.now() - ttsStart);
            }

            const totalMs = Math.round(performance.now() - startTime);

            return new Response(
                JSON.stringify(successResponse({
                    session: updatedSession,
                    decision,
                    tts: ttsResult || undefined,
                }, { llmMs, toolMs, ttsMs, totalMs }, requestId)),
                { status: 200, headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId } }
            );

        } catch (err: any) {
            return new Response(JSON.stringify(errorResponse(err.message)), { status: 500 });
        }
    }

    // 4. End Session
    async endSession(request: Request): Promise<Response> {
        try {
            const json = await request.json();
            const body = EndSessionRequestSchema.parse(json);
            const session = await this.storage.load(body.sessionId);
            
            if (!session) return new Response(JSON.stringify(errorResponse('Session not found')), { status: 404 });

            session.phase = 'completed';
            await this.storage.save(session);

            return new Response(JSON.stringify(successResponse({ session })), { status: 200 });
        } catch (err: any) {
            return new Response(JSON.stringify(errorResponse(err.message)), { status: 500 });
        }
    }

    // 5. Submit Quiz
    async submitQuiz(request: Request): Promise<Response> {
        try {
            const json = await request.json();
            const body = QuizSubmitRequestSchema.parse(json);
            
            const session = await this.storage.load(body.sessionId);
            if (!session) return new Response(JSON.stringify(errorResponse("Session not found")), { status: 404 });

            const toolResult = await executeTool('grade_quiz', {
                quizId: body.quizId,
                answers: body.answers,
                sessionId: body.sessionId
            }, { session });

            if (!toolResult.resultData.success) {
                return new Response(JSON.stringify(errorResponse(toolResult.resultData.message)), { status: 400 });
            }

            const updatedSession = applyToolResultToSession(session, 'grade_quiz', toolResult.resultData);
            await this.storage.save(updatedSession);

            return new Response(
                JSON.stringify(successResponse({
                    result: toolResult.resultData.data!.quizResult,
                    session: updatedSession,
                })),
                { status: 200 }
            );
        } catch (err: any) {
            return new Response(JSON.stringify(errorResponse(err.message)), { status: 500 });
        }
    }
}