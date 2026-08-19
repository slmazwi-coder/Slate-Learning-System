---
name: Gemini access
description: How this project reaches Google Gemini for learner intelligence.
---

SLATE ALIS uses the `@google/generative-ai` SDK with the project's secure `GEMINI_API_KEY` secret. All AI work goes through `artifacts/api-server/src/lib/ai.ts`.

**Model:** `gemini-2.5-flash` by default, overridable with `GEMINI_MODEL`. `gemini-1.5-flash` is not available to this API key — Google returns 404 for the 1.5 models on newer keys.

**How to apply:** Keep the key server-side only, use the existing AI helper, and do not expose it in frontend code or logs.
