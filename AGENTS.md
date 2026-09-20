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
- `tsx` is not installed, so to run a one-off TypeScript probe use esbuild with
  `--format=cjs`: bundling to `--format=esm` fails with "Dynamic require of
  events is not supported" via pg.
- The docker CLI needs `sudo` even after the daemon starts; the postgres user must
  match the DATABASE_URL (`postgres://slate:slate@localhost:5433/slate`).
- Preset runtime verification: `GET /api/curriculum/presets` reflects
  `PRESET_CURRICULA`, and `syncPresetCurricula` runs from `ensureSchema()` on the
  first request — so a server restart re-upserts and repairs tampered rows.
- `presets.ts` is not prettier-clean at HEAD; `prettier --check` warns on it
  regardless of your diff.

## HostAfrica integration
- `lib/hostafrica` (`@workspace/hostafrica`) is a typed fetch client for the HostAfrica
  public API (https://api.hostafrica.com/docs/, spec "HostAfricaApi" v1.1.0). Every
  endpoint is `POST` + JSON with `Authorization: Bearer <token>`; responses are
  `{status, data, message}` and the client unwraps `data` or throws `HostAfricaError`
  (`httpStatus` null on network failure). The API covers DNS zones/records, domains
  (details, contacts, nameservers, settings, DNSSEC, availability), billing
  (invoices) and VPS — there are NO shared-hosting/product-settings endpoints.
- Env: `HOSTAFRICA_API_TOKEN` (account-privileged; server/CLI only, never a
  `VITE_*` var, never committed — lives in local `.env` and the slate-alis Vercel
  project) and `HOSTAFRICA_ADMIN_EMAILS` (comma-separated emails of signed-in users
  allowed to hit the admin routes). Rotate/revoke the token in the Client Area
  (https://panel.hostafrica.com → API settings).
- CLI: `HOSTAFRICA_API_TOKEN=… pnpm --filter @workspace/scripts run hostafrica <cmd>`
  (`scripts/src/hostafrica.ts`; run `help` for the list — `domains`, `zones`,
  `zone <domain>`, `invoices`, `dns add|edit|delete`, `nameservers`, `setting`).
  Locally (no tsx) bundle it with `esbuild scripts/src/hostafrica.ts --bundle
  --platform=node --format=cjs --outfile=/tmp/ha-cli.cjs`.
- Admin API (`artifacts/api-server/src/routes/hostafrica.ts`, under `/api/admin/hostafrica`):
  GET `domains`, `domains/:id`, `domains/:id/contacts`, `dns/zones`, `dns/zones/:domainId`,
  `billing/invoices`, `billing/invoices/:id`; POST/PUT/DELETE `dns/records`
  (`{zone_id, domain_name?, record}`), PUT `domains/:id/nameservers`, PUT
  `domains/:id/settings` (`{setting, value}`). Gate is `requireHostAfricaAdmin`
  (401 unauthenticated, 403 not allow-listed, 503 token missing); mutations write
  `hostafrica_*` rows via `recordAudit`. Upstream 4xx are relayed, other failures → 502.
- DNS gotchas: `zone_id` (for record mutations) ≠ `domain_id` (for get-zone); delete
  needs the full record (name/type/content), not just `id`; mutation responses return
  `records: []`, so re-read the zone to confirm.

## Prod
- Live site https://slate-alis.vercel.app (GET / gives 200; API probe at /api/healthz).
- HostAfrica static hosting: one workflow `.github/workflows/deploy.yml` builds the
  frontend and FTPS-uploads `artifacts/slate-alis/dist/public/` to `public_html/`
  on `da20.host-ww.net` (the FTP cert is only valid for that hostname; the IP
  `102.210.146.74` fails verification). `private_html` is a symlink to
  `public_html`, so never deploy to both. A second byte-identical `main.yml` used
  to run on every push — keep exactly one workflow.
- HostAfrica can only serve static files: `.htaccess` rewrites work (incl.
  `Header`, `[P]` reverse-proxy needs proxy modules and returns 500), but there is
  no Node/SSH/cPanel access over the supplied FTP account, so the Express API
  cannot run there — `public_html/.htaccess` deliberately passes `/api` through so
  those calls 404 rather than silently returning the SPA HTML with a 200.
  `artifacts/slate-alis/public/.htaccess` ships the SPA fallback and a dotfile
  deny (the FTP deploy sync-state file is otherwise web-readable).
- DNS mismatch (unresolved, needs HostAfrica/hosting action): `slate-alis.co.za`
  and `www` resolve to `169.239.180.4` / `ns1.host-ww.net`, which serves only a
  404 cPanel page and has no FTPS on :21; the deployed content lives on
  `102.210.146.74` / `da20`. Neither IP presents a cert valid for
  `slate-alis.co.za`. Verified with `--resolve slate-alis.co.za:443:102.210.146.74`.
- Vercel deploys from `main`; deploys are triggered on push to the default branch.
- The origin remote URL carries a stale embedded `ghu_...` token, so `git push`
  hangs on a password prompt. Set the remote with `$GITHUB_TOKEN`
  (`https://x-access-token:$GITHUB_TOKEN@github.com/...`) before pushing, then
  restore the plain URL afterwards. Vercel preview URLs are behind deployment
  protection (302), so verify on a local stack instead.
- Hitting driver's seat: schema changes are applied at request time by
  artifacts/api-server/src/lib/schema-bootstrap.ts (idempotent ALTER/CREATE), because
  drizzle-kit push can't run in the serverless env.

## Conventions
- Tailwind `rounded-*` on this app maps through `--radius: 1rem`, so `rounded-xl`
  = `calc(var(--radius) + 4px)` = 20px and `rounded-md`/`rounded-lg` resolve larger
  than the stock scale. Radius must be read against control HEIGHT: 20px on a 40px
  button, or 16px on a 36px button, is half the height → a full pill/circle. Use a
  radius well under half the height (`rounded-[10px]` on `h-9`, `rounded-lg` on
  `h-10`) for the "rectangular with smooth roundish corners" look.
- Raw `<button>`s in App.tsx bypass the shared `Button` component, so they miss its
  `whitespace-nowrap` — add it (plus `shrink-0`) explicitly or labels wrap to two
  lines and overflow a fixed-height box at ≤ ~370px.
- The `PublicShell` header keeps the logo and the Log in / Create account buttons on
  ONE row down to 320px, so the buttons are `h-9`/`text-xs`/`px-2`/`rounded-[10px]`
  on mobile and step up to `h-10`/`text-sm`/`px-4`/`rounded-lg` at `sm`. At 320px the
  `ChevronDown` is hidden (`hidden min-[360px]:block`) because logo (137px) + buttons
  (152px with chevron) + padding exceeds the 320px viewport and would wrap the group
  to a second row. Header padding is `px-4` on mobile (`sm:px-8`); widening it or the
  button padding re-triggers the wrap.
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
  (`artifacts/api-server/src/lib/presets.ts` — Foundation Phase Gr R-3
  (Mathematics, Life Skills, Home Languages English/Afrikaans/Sesotho/isiXhosa/
  isiZulu, and English/Afrikaans/isiXhosa FAL Gr 1-3), Intermediate Phase Gr 4-6
  (Mathematics, Life Skills, the four Home Languages, English First Additional
  Language, Natural Sciences and Technology, Social Sciences Geography/History),
  Senior Phase Gr 7-9 (Afrikaans Huistaal)
  and the Stadio modules, growing as documents are supplied). Grade R is stored
  as grade 0 (`GRADE_R`) and Stadio as 13; `gradeName` labels both. Multi-grade
  preset sequences prefix each topic with its grade ("Grade 2 · ", "IBanga 2 · ")
  and `presetSequenceForGrade` scopes the copied lessonSequence to the class
  grade. A subject may also appear once per phase (Life Skills and Mathematics
  are FP R-3 and IP 4-6) — `presetForSubject` picks by grade, so phase ranges
  must not overlap.
  The Senior Phase (Gr 7-9) now exists: `SENIOR_PHASE` holds Afrikaans Huistaal
  and English Home Language. `phase` is a free-text column, not an enum, and no
  code outside `presets.ts` switches on the phase value — the frontend dropdown
  is driven entirely by `GET /api/curriculum/presets` filtered on the grade
  range, so adding a phase needs no schema, route or UI change. Afrikaans
  Huistaal and English Home Language are each shared by three phases
  (FP 0-3, IP 4-6, SP 7-9); those labels are the case to re-check when adding
  entries, since overlapping ranges would silently serve the wrong curriculum.
  Senior Phase language presets follow the IP language shape: each topic is
  prefixed with its grade and CAPS skill strand ("Graad 7 · Luister en praat: …",
  "Grade 7 · Listening and speaking: …", "Lees en kyk"/"Reading and viewing",
  "Skryf en aanbied"/"Writing", "Taalstrukture"/"Language structures"). The SP
  teaching plans run in two-week cycles across four columns, so each preset
  topic merges the cycles for one strand rather than emitting one topic per
  cycle (English HL: 18/23/26 topics for Gr 7/8/9, Afrikaans 14/18/18).
  The CAPS SP Huistaal teaching-plan tables are upright (unlike the IP Afrikaans
  tables, which are rotated 90°) but their four skill columns interleave in
  reading order, so pypdf output must be read column-by-column rather than
  linearly.
  Subjects with several study areas (IP Life Skills: PSW, Physical Education,
  Creative Arts) label each topic with its area and term after the grade prefix
  ("Grade 4 · Term 1 PSW: …") so the scoping filter still works. A subject whose
  content areas run in parallel across a term (IP Mathematics: Numbers/Operations/
  Relationships, Patterns/Functions/Algebra, Space and Shape, Measurement, Data
  Handling) instead labels each topic with its term(s) then content area
  ("Grade 5 · Term 1 Measurement: …"); CAPS spreads one content area over several
  terms, so those topics carry the full span ("Terms 1 and 3") and are listed once
  to avoid duplicate topics in a class sequence. IP language presets (Home
  Languages, English HL, English FAL) instead label each topic with its CAPS
  skill strand after the grade prefix ("Grade 4 · Listening and speaking: …",
  "Reading and viewing", "Writing", "Language structures"), 16-17 topics per
  grade. Only subjects in `slate_preset_curricula` can be created as classes;
  classes carry
  presetSubject + the preset lessonSequence, and the independent engine uses it.
  `GET /api/curriculum/presets` feeds the dropdowns.
- Route schemas validate the posted subject against `PRESET_SUBJECT_MAX_LENGTH`
  (derived from the catalog in `presets.ts`), NOT a fixed cap. The longest preset
  label is 68 chars, so a hardcoded `.max(60)` silently rejected valid subjects
  with "Choose a grade and subject for the class." before the gate ran — apply the
  derived constant in tis.ts / parent.ts / tutor.ts when adding long subject names.
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
