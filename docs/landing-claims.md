# Public homepage claims audit

This file is the source of truth for factual product statements on the public
homepage (`artifacts/slate-alis/src/pages/home.tsx`, mounted by the `Home`
route in `artifacts/slate-alis/src/App.tsx`). Every capability claim in sections
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
