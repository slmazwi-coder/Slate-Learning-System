# SLATE Learning System — working notes

## Stack
- pnpm monorepo (`artifacts/*` = apps, `lib/*` = libs). Frontend `artifacts/slate-alis`
  (Vite+React+wouter+TanStack), backend `artifacts/api-server` (Express 5), Drizzle
  schema in `lib/db/src/schema/slate.ts`.

## Local verification
- pnpm `run`/`exec` fail locally if `pnpm-workspace.yaml` contains a valid-yaml but
  placeholder-valued `allowBuilds` block (deps status check exits 1 on
  ERR_PNPM_IGNORED_BUILDS). Keep `allowBuilds: esbuild: true` and it works.
- Direct binaries bypass the check: `./node_modules/.bin/tsc --build` (libs),
  `.../tsc -p tsconfig.json --noEmit` per artifact.
- Full prod build: `node ./vercel-build.mjs` (emits Build Output API to .vercel/output).
- Drizzle: `pnpm --filter @workspace/db run push` needs DATABASE_URL in env; use
  `push-force` to skip interactive prompts.
- Local E2E stack: `sudo dockerd &` + `postgres:16` container on port 5433, then run
  `node artifacts/api-server/dist/index.mjs` with DATABASE_URL / SESSION_SECRET /
  GEMINI_API_KEY (empty Gemini key → AI routes 502 gracefully; everything else works).

## Prod
- Live site https://slate-alis.vercel.app (GET / gives 200; API probe at /api/healthz).
- Vercel deploys from `main`; deploys are triggered on push to the default branch.
- Hitting driver's seat: schema changes are applied at request time by
  artifacts/api-server/src/lib/schema-bootstrap.ts (idempotent ALTER/CREATE), because
  drizzle-kit push can't run in the serverless env.

## Conventions
- Auth flows are cookie-session based; new account types mirror
  artifacts/api-server/src/lib/teacher-auth.ts pattern (parent-auth.ts, tutor-auth.ts).
- TIS class views are shared via artifacts/api-server/src/lib/class-views.ts so teacher
  and tutor dashboards read the same SQL shapes.
- Frontend test ids use `data-testid`; pages keep existing TIS header/nav patterns.
