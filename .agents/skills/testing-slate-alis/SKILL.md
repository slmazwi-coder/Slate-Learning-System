---
name: testing-slate-alis
description: How to end-to-end test the SLATE ALIS learner app (AI question generation, assignments, marking) against the deployed Vercel site or a local server.
---

# Testing SLATE ALIS

## Where the app runs
- Deployed frontend + serverless API: `https://slate-alis.vercel.app` (no local server needed).
- API health check: `curl https://slate-alis.vercel.app/api/healthz` → `{"status":"ok"}`. Check this first; if it is not ok, the Vercel env vars (`GEMINI_API_KEY`, `SESSION_SECRET`, `DATABASE_URL`) are likely missing/expired and AI calls will 502.

## Reaching the AI question generation flow (no test data setup needed)
Assignments are auto-seeded per request (`ensureSeedAssignments()` in `artifacts/api-server/src/routes/slate.ts`), so a brand-new learner immediately sees:
- "Fractions in the real world" (Mathematics · Equivalent fractions, 4 questions) — **OPEN**
- "Patterns and algebra" — MISSED, "The water cycle, close to home" — LOCKED

Steps:
1. Go to `/register`. Fields (testids): `input-username`, `input-full-name`, `input-grade` (defaults to 8), `input-school`, `input-password` (min 8 chars), subject chips `button-register-subject-*`, submit `button-register-submit`. Errors surface in `status-auth-error`. Success redirects straight to `/dashboard` (auto-login).
2. Sidebar → "Assignments" → click the "Fractions in the real world" card.
3. Click `button-open-assignment` ("Begin assignment"). **Gemini generation takes ~10-15 s** — wait at least 15 s before asserting. Errors render in `status-open-error` with the text "Your unique problem set could not be generated right now." (the 502 path).
4. Question view: `text-question-<id>` for prompts, `button-next-question` / `button-previous-question` to step, `button-question-N` for the segment dots, `button-submit-assignment` on the last question.
5. Sign out with `button-logout` in the sidebar to register a second learner for uniqueness comparison.

## Verifying uniqueness
Each open call passes a `uniquenessSeed` of `learnerId-Date.now()-random`, and prompts are personalised with the learner's **full name**. Give the two test learners clearly different full names (e.g. "Ayanda Test" / "Bongani Test") so the difference is instantly visible in Q1.

## Answer-key leakage (watch this)
`POST /api/assignments/:id/open` has two branches:
- new session → strips `answer` before responding (safe);
- **existing, unexpired session (re-open / "Continue assignment") → returns `existingSession.questions` verbatim, which INCLUDES `answer`.**
This may still be broken; always test *both* paths. Reproduce by opening an assignment, clicking "Back to assignments", re-entering the card and clicking the open button again, then inspecting the `open` request's Response tab in DevTools Network. A fix would be to strip `answer` in the existing-session branch too.

## Devin Secrets Needed
- None for UI testing against the deployed site. `GEMINI_API_KEY` is only needed if running the API server locally.
