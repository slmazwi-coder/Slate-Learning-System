import type { assignmentsTable } from "@workspace/db";

// Result release is teacher-controlled. Two timestamps on the assignment carry
// the teacher's explicit decision:
//   resultsReleasedAt — the teacher pressed "Release results"
//   resultsHeldAt     — the teacher pressed "Hold results"
// The later of the two wins. When the teacher has never touched the assignment
// both are null and the original resultReleasePolicy applies unchanged, so
// existing assignments keep behaving exactly as they did before.
export type ReleaseAssignment = Pick<
  typeof assignmentsTable.$inferSelect,
  "resultReleasePolicy" | "resultsReleasedAt" | "resultsHeldAt" | "closeAt"
>;

// The teacher's explicit state, if any: "RELEASED", "HELD", or null (untouched).
export function teacherReleaseState(assignment: ReleaseAssignment): "RELEASED" | "HELD" | null {
  const released = assignment.resultsReleasedAt?.getTime() ?? null;
  const held = assignment.resultsHeldAt?.getTime() ?? null;
  if (released === null && held === null) return null;
  if (held !== null && (released === null || held > released)) return "HELD";
  return "RELEASED";
}

// Whether marks/feedback for this assignment may be shown to learners/parents.
// An explicit hold always hides results; an explicit release shows them at any
// time; otherwise the configured policy decides (after_close waits for close).
export function resultsReleased(assignment: ReleaseAssignment, now: Date = new Date()): boolean {
  const state = teacherReleaseState(assignment);
  if (state === "HELD") return false;
  if (state === "RELEASED") return true;
  return assignment.resultReleasePolicy !== "after_close" || now >= assignment.closeAt;
}
