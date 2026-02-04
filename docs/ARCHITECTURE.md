# Architecture Documentation

## Overview
This monorepo follows the "Option 1" pipeline: STT -> LLM -> TTS, orchestrated by Cloudflare Workers.

## Structure
- `apps/ui`: React + Vite frontend. Hosted on Cloudflare Pages.
- `apps/worker`: Cloudflare Worker. Handles API requests, session state, and AI orchestration.
- `packages/shared`: Shared TypeScript types and Zod schemas.

## Data Flow
1. **User Input:** User speaks or types in the UI.
2. **Request:** UI sends input to `apps/worker` endpoints.
3. **Processing:** Worker validates input using `shared` schemas.
4. **AI Decision:** Worker calls OpenAI API for teacher decision.
5. **Response:** Worker returns decision/audio to UI.
6. **State:** Session state is managed by the Worker (Durable Objects or D1 in future).

## API Contracts
- `/api/session/start`: POST. Starts a new session.
- `/api/session/turn`: POST. userText -> TeacherDecision.
- `/api/content/levels`: GET. Returns available levels.
- `/api/content/scenarios`: GET. Returns scenarios for a level.

## Content Pack
Content (levels, scenarios, personas, quizzes) is stored in `apps/worker/content/` as JSON files and validated against Zod schemas in `packages/shared` at build/runtime.
