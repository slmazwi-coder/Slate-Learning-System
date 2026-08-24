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
- Accounts were unified in `artifacts/api-server/src/lib/unified-auth.ts`: one
  `slate_users` identity per email with roles[] (TEACHER/PARENT/TUTOR), one
  `slate_user_sessions` table with `active_role`. The per-role auth libs
  (teacher-auth/parent-auth/tutor-auth) are thin wrappers over it — register/login
  routes in tis.ts/parent.ts/tutor.ts create a unified user via `createOrMergeUser`
  then a role profile row. `POST /api/auth/switch-role` flips `active_role`;
  `GET /api/auth/user` returns the unified session state.
- Legacy profile tables (`slate_teachers/parents/tutors`) remain because classes
  and learners FK to them — never drop them; `user_id` links profile → user.
- Tutor invitations: `slate_tutor_invitations` (PENDING → ACCEPTED), read-only
  "INVITED" scope on class access helpers in routes/tutor.ts.
- Marking modes live on `slate_assignments.marking_mode` (+auto_mark_questions int[]);
  `slate_submissions.marking_status` gates `GET /assignments/:id/review`.
- Per-learner question sets persist in `slate_assignment_sessions` — re-open always
  serves the stored set (no regen), extending expiry as needed.
- Activities engine reuses `slate_remediation_activities` (assignment_id null = engine row).
- Audit log writes go through `artifacts/api-server/src/lib/audit.ts`.
- Schema changes land in TWO places: the Drizzle schema in lib/db/src/schema/slate.ts
  AND idempotent statements in artifacts/api-server/src/lib/schema-bootstrap.ts.
- Class creation is GATED on the hardwired preset curriculum
  (`artifacts/api-server/src/lib/presets.ts` — CAPS Social Sciences Grades 4-6
  Geography/History today, growing 1 by 1 as documents are supplied). Only
  subjects in `slate_preset_curricula` can be created as classes; classes carry
  presetSubject + the preset lessonSequence, and the independent engine uses it.
  `GET /api/curriculum/presets` feeds the dropdowns.
- Learner subject-classrooms: `artifacts/api-server/src/lib/learner-classrooms.ts`
  assembles per-classroom stats (average, open/upcoming/missed, top gap, new
  assignments) + the home-dashboard analysis (per-subject attention flags,
  reminders, recommended activities). "Switching in/out" is client-side only
  (local state in `MyClassrooms` in artifacts/slate-alis/src/App.tsx).
- Teacher attendance lives on `learnerRows` in `lib/class-insights.ts`
  (`attendance: { daysActive7, daysActive30, daysSinceLastActive, inactive }`
  plus NOT_ATTENDING / NEVER_ATTENDED flags). ClassData loads assignment
  sessions so attendance counts opens too.
- Local bundle: `cd artifacts/api-server && node build.mjs` (the .bin/esbuild shim can
  become a raw ELF when build-scripts run; build.mjs uses the esbuild JS API).
- Frontend test ids use `data-testid`; pages keep existing TIS header/nav patterns.
