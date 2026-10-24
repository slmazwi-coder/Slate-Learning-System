import { eq } from "drizzle-orm";
import { db, learningProfilesTable } from "@workspace/db";

const signalLabels: Record<string, string> = {
  QUIZ: "Quiz-responsive",
  GAME: "Game-responsive",
  PUZZLE: "Logic-pattern learner",
  CASE_STUDY: "Contextual learner",
  ASSESSMENT: "Assessment-ready",
};

export async function getOrCreateProfile(learnerId: string) {
  const [profile] = await db.select().from(learningProfilesTable).where(eq(learningProfilesTable.learnerId, learnerId)).limit(1);
  if (profile) return profile;
  const [created] = await db.insert(learningProfilesTable).values({ learnerId }).returning();
  return created;
}

// Folds one measured result into the learner's learning profile: the format
// signal that shapes the detected learning style, and the concept gap (if any)
// that feeds the learner's active-gap list. Used by both the learner marking
// flow and a teacher's override, so an override updates the profile too.
export async function updateLearningSignal(learnerId: string, format: string, score: number, gap?: string | null) {
  const profile = await getOrCreateProfile(learnerId);
  const signals = Array.isArray(profile.signals) ? profile.signals as Array<{ format: string; label: string; score: number; sessions: number }> : [];
  const existing = signals.find((signal) => signal.format === format);
  if (existing) {
    existing.score = Math.round((existing.score * existing.sessions + score) / (existing.sessions + 1));
    existing.sessions += 1;
  } else {
    signals.push({ format, label: signalLabels[format] ?? format, score: Math.round(score), sessions: 1 });
  }
  const sorted = [...signals].sort((a, b) => b.score - a.score);
  const primaryStyle = sorted[0]?.label ?? "Discovering";
  const confidence = Math.min(100, sorted[0] ? Math.round((sorted[0].sessions / 5) * 100) : 0);
  const activeGaps = Array.isArray(profile.activeGaps) ? [...profile.activeGaps] : [];
  if (gap && !activeGaps.includes(gap)) activeGaps.unshift(gap);
  await db.update(learningProfilesTable).set({ signals, primaryStyle, confidence, activeGaps: activeGaps.slice(0, 5) }).where(eq(learningProfilesTable.learnerId, learnerId));
}

// Applies a set of concept outcomes from one submission to the learner's
// active-gap list. Used by a teacher override so the override is reflected in
// the learning profile as well as the marked script.
export async function applyConceptOutcomes(learnerId: string, outcomes: Array<{ concept: string; score: number | null }>) {
  const profile = await getOrCreateProfile(learnerId);
  const activeGaps = Array.isArray(profile.activeGaps) ? [...profile.activeGaps] : [];
  for (const outcome of outcomes) {
    if (outcome.score === null) continue;
    if (outcome.score < 80 && outcome.concept && !activeGaps.includes(outcome.concept)) {
      activeGaps.unshift(outcome.concept);
    }
  }
  await db.update(learningProfilesTable).set({ activeGaps: activeGaps.slice(0, 5) }).where(eq(learningProfilesTable.learnerId, learnerId));
}
