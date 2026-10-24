# SLATE Learning System тАФ working notes

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
- `pnpm` is NOT on PATH in a fresh sandbox shell (`pnpm: command not found`), but
  `corepack pnpm ...` works and downloads the pinned version. `pnpm run ci` from a
  package script still fails with `sh: pnpm: not found`, so run typecheck/tests via
  the direct binaries (`./node_modules/.bin/tsc`, `vitest`) or `corepack pnpm`.
- Full prod build: `node ./vercel-build.mjs` (emits Build Output API to .vercel/output).
- Drizzle: `pnpm --filter @workspace/db run push` needs DATABASE_URL in env; use
  `push-force` to skip interactive prompts.
- Local E2E stack: `sudo dockerd &` + `postgres:16` container on port 5433, then run
  `node artifacts/api-server/dist/index.mjs` with DATABASE_URL / SESSION_SECRET /
  GEMINI_API_KEY (empty Gemini key тЖТ AI routes 502 gracefully; everything else works).
- `tsx` is not installed, so to run a one-off TypeScript probe use esbuild with
  `--format=cjs`: bundling to `--format=esm` fails with "Dynamic require of
  events is not supported" via pg.
- The docker CLI needs `sudo` even after the daemon starts; the postgres user must
  match the DATABASE_URL (`postgres://slate:slate@localhost:5433/slate`).
- Preset runtime verification: `GET /api/curriculum/presets` reflects
  `PRESET_CURRICULA`, and `syncPresetCurricula` runs from `ensureSchema()` on the
  first request тАФ so a server restart re-upserts and repairs tampered rows.
- `presets.ts` is not prettier-clean at HEAD; `prettier --check` warns on it
  regardless of your diff. There is no prettier config file and no prettier step
  in CI (`.github/workflows/deploy.yml` runs only `pnpm run typecheck`), so do
  NOT run `prettier --write` on it — that reformats ~131 unrelated lines. Trap:
  prettier silently reports "All matched files use Prettier code style!" for any
  path under a `tmp` directory, because this repo's `.gitignore` contains `tmp`;
  never validate formatting via a `/tmp` scratch copy, copy the file into the
  repo (or a non-ignored dir) first or you will get a false pass.

## Tests and CI
- Tests live in `artifacts/api-server/src/test/` and run with vitest
  (`artifacts/api-server/vitest.config.ts`: `include: src/**/*.test.ts`,
  `fileParallelism: false` because the suites share one Postgres schema).
  Run them with `./node_modules/.bin/vitest run --config vitest.config.ts` from
  `artifacts/api-server`, or `pnpm test` / `pnpm run ci` from the root.
- The suites are integration tests: `src/test/harness.ts` boots the REAL Express
  app on an ephemeral port with a cookie-aware fetch client, and
  `src/test/fixtures.ts` builds every actor through the public HTTP API
  (`registerTeacher`/`registerLearner`/`registerParent`/`registerTutor`,
  `createPublishedAssignment`, `submitAssignment`). They need a live Postgres —
  the same `postgres:16` on 5433 as local E2E, schema pushed with drizzle-kit —
  and `src/test/setup.ts` points `TEST_DATABASE_URL`/`DATABASE_URL` at it,
  supplies `SESSION_SECRET` and sets `LOG_LEVEL=silent`.
- A full run truncates tables between tests (`resetDatabase`), so never point
  `TEST_DATABASE_URL` at anything but a scratch database.
- `.github/workflows/ci.yml` runs `pnpm run ci` (typecheck + tests) on every push
  and PR, provisioning `postgres:16` on 5433 as a service and pushing the schema
  first. It is a second workflow alongside `deploy.yml` (which stays manual).
- Mocking the AI: `lib/ai.ts` exposes `setGeminiModelForTesting(model)` and
  `setGeminiSleepForTesting(fn)`. A fake model needs only
  `generateContent(parts) => ({ response: { text: () => json } })`; the marking
  prompts embed the question ids as `"id":"…"`, so a fake can echo them back.
  `setGeminiSleepForTesting(async () => {})` removes the real backoff delays.
- To assert on logs, mock the `pino` module itself with a factory that drops
  `transport` (pino-pretty otherwise spawns a worker and writes to the console)
  and passes an in-memory destination; `pino-http` derives a per-request child
  from that instance, so every route log line is captured. See
  `src/test/security.test.ts`.

## HostAfrica integration
- `lib/hostafrica` (`@workspace/hostafrica`) is a typed fetch client for the HostAfrica
  public API (https://api.hostafrica.com/docs/, spec "HostAfricaApi" v1.1.0). Every
  endpoint is `POST` + JSON with `Authorization: Bearer <token>`; responses are
  `{status, data, message}` and the client unwraps `data` or throws `HostAfricaError`
  (`httpStatus` null on network failure). The API covers DNS zones/records, domains
  (details, contacts, nameservers, settings, DNSSEC, availability), billing
  (invoices) and VPS тАФ there are NO shared-hosting/product-settings endpoints.
- Env: `HOSTAFRICA_API_TOKEN` (account-privileged; server/CLI only, never a
  `VITE_*` var, never committed тАФ lives in local `.env` and the slate-alis Vercel
  project) and `HOSTAFRICA_ADMIN_EMAILS` (comma-separated emails of signed-in users
  allowed to hit the admin routes). Rotate/revoke the token in the Client Area
  (https://panel.hostafrica.com тЖТ API settings).
- CLI: `HOSTAFRICA_API_TOKEN=тАж pnpm --filter @workspace/scripts run hostafrica <cmd>`
  (`scripts/src/hostafrica.ts`; run `help` for the list тАФ `domains`, `zones`,
  `zone <domain>`, `invoices`, `dns add|edit|delete`, `nameservers`, `setting`).
  Locally (no tsx) bundle it with `esbuild scripts/src/hostafrica.ts --bundle
  --platform=node --format=cjs --outfile=/tmp/ha-cli.cjs`.
- Admin API (`artifacts/api-server/src/routes/hostafrica.ts`, under `/api/admin/hostafrica`):
  GET `domains`, `domains/:id`, `domains/:id/contacts`, `dns/zones`, `dns/zones/:domainId`,
  `billing/invoices`, `billing/invoices/:id`; POST/PUT/DELETE `dns/records`
  (`{zone_id, domain_name?, record}`), PUT `domains/:id/nameservers`, PUT
  `domains/:id/settings` (`{setting, value}`). Gate is `requireHostAfricaAdmin`
  (401 unauthenticated, 403 not allow-listed, 503 token missing); mutations write
  `hostafrica_*` rows via `recordAudit`. Upstream 4xx are relayed, other failures тЖТ 502.
- DNS gotchas: `zone_id` (for record mutations) тЙа `domain_id` (for get-zone); delete
  needs the full record (name/type/content), not just `id`; mutation responses return
  `records: []`, so re-read the zone to confirm.

## Locked curriculum, result release, privacy
- CAPS is read-only: the teacher/parent curriculum upload routes are gone. Classes
  always resolve their sequence through `resolvePresetForClass` /
  `presetSequenceForGrade` (`lib/presets.ts`). `slate_classes.curriculum_archive`
  keeps the text of any class that previously had an uploaded curriculum;
  `lockClassesToPresetCurricula()` (called from `ensureSchema()` alongside
  `syncPresetCurricula`) resets such a class to the matching preset and archives
  the old text — idempotent, never deletes.
- The lock is guarded by a MARKER, not by comparing content: `curriculum_locked_at`
  is set once (at class creation, and by the migration). Do NOT go back to
  "alreadyLocked = stored sequence equals the preset sequence" — `presets.ts` grows
  as CAPS documents are added, so every preset edit would re-run the lock over live
  classes and (with the old `currentTopicIndex: 0`) silently send a class half-way
  through the year back to topic 1. The migration now resets pacing ONLY when it is
  actually archiving an owner-uploaded curriculum; otherwise it carries the index
  forward, clamped to the new sequence length (`Math.max(0, Math.min(index, len-1))`)
  so a shrunk preset cannot overflow it either. Tests in
  `src/test/curriculum-lock.test.ts` cover both, and fail if the content-based check
  or the unconditional reset returns.
- A tutor's own programme is NOT a
  curriculum: `POST /tutor/classes/:classId/programme` stores it in
  `slate_class_materials`, and `loadSupplementaryMaterial` in `routes/tis.ts`
  feeds it to Gemini as reference only while the preset still drives pacing.
- Result release: `resultReleasePolicy` stays `after_close | immediate`, and
  `POST /tis/assignments/:assignmentId/release-results` (`{action: release|hold}`)
  writes `results_released_at` / `results_held_at` and an audit row
  (`results_release` / `results_hold`). `lib/result-release.ts`
  (`resultsReleased`, `teacherReleaseState`) is the single gate — it is applied to
  the learner review route, the dashboard average, the activity feed, the
  classroom analysis and the parent dashboard/history. A submission only shows a
  mark when `markingStatus === "MARKED"` AND `resultsReleased(...)`.
- Marking reliability: `lib/ai.ts` marks at temperature 0.2 (generation keeps 1.0)
  and every Gemini call has a 30s timeout + 2 retries with 2s/4s backoff; when all
  retries fail the submission is still saved with `markingStatus "MARKING_FAILED"`
  (`lib/marking-retry.ts` re-marks it from a background job or the next teacher
  view of the class overview). Teacher override is `POST /tis/submissions/:id/mark`,
  audited as `marking_override` and folded into the learner's concept gaps +
  learning profile via `applyConceptOutcomes`.
- AI drafts: an assignment whose `questionSource !== "manual"` is flagged
  `aiDraft` in the teacher preview, and publishing one in Teacher-Dependent mode
  needs `confirmAiDraft: true` (400 + `requiresAiDraftConfirmation` otherwise).
- POPIA: `lib/privacy.ts` holds `PRIVACY_NOTICE_VERSION` / `CONSENT_SUMMARY` and
  is served at `GET /api/privacy-notice` (public); the SPA page is `/privacy`.
  Parent- and tutor-created children must send `consent: true` or the request is
  400. Consent version + timestamp are stored on `slate_learners`
  (`consent_version`, `consent_at`). Parents export a child as JSON
  (`GET /parent/learners/:id/export`) and delete one with everything linked
  (`DELETE /parent/learners/:id`), both 404 for another parent's child.
- Security: `lib/rate-limit.ts` is an in-memory sliding window applied to every
  login/register/password-reset route per IP and per username, with a lockout
  message that never reveals whether an account exists. CORS is an allow-list
  from `ALLOWED_ORIGINS` (defaults: www.slate-alis.co.za, slate-alis.co.za,
  slate-alis.vercel.app, plus any `*.vercel.app` preview); helmet is on and the
  JSON body is capped at 8 MB. Never log answer text or uploaded document
  content — log ids and outcomes only.

## Prod
- Live site https://slate-alis.vercel.app (GET / gives 200; API probe at /api/healthz).
- HostAfrica static hosting: one workflow `.github/workflows/deploy.yml` builds the
  frontend and FTPS-uploads `artifacts/slate-alis/dist/public/` to `public_html/`
  on `da20.host-ww.net` (the FTP cert is only valid for that hostname; the IP
  `102.210.146.74` fails verification). `private_html` is a symlink to
  `public_html`, so never deploy to both. A second byte-identical `main.yml` used
  to run on every push тАФ keep exactly one workflow.
- HostAfrica can only serve static files: `.htaccess` rewrites work (incl.
  `Header`, `[P]` reverse-proxy needs proxy modules and returns 500), but there is
  no Node/SSH/cPanel access over the supplied FTP account, so the Express API
  cannot run there тАФ `public_html/.htaccess` deliberately passes `/api` through so
  those calls 404 rather than silently returning the SPA HTML with a 200.
  `artifacts/slate-alis/public/.htaccess` ships the SPA fallback and a dotfile
  deny (the FTP deploy sync-state file is otherwise web-readable).
- `slate-alis.co.za` / `www` are custom domains on the Vercel project, so the
  domain serves the SPA *and* `/api` (HostAfrica static hosting cannot, which is
  why the subject dropdown was empty there). Apex A тЖТ `216.198.79.1`, `www`
  CNAME тЖТ `b89951102ccee9f5.vercel-dns-017.com` (the per-project target from
  `GET https://api.vercel.com/v6/domains/<domain>/config`).
- Two HostAfrica nameserver sets exist and only one is editable by API: the
  registrar delegated the domain to `dan1/dan2.host-ww.net` (the DirectAdmin
  hosting zone, not exposed by the public API), while the DNS-manager zone the
  API edits is served by `ns1-4.host-ww.net`. Editing zone `43231` therefore had
  no effect until `setting <domain> dnsmanagement true` + `nameservers <domain>
  ns1..ns4.host-ww.net` moved the delegation onto it. Always confirm against the
  registry (`NS` at `coza1.dnsnode.net`), not just the zone listing.
- Mail/FTP were CNAMEs onto the apex, so repointing the apex at Vercel would
  have taken them with it: `mail` and `ftp` are now A records on
  `102.210.146.74` and the `MX` points at `mail.slate-alis.co.za`.
- Record ids in the HostAfrica zone are renumbered after every mutation, and
  `dns edit` on a CNAME fails with "already has a CNAME record" тАФ delete and
  re-add, re-reading the zone between calls.
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
  button, or 16px on a 36px button, is half the height тЖТ a full pill/circle. Use a
  radius well under half the height (`rounded-[10px]` on `h-9`, `rounded-lg` on
  `h-10`) for the "rectangular with smooth roundish corners" look.
- Raw `<button>`s in App.tsx bypass the shared `Button` component, so they miss its
  `whitespace-nowrap` тАФ add it (plus `shrink-0`) explicitly or labels wrap to two
  lines and overflow a fixed-height box at тЙд ~370px.
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
  (teacher-auth/parent-auth/tutor-auth) are thin wrappers over it тАФ register/login
  routes in tis.ts/parent.ts/tutor.ts create a unified user via `createOrMergeUser`
  then a role profile row. `POST /api/auth/switch-role` flips `active_role`;
  `GET /api/auth/user` returns the unified session state.
- Legacy profile tables (`slate_teachers/parents/tutors`) remain because classes
  and learners FK to them тАФ never drop them; `user_id` links profile тЖТ user.
- Tutor invitations: `slate_tutor_invitations` (PENDING тЖТ ACCEPTED), read-only
  "INVITED" scope on class access helpers in routes/tutor.ts.
- Marking modes live on `slate_assignments.marking_mode` (+auto_mark_questions int[]);
  `slate_submissions.marking_status` gates `GET /assignments/:id/review`.
- Per-learner question sets persist in `slate_assignment_sessions` тАФ re-open always
  serves the stored set (no regen), extending expiry as needed.
- Activities engine reuses `slate_remediation_activities` (assignment_id null = engine row).
- Audit log writes go through `artifacts/api-server/src/lib/audit.ts`.
- Schema changes land in TWO places: the Drizzle schema in lib/db/src/schema/slate.ts
  AND idempotent statements in artifacts/api-server/src/lib/schema-bootstrap.ts.
- Class creation is GATED on the hardwired preset curriculum
  (`artifacts/api-server/src/lib/presets.ts` тАФ Foundation Phase Gr R-3
  (Mathematics, Life Skills, Home Languages English/Afrikaans/Sesotho/isiXhosa/
  isiZulu, and English/Afrikaans/isiXhosa FAL Gr 1-3), Intermediate Phase Gr 4-6
  (Mathematics, Life Skills, the four Home Languages, English First Additional
  Language, Natural Sciences and Technology, Social Sciences Geography/History),
  Senior Phase Gr 7-9 (five Home Languages Afrikaans/English/Sesotho/IsiZulu/
  IsiXhosa, English FAL, Mathematics, Life Orientation, Natural Sciences, Social
  Sciences History/Geography, Economic and Management Sciences, Creative Arts,
  Technology)
  and the Stadio modules, growing as documents are supplied). Grade R is stored
  as grade 0 (`GRADE_R`) and Stadio as 13; `gradeName` labels both. Multi-grade
  preset sequences prefix each topic with its grade ("Grade 2 ┬╖ ", "IBanga 2 ┬╖ ")
  and `presetSequenceForGrade` scopes the copied lessonSequence to the class
  grade. A subject may also appear once per phase (Life Skills and Mathematics
  are FP R-3 and IP 4-6) тАФ `presetForSubject` picks by grade, so phase ranges
  must not overlap.
  The Senior Phase (Gr 7-9) is complete for the core CAPS subjects: `SENIOR_PHASE`
  holds the five Home Languages, English FAL, Mathematics, Life Orientation,
  Natural Sciences, Social Sciences History/Geography, Economic and Management
  Sciences, Creative Arts and Technology. `phase` is a free-text column, not an enum, and no
  code outside `presets.ts` switches on the phase value тАФ the frontend dropdown
  is driven entirely by `GET /api/curriculum/presets` filtered on the grade
  range, so adding a phase needs no schema, route or UI change. Afrikaans
  Huistaal and English Home Language are each shared by three phases
  (FP 0-3, IP 4-6, SP 7-9); those labels are the case to re-check when adding
  entries, since overlapping ranges would silently serve the wrong curriculum.
  Senior Phase language presets follow the IP language shape: each topic is
  prefixed with its grade and CAPS skill strand ("Graad 7 ┬╖ Luister en praat: тАж",
  "Grade 7 ┬╖ Listening and speaking: тАж", "Lees en kyk"/"Reading and viewing",
  "Skryf en aanbied"/"Writing", "Taalstrukture"/"Language structures"). The SP
  teaching plans run in two-week cycles across four columns, so each preset
  topic merges the cycles for one strand rather than emitting one topic per
  cycle (English HL: 18/23/26 topics for Gr 7/8/9, Afrikaans 14/18/18).
  The CAPS SP Huistaal teaching-plan tables are upright (unlike the IP Afrikaans
  tables, which are rotated 90┬░) but their four skill columns interleave in
  reading order, so pypdf output must be read column-by-column rather than
  linearly.
  SP non-language subjects follow the IP term/content-area shape ("Grade 8 ┬╖
  Term 3 Mechanical systems and control: тАж"), because CAPS spreads each content
  area over one or more terms тАФ Social Sciences History/Geography label the term
  explicitly, Natural Sciences label the CAPS strand (Life and Living, Matter and
  Materials, Energy and Change, Planet Earth and Beyond), and Technology labels
  its four content areas (Structures, Processing, Mechanical systems and control,
  Electrical/Electronic systems and control) which run across every grade. The
  SP Technology topics come from the CAPS Section 3 progress map (Gr 7: 5, Gr 8: 4,
  Gr 9: 4 topics).
  Subjects with several study areas (IP Life Skills: PSW, Physical Education,
  Creative Arts) label each topic with its area and term after the grade prefix
  ("Grade 4 ┬╖ Term 1 PSW: тАж") so the scoping filter still works. A subject whose
  content areas run in parallel across a term (IP Mathematics: Numbers/Operations/
  Relationships, Patterns/Functions/Algebra, Space and Shape, Measurement, Data
  Handling) instead labels each topic with its term(s) then content area
  ("Grade 5 ┬╖ Term 1 Measurement: тАж"); CAPS spreads one content area over several
  terms, so those topics carry the full span ("Terms 1 and 3") and are listed once
  to avoid duplicate topics in a class sequence. IP language presets (Home
  Languages, English HL, English FAL) instead label each topic with its CAPS
  skill strand after the grade prefix ("Grade 4 ┬╖ Listening and speaking: тАж",
  "Reading and viewing", "Writing", "Language structures"), 16-17 topics per
  grade. Only subjects in `slate_preset_curricula` can be created as classes;
  classes carry
  presetSubject + the preset lessonSequence, and the independent engine uses it.
  `GET /api/curriculum/presets` feeds the dropdowns.
  The FET Phase (Gr 10-12) is complete against the DBE CAPS page
  (https://www.education.gov.za/Curriculum/CurriculumAssessmentPolicyStatements(CAPS).aspx,
  "Nonlanguages in English" list): 38 non-language subjects plus 8 languages
  (five Home Languages English/Afrikaans/Sesotho/isiXhosa/isiZulu, English and
  Afrikaans FAL, isiXhosa FAL). Afrikaans-medium duplicates are deliberately
  omitted; where a subject has both, the English doc is used. The DBE page
  lists History only under the Afrikaans heading ("Geskiedenis (History)"),
  whose file is the Afrikaans `GESKIEDENIS GRADES 10-12` doc, but the English
  `HISTORY GRADES 10-12` CAPS doc is published under a separate ticket and is
  what the preset uses. DBE page labels are unreliable: "Agricultural Science"
  is plural-less on the page while the CAPS doc itself titles the subject
  `AGRICULTURAL SCIENCES` (which the preset follows), and the "Design Studies"
  link serves the `DESIGN` doc.
  FET topics follow the SP shape but per grade, since each FET subject doc is
  one Grades 10-12 document: language presets label the CAPS skill strand
  ("Grade 10 · Listening and speaking: …"), content subjects label the CAPS
  topic/strand ("Grade 10 · Life at molecular, cellular and tissue level: …",
  "Grade 11 · The atmosphere: …"). Topics merge the term columns for one
  topic, so a subject yields ~12-37 topics total across the three grades and
  `presetSequenceForGrade` narrows a class to its own grade. FET ranges
  (10-12) do not overlap SP (7-9), so `presetForSubject` stays unambiguous.
  The DBE page lists both a "Civil/Electrical/Mechanical Technology" doc and a
  separate "Technical: Civil/Electrical/Mechanical Technology" doc (the
  three-stream versions), so all six are presets. Several FET CAPS PDFs render
  mirrored/reversed glyphs (e.g. `YGOLONHCET LIVIC`), so text extraction must
  reverse each line.
- Route schemas validate the posted subject against `PRESET_SUBJECT_MAX_LENGTH`
  (derived from the catalog in `presets.ts`), NOT a fixed cap. The longest preset
  label is 68 chars, so a hardcoded `.max(60)` silently rejected valid subjects
  with "Choose a grade and subject for the class." before the gate ran тАФ apply the
  derived constant in tis.ts / parent.ts / tutor.ts when adding long subject names.
- Learner subject-classrooms: `artifacts/api-server/src/lib/learner-classrooms.ts`
  assembles per-classroom stats (average, open/upcoming/missed, top gap, new
  assignments) + the home-dashboard analysis (per-subject attention flags,
  reminders, recommended activities). "Switching in/out" is client-side only
  (local state in `MyClassrooms` in artifacts/slate-alis/src/App.tsx).
  The learner classroom page is a full-bleed environment at `/classroom/:classId`
  (`ClassroomPage` in App.tsx): subject hero + average/live/upcoming/missed
  counters, then Live work, Upcoming work and Study material sections. Clicking a
  live/upcoming row embeds the assignment detail in place (no route change) with a
  "Back to classroom" link; the standalone detail's back link returns to the
  classroom. Materials come from `slate_class_materials` (kind NOTE/REVISION/
  QUIZ/DEMONSTRATION) and are separate from assignments; teachers manage them in
  the "Study material тАФ Manage" panel on `/teacher/classes`. Teacher-facing
  `classroomStatsForLearner` MUST filter `assignmentsTable.isPublished = true` тАФ
  otherwise a teacher's unpublished drafts show up as openable "live work" on the
  learner dashboard and 404 when clicked (`getAssignmentForLearner` rejects
  unpublished rows).
- Teacher attendance lives on `learnerRows` in `lib/class-insights.ts`
  (`attendance: { daysActive7, daysActive30, daysSinceLastActive, inactive }`
  plus NOT_ATTENDING / NEVER_ATTENDED flags). ClassData loads assignment
  sessions so attendance counts opens too.
- Local bundle: `cd artifacts/api-server && node build.mjs` (the .bin/esbuild shim can
  become a raw ELF when build-scripts run; build.mjs uses the esbuild JS API).
- Frontend test ids use `data-testid`; pages keep existing TIS header/nav patterns.
- Parent-created children ARE real learner accounts: `createFamilyLearner` inserts a
  `slate_learners` row (parent-chosen or generated username/password, optional email)
  and links it via `slate_parent_learners`; the legacy `parent_id` column is kept and
  `parentLearnerRows()` unions both so pre-link rows still show. Username is unique;
  email is NOT (siblings share a parent's address) тАФ `DROP INDEX IF EXISTS
  slate_learners_email_unique` is idempotent. `normalizeUsername` strips spaces.
- Learner login/logout usage: `slate_learner_sessions` (loginAt/lastSeenAt/logoutAt/
  durationMinutes) is written by `lib/learner-activity.ts` from `createSession` /
  `destroySession` / `getCurrentLearner` (heartbeat). 30-min idle closes a visit at
  lastSeenAt; a 12h stale sweep runs when the parent reads activity. Parent view reads
  `GET /parent/learners/:id/activity` (today/week bar/recent 10/month).
- Shared marked script: `lib/marked-script.ts` `buildMarkedScript()` is the single
  source for per-question prompt/answer/verdict/correct answer/score/feedback; served
  read-only at `GET /parent/learners/:id/assignments/:aid/script` and
  `/assignments/:aid/review`, editable at `GET /tis/submissions/:sid/script` and
  `/tis/classes/:cid/learners/:lid/assignments/:aid/script` (gated by
  `teacherOwnsSubmission` / `teacherTeachesLearner`). Frontend
  `components/marked-script.tsx` renders all four (learner review, teacher, parent).
- Shared-email recovery: `POST /auth/recover/lookup` lists every account reachable
  through an address тАФ learners whose own email matches, learners whose address lives
  only on their unified identity (pre-fix self-registration) or on a parent holding
  the address (relationship table and legacy `parent_id`), plus the parent/teacher/
  tutor identities themselves. Each entry carries `kind` + name; `POST
  /auth/recover/reset` takes `kind` + username. A learner is matched by email+username,
  with username-only fallback for parent-linked/identity-only children; adults reset
  their unified `slate_users` password by profile email. UI at `/recover`, linked from
  the learner, parent, teacher and tutor login screens. Parent reset of a child is
  `POST /parent/learners/:id/reset-password` (returns the new password once).
  Gotcha: recovery used to key only on `learners.email`, so a parent-created child
  with the optional email left blank (`email = NULL`) reported as "doesn't exist"
  even though the row was fine тАФ always resolve an address through the learner row,
  its `user_id` identity AND its parent link.
- Frontend prod build needs env: `PORT` and `BASE_PATH` (vite throws without them);
  full prod build is `node ./vercel-build.mjs`.
- SLATE IDs: `lib/slate-id.ts` issues a permanent, per-type ID at creation тАФ
  `L`/`TE`/`P`/`TU` + 6-digit sequence (`L000482`), from one Postgres sequence per
  type (`slate_{learner,teacher,parent,tutor}_id_seq`). `generateSlateId(kind)` takes
  `nextval` then re-checks uniqueness (the column's unique index is the final guard);
  `backfillSlateIds()` (run from `ensureSchema()`) fills legacy NULL rows ordered by
  `created_at, id`, then `advanceCounterPastExisting` bumps the sequence past any
  already-used number so a later mint cannot collide. Every account-insert path must
  pass `slateId: await generateSlateId(kind)` тАФ the 5 sites are learner self-register
  (routes/slate.ts), `createFamilyLearner` (lib/family-learners.ts), teacher register
  (routes/tis.ts), parent register (routes/parent.ts) and tutor register
  (routes/tutor.ts). `slate_id` is nullable so the backfill can run; the Drizzle
  schema + `schema-bootstrap.ts` both add the column and a unique index. All four
  `toPublic*`/`publicFamilyLearner` serializers expose it, and the generated
  `Learner` type (api-spec тЖТ api-zod/api-client-react) carries `slateId`.
- Learner search: `GET /api/learners/search?q=` (routes/accounts.ts тЖТ `lib/slate-search.ts`)
  is gated to TEACHER/PARENT/TUTOR. A SLATE-ID-shaped query (`isSlateIdQuery`,
  `^(L|TE|P|TU)\d{3,}$`) is authoritative тАФ exact match, at most one result, no
  name fallback; anything else is an ILIKE `%term%` on full_name/username (up to 50,
  each card carrying its SLATE ID so namesakes can be told apart). `ensureSearchIndexes()`
  best-effort creates `pg_trgm` + a GIN trigram index on `full_name` (wrapped in
  try/catch so a restricted role only logs a warning); a plain btree on `full_name`
  cannot serve a leading-wildcard ILIKE. UI is the shared
  `components/slate-id.tsx` (`LearnerSearchPanel` + `SlateIdBadge`) used by the
  teacher class roster, parent dashboard and tutor learners page.
- Manual roster building: two interchangeable paths to the same `slate_class_learners`
  membership тАФ join code (`POST /classes/join`) or search-and-add
  (`POST /tis/classes/:cid/learners` тЖТ `enrollLearnerInClass`, which mirrors the join
  logic: one class per subject, learner subjects/grade kept in step). Removal is the
  existing `POST /tis/classes/:cid/expel` (`{memberId, memberType}`), which works for
  every member regardless of how they joined. Parents link/unlink an EXISTING learner
  with `POST /parent/learners/link` / `DELETE /parent/learners/:id/link`; tutors use
  `POST /tutor/learners/link` / `DELETE /tutor/learners/:id/link` (relationship
  table `slate_tutor_learners`, backfilled from the legacy `tutor_id`). Unlink/expel
  never delete the learner's account or work.
- Local E2E without a real Gemini key: start `postgres:16` on 5433, push the schema
  (`node lib/db/node_modules/drizzle-kit/bin.cjs push --force --config
  lib/db/drizzle.config.ts` тАФ the `.bin` shim is a raw ELF, run `bin.cjs` directly),
  build `artifacts/api-server` (`node build.mjs`), then run `dist/index.mjs`. The
  first request runs `ensureSchema()` (creating the base tables the bootstrap ALTERs
  assume); before that push, `/api/healthz` 500s with `relation "slate_classes" does
  not exist`. Learner self-register requires `schoolName` тЙе 2 chars, `age` 3-100,
  `gender` in boy/girl/other, and returns 201; `/classes/join` also returns 201.
- Assignment question sources: `POST /tis/assignments` `questionSource` is
  `ai` | `manual` | `pdf` | `scan` | `docx`. `scan` (`extractScannedAssignment` in
  lib/ai.ts) sends an inline image to Gemini vision and drafts questions from a
  photographed or handwritten page; `docx` (`extractDocumentAssignment`) extracts
  the visible text first — `lib/docx.ts` unzips `word/document.xml` with Node's
  built-in `zlib` (no archive dependency; both stored and deflated entries) — then
  drafts from that text, so a Word file is never sent to the model as a binary.
  `pdfBase64`/`imageBase64`/`documentBase64` are source-exclusive (superRefine
  rejects a mismatched payload). The frontend `TisNewAssignment` form has matching
  "Photograph a handwritten page" (`input-assignment-scan`, `accept="image/*"`) and
  "Extract from a Word document" (`input-assignment-docx`, `.docx` only) options,
  5 MB cap each. With no `GEMINI_API_KEY` the scan/docx path returns 502 before any
  draft is produced — that is the graceful failure, not a bug.
- Learner profile extras: `slate_learners.date_of_birth` (date), `home_language`,
  `province` (text) are edited through `PATCH /learners/me`
  (`UpdateLearnerProfileBody`); `toPublicLearner` emits them and the Profile page
  renders them. `dateOfBirth` crosses the wire as a date-only string (`format: date`
  in the OpenAPI, so the generated client and zod both use `string`) — do not build
  a `Date` on the client, and keep the server's `.toISOString().slice(0, 10)` write.
- "Five live testing issues" salvage: the branch `fix/five-live-testing-issues`
  holds only two commits — `cb72d8b` (FIX 1,4: schema-bootstrap ALTERs for
  `results_released_at` + the four learner profile columns) and `67223b7` (FIX 3:
  a 235-line `routes/tis-assignments.ts` + a `lib/document-parser.ts` that was
  never committed, so the branch does not compile). FIX 2 and FIX 5 were never
  written down anywhere — no commit, note, issue, or PR names them, and no PR was
  ever opened for the branch. FIX 1's behaviour already ships on `main` via
  `resultReleasePolicy` (`after_close` holds results until `closeAt`; enforced in
  routes/slate.ts + lib/learner-classrooms.ts), so only the profile fields and a
  Word (.docx) source were worth re-implementing — done natively rather than
  resurrecting the broken branch. Re-check `origin/fix/five-live-testing-issues`
  before assuming FIX 2/FIX 5 are recoverable.

