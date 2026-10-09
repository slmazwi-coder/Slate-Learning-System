import { asc, eq, ilike, or } from "drizzle-orm";
import { db, learnersTable, type Learner } from "@workspace/db";
import { isSlateIdQuery } from "./slate-id";

// The profile card a searcher sees. SLATE ID is always included so namesakes
// can be told apart before a learner is added to a class or linked.
export function learnerSearchCard(learner: Learner) {
  return {
    id: learner.id,
    slateId: learner.slateId,
    fullName: learner.fullName,
    username: learner.username,
    grade: learner.grade,
    schoolName: learner.schoolName,
    subjects: learner.subjects,
    profileImage: learner.profileImage,
  };
}

// Find an existing learner by SLATE ID (exact, at most one) or by full name
// (case-insensitive, possibly several people). A SLATE ID query never falls
// back to a name search: an ID is authoritative, so a near miss returns nothing
// rather than a confusing list.
export async function searchLearners(query: string): Promise<ReturnType<typeof learnerSearchCard>[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  if (isSlateIdQuery(trimmed)) {
    const [row] = await db.select().from(learnersTable).where(eq(learnersTable.slateId, trimmed.toUpperCase())).limit(1);
    return row ? [learnerSearchCard(row)] : [];
  }
  const rows = await db
    .select()
    .from(learnersTable)
    .where(or(ilike(learnersTable.fullName, `%${trimmed}%`), ilike(learnersTable.username, `%${trimmed}%`)))
    .orderBy(asc(learnersTable.fullName))
    .limit(50);
  return rows.map(learnerSearchCard);
}
