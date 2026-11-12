<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:e6700fb9e6078319e6d46f2cd5a065b4724bc5f9af4bebb20fd4d60a523ae1dc -->

# Landing page claims and their evidence

This file lists every capability claim made on the public homepage
(`artifacts/slate-alis/src/pages/landing.tsx`) and the file that proves it.
A claim may appear on the page only if it is verified in the code below. The
render tests in `artifacts/slate-alis/src/pages/landing.test.tsx` assert that the
sections exist, that the links point where they say, that the role menus still
work, and that no real learner data appears.

Everything the page calls "Becoming" is not in the code today and is presented as
a roadmap item, never as a current capability. The demonstrations are React
components built with SAMPLE data; no screenshot, real learner name, answer, mark
or identifier is used anywhere on the page.

## Section 1 — Hero

| Claim | Evidence |
| --- | --- |
| "Every learner is different. Their learning system should be too." (positioning) | Product positioning; no capability claim. |
| "Free to use until January 2027." | Commercial statement supplied with this task; not a code claim. |
| "Schoolwork untangled." (tagline) | `artifacts/slate-alis/src/components/brand.tsx` (brand lockup; the tagline is used as page copy). |
| "Start free" / "See how it works" | Links to `/register` and the `#how-it-works` anchor; asserted in `landing.test.tsx`. |

## Section 2 — The problem

The problem statement is explanatory and makes no product claim. It describes
why a single pace cannot match a whole class; it does not claim a measured
improvement. No statistics or learning-outcome claims are made.

## Section 3 — The SLATE approach (learning, assessment, analysis, support)

| Claim | Evidence |
| --- | --- |
| A classroom per subject, with the next step chosen from where the class is. | `artifacts/api-server/src/lib/independent.ts` (`ensureIndependentAssignmentsForClass`, pace from the class average), `artifacts/api-server/src/lib/learner-classrooms.ts` (`learnerClassrooms`, `learnerClassroomDetail`). |
| Work is marked against a memorandum the teacher controls. | `artifacts/api-server/src/lib/memos.ts` (`saveMemo`, `memoReadiness`), `markAgainstMemo` in `artifacts/api-server/src/lib/ai.ts`, route `POST /tis/assignments/:assignmentId/memo` in `artifacts/api-server/src/routes/tis.ts`. |
| A marked script shows each answer and its marks. | `artifacts/api-server/src/lib/marked-script.ts` (`buildMarkedScript`), served at `/assignments/:id/review` and the teacher/parent script routes. |
| Results fold into class zones and concept gaps. | `artifacts/api-server/src/lib/zones.ts` (`computeClassZones`), `artifacts/api-server/src/lib/class-insights.ts` (`conceptStats`, `classGapAlert`). |
| A detected gap becomes a short, targeted activity. | `artifacts/api-server/src/lib/learner-classrooms.ts` (`learnerHomeAnalysis`, recommended activities), route `GET /activities/recommended` in `artifacts/api-server/src/routes/slate.ts`. |

## Section 4 — Learner experience

| Claim | Evidence |
| --- | --- |
| A subject classroom for every class joined. | `artifacts/slate-alis/src/App.tsx` (`ClassroomPage`, `/classroom/:classId`), `artifacts/api-server/src/lib/learner-classrooms.ts`. |
| A single "next focus" chosen from the learner's own gaps. | `artifacts/api-server/src/routes/slate.ts` (`GET /dashboard/summary`, `nextFocus: profile.activeGaps[0]`), `artifacts/api-server/src/lib/learning-profile.ts` (`activeGaps`). |
| A marked script with each answer and its marks. | `artifacts/slate-alis/src/components/marked-script.tsx`, `artifacts/api-server/src/lib/marked-script.ts`. |
| Live work, upcoming work and teacher study material in one place. | `artifacts/slate-alis/src/App.tsx` (`ClassroomPage`), `artifacts/api-server/src/routes/tis.ts` (`/tis/classes/:classId/materials`). |

## Section 5 — Teacher intelligence

| Claim | Evidence |
| --- | --- |
| Performance zones and class concept-gap alerts. | `artifacts/api-server/src/lib/zones.ts` (`computeClassZones`, `resolveZoneSettings`), `artifacts/api-server/src/lib/class-insights.ts` (`classGapAlert`), route `GET /tis/classes/:classId/zones`. |
| Memo-based marking with a printable red-pen script. | `artifacts/api-server/src/lib/memos.ts`, `artifacts/api-server/src/lib/script-export.ts` (the red-pen sheet carries the learner's answers and marks only, never the memorandum), routes `/tis/submissions/:id/script/print` and `/tis/assignments/:id/scripts/print`. |
| Head-of-department oversight at class level, as counts only. | `artifacts/api-server/src/lib/hod-views.ts` (`hodClassSummary`; class-level aggregates only), `artifacts/api-server/src/routes/hod.ts`. |
| Results stay held until the teacher releases them. | `artifacts/api-server/src/lib/result-release.ts` (`resultsReleased`), route `POST /tis/assignments/:assignmentId/release-results`. |
| The four zone bands are "On track / Watch / Needs support / Not enough data". | `artifacts/slate-alis/src/components/zones.tsx` (`ZONE_LABEL`), asserted in `artifacts/slate-alis/src/components/zones.test.tsx`. |
| "Zones are indicative only and are never a promotion decision." | `artifacts/slate-alis/src/components/zones.tsx` (`ZONE_DISCLAIMER`). |

## Section 6 — Parent involvement

| Claim | Evidence |
| --- | --- |
| A parent sees their own child's progress and how often they are working. | `artifacts/api-server/src/routes/parent.ts` (`GET /parent/dashboard`, `GET /parent/learners/:learnerId/activity`), `artifacts/api-server/src/lib/learner-activity.ts`. |
| A plain-language summary, never a colour or a score to interpret. | `artifacts/api-server/src/lib/zones.ts` (`PARENT_ZONE_WORDING`; emitted only when the class's `parentZoneVisibility` is on). |
| A parent sees only what the teacher has released. | `artifacts/api-server/src/lib/result-release.ts`; applied to the parent dashboard and history routes. |
| Data controls: export a child's data, or delete it. | `artifacts/api-server/src/routes/parent.ts` (`GET /parent/learners/:id/export`, `DELETE /parent/learners/:id`). |

## Section 7 — The intelligence engine

| Claim | Evidence |
| --- | --- |
| SLATE keeps track of how a learner does on the formats that help them. | `artifacts/api-server/src/lib/learning-profile.ts` (`updateLearningSignal` records a per-format signal and its running average). |
| SLATE tracks the concepts a learner has met and where a gap remains. | `artifacts/api-server/src/lib/learning-profile.ts` (`applyConceptOutcomes` folds marked outcomes into `activeGaps`), `artifacts/api-server/src/lib/class-insights.ts` (`buildConceptEvents`). |
| The picture changes as the work changes. | `artifacts/api-server/src/lib/learning-profile.ts` (signals and gaps are recomputed from measured results each time; no value is fixed). |
| "These are patterns SLATE notices … not fixed labels." | Page copy that matches the data model: signals carry a score and a session count and are re-averaged on every marked result, so they are not a fixed trait. Asserted in `landing.test.tsx` (`text-engine-caveat`). |

The page deliberately does NOT use "learning style" as a fixed trait, nor "visual
learner", "kinesthetic learner" or similar. The underlying data is a per-format
average and an active-gap list, and the page describes it that way.

## Section 8 — The bigger vision ("Becoming")

These are labelled "Becoming — on the roadmap, not available today" and are NOT
in the code. Listed here so no reader mistakes them for current features:

- Dedicated SLATE tablets — not in the code.
- Career guidance by Grade 12 — not in the code.
- Stylus input for handwritten work — not in the code.
- A native mobile app — not in the code.
- A WhatsApp AI agent for learners and parents — not in the code. (There is a
  human WhatsApp *support line* for adult accounts only; see below. That is not an
  AI agent and not available to learners.)
- Study Desk — not in the code.

## Section 9 — Call to action

| Claim | Evidence |
| --- | --- |
| "Start free" for teachers, parents and tutors. | Links to `/teacher/register`, `/parent/register`, `/tutor/register`; asserted in `landing.test.tsx`. |
| "Request a school pilot" via WhatsApp. | The link is built from `WHATSAPP_SUPPORT_NUMBER`, served by `GET /api/support/config` (`artifacts/api-server/src/routes/support.ts`, `artifacts/api-server/src/lib/support.ts`) and consumed through `supportUrl`/`useSupportConfig` in `artifacts/slate-alis/src/lib/support.ts`. The prefilled message is a fixed string with no personal data; asserted in `landing.test.tsx`. The link is hidden when no number is configured. |

## Honesty rules applied

- No statistics, testimonials, learning-outcome claims or POPIA-compliance
  claims appear on the page.
- No screenshots of real screens are used; the four demonstrations are React
  components with SAMPLE data, each carrying a visible "Sample data —
  illustration only" label.
- The only WhatsApp integration shown is the pilot link, built from the existing
  support configuration; the message carries no personal data (no name, email,
  SLATE ID, marks or answers).

# Alternate home page claims audit

The following audit is retained for `artifacts/slate-alis/src/pages/home.tsx`.
The public `/` route uses `pages/landing.tsx`, audited above. Every capability claim in sections
3 to 7 must be verifiable in the code and covered by a test. Anything not yet
built is labelled "Becoming" on the page and is never shown as current.

Demonstration panels must use invented, explicitly labelled sample data; never
copy a learner record, screenshot, identifier, or result.

| Section | Claim allowed on the page | Code evidence | Test evidence / limit |
| --- | --- | --- | --- |
| Hero | SLATE connects learners, teachers, and parents around learning work. It is an education system, not only a homework tool. | `artifacts/slate-alis/src/pages/home.tsx` (hero); `artifacts/slate-alis/src/pages/tis.tsx`; `artifacts/slate-alis/src/pages/parent.tsx`; `artifacts/slate-alis/src/pages/tutor.tsx` | `artifacts/api-server/src/test/role-access.test.ts` checks role-scoped teacher and parent views. |
| The problem | Use the requested qualitative framing about large classes and late-discovered gaps. Do not add statistics or claim an outcome. | The product's concept-gap tracking is implemented in `artifacts/api-server/src/lib/zones.ts` and `artifacts/api-server/src/lib/learning-profile.ts`. | `artifacts/api-server/src/test/zones.test.ts` covers zone and gap rules. The class-size framing is positioning, not a measured product claim. |
| SLATE approach | Assignments, assessment, feedback, concept-gap analysis, and follow-up practice are connected in the product. | `artifacts/api-server/src/routes/slate.ts`; `artifacts/api-server/src/routes/tis.ts`; `artifacts/api-server/src/lib/learner-classrooms.ts` | `artifacts/api-server/src/test/result-release.test.ts` verifies marked results and recommended practice respect release controls; `artifacts/api-server/src/test/marking-modes.test.ts` verifies marking modes. |
| Learner experience | Learners can see work, submit assignments, review released feedback, and access concept-focused practice. | `artifacts/slate-alis/src/App.tsx` (learner routes `Dashboard`, `Assignments`, `AssignmentDetail`, `Remediation`); `artifacts/api-server/src/routes/slate.ts` | `artifacts/api-server/src/test/result-release.test.ts` checks feedback and practice visibility; `artifacts/api-server/src/test/role-access.test.ts` checks learner access boundaries. |
| Teacher intelligence | Teachers can review class zones and concept gaps, use memo-based marking, and view red-pen feedback on marked scripts. | `artifacts/slate-alis/src/pages/tis.tsx`; `artifacts/slate-alis/src/components/marked-script.tsx`; `artifacts/api-server/src/routes/tis.ts`; `artifacts/api-server/src/lib/memos.ts`; `artifacts/api-server/src/lib/script-export.ts` | `artifacts/api-server/src/test/zones.test.ts`; `artifacts/api-server/src/test/memo-marks-export.test.ts`; `artifacts/api-server/src/test/teacher-override.test.ts`. |
| HOD oversight | HOD views are class-level aggregates. Individual marked scripts are available only when the teacher enables access. | `artifacts/api-server/src/routes/hod.ts`; `artifacts/api-server/src/routes/tis.ts`; `artifacts/api-server/src/lib/hod-views.ts`; `artifacts/slate-alis/src/pages/hod.tsx` | `artifacts/api-server/src/test/hod-role.test.ts` checks that learner names and IDs are not exposed and that script access is teacher-controlled. Homepage HOD demo data must contain counts only. |
| Parent involvement | Parents can view linked children, progress, assignment history, recent activity, recorded learning time, and released marked scripts. | `artifacts/api-server/src/routes/parent.ts` (`/parent/dashboard`, `/parent/learners/:id/activity`); `artifacts/api-server/src/lib/learner-activity.ts`; `artifacts/slate-alis/src/pages/parent.tsx` | `artifacts/api-server/src/test/role-access.test.ts`; `artifacts/api-server/src/test/result-release.test.ts`; `artifacts/api-server/src/test/learner-activity.test.ts`. |
| Intelligence engine | The product records performance signals by activity format and concept gaps, and can use them when preparing follow-up practice. Recent activity is a history of completed work. These are changing observations, not fixed scientific learning types. | `artifacts/api-server/src/lib/learning-profile.ts`; `artifacts/api-server/src/routes/slate.ts` (`/learning-profile`, `/activities/recommended`); `artifacts/api-server/src/lib/learner-classrooms.ts` | `artifacts/api-server/src/test/result-release.test.ts` verifies recommended activities are held until results are released. Do not claim a validated learning-style diagnosis or guaranteed improvement. |
| School-pilot link | The pilot link uses the configured support number and a short, non-personal prefilled message. The link is omitted when the number is not configured. | `artifacts/api-server/src/lib/support.ts`; `artifacts/api-server/src/routes/support.ts`; `artifacts/slate-alis/src/lib/support.ts`; `artifacts/slate-alis/src/pages/home.tsx` | `artifacts/slate-alis/src/components/support-button.test.tsx` verifies `wa.me` URL generation and message privacy; `artifacts/slate-alis/src/pages/home.test.tsx` verifies the pilot link is built only from an enabled, configured number and omitted otherwise. |
| Free access period | "Free to use until January 2027." | Supplied by the task brief (a business term, not a code artifact). | Business term supplied by the user; do not change the date or imply anything beyond it. |
| Becoming | Dedicated SLATE tablets, Grade 12 career guidance, stylus input, a native app, a WhatsApp AI agent, and Study Desk are future ideas only. | Supplied by the task brief; none of these appear in the codebase. | Keep every one clearly labelled "Becoming"; none may be shown as a current capability. |

## Global exclusions

- No statistics, testimonials, outcome guarantees, or POPIA-compliance claims.
- Do not describe learning styles as fixed scientific traits.
- Do not use real learner names, data, scores, IDs, or screenshots in demos.
- Keep HOD examples aggregated; never show learner names or individual scripts.
- The WhatsApp pilot message must not contain a person's name, school, email,
  phone number, learner details, marks, or other personal data.


<!-- /coderabbit-ai-generated:v1 -->