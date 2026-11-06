import { and, eq, sql } from "drizzle-orm";
import { annualTeachingPlansTable, db } from "@workspace/db";
import { ATP_CATALOG, type AtpEntry } from "./atp-catalog";

// Annual Teaching Plans (ATPs) are the Department of Basic Education's
// time-boxed curriculum recovery instrument. Where the department issues a new
// directive for a subject, the ATP is the authority for that year and replaces
// the plain CAPS-derived sequence for the affected grades. Where a plan is
// merely retained, the CAPS sequence stays and the ATP is not applied.
//
// A plan is keyed on `effective_year` (the teaching year it governs) *and*
// `document_year` (the vintage printed on the source document). These differ:
// the 2026 CAT/IT plans run on 2023/24 documents, so keying on the teaching
// year alone would misdescribe the plan.
export const ATP_DEFAULT_YEAR = "2026";

export function atpEntryFor(subject: string, grade: number, effectiveYear = ATP_DEFAULT_YEAR): AtpEntry | null {
  return (
    ATP_CATALOG.find(
      (entry) => entry.subject === subject && entry.grade === grade && entry.effectiveYear === effectiveYear,
    ) ?? null
  );
}

// Every subject+grade the department has re-directed. Used by the class gate so
// only directed classes are re-sequenced; retained subjects keep their CAPS
// sequence untouched.
export function directedAtpEntries(effectiveYear = ATP_DEFAULT_YEAR): AtpEntry[] {
  return ATP_CATALOG.filter((entry) => entry.effectiveYear === effectiveYear);
}

export function hasDirectedAtp(subject: string, grade: number, effectiveYear = ATP_DEFAULT_YEAR): boolean {
  return atpEntryFor(subject, grade, effectiveYear) !== null;
}

// Upserts the catalog into `slate_annual_teaching_plans` (idempotent — run from
// the schema bootstrap so a redeploy repairs any tampered rows).
export async function syncAnnualTeachingPlans() {
  for (const entry of ATP_CATALOG) {
    await db
      .insert(annualTeachingPlansTable)
      .values({
        phase: entry.phase,
        subject: entry.subject,
        grade: entry.grade,
        effectiveYear: entry.effectiveYear,
        documentYear: entry.documentYear,
        sourceName: entry.sourceName,
        circular: entry.circular,
        sequence: entry.sequence,
      })
      .onConflictDoUpdate({
        target: [
          annualTeachingPlansTable.subject,
          annualTeachingPlansTable.grade,
          annualTeachingPlansTable.effectiveYear,
        ],
        set: {
          phase: entry.phase,
          documentYear: entry.documentYear,
          sourceName: entry.sourceName,
          circular: entry.circular,
          sequence: entry.sequence,
        },
      });
  }
}

export async function listAnnualTeachingPlans(effectiveYear?: string) {
  const rows = await db
    .select()
    .from(annualTeachingPlansTable)
    .orderBy(sql`${annualTeachingPlansTable.grade}, ${annualTeachingPlansTable.subject}`);
  const filtered = effectiveYear ? rows.filter((row) => row.effectiveYear === effectiveYear) : rows;
  return filtered.map((row) => ({
    id: row.id,
    phase: row.phase,
    subject: row.subject,
    grade: row.grade,
    effectiveYear: row.effectiveYear,
    documentYear: row.documentYear,
    sourceName: row.sourceName,
    circular: row.circular,
    topicCount: Array.isArray(row.sequence) ? row.sequence.length : 0,
  }));
}

// The ATP sequence for a class, or null when the subject is merely retained and
// the CAPS sequence should stand. Reads the catalog table so an operator can
// correct a row without a redeploy.
export async function atpSequenceForClass(
  subject: string | null,
  grade: number,
  effectiveYear = ATP_DEFAULT_YEAR,
): Promise<{ sequence: string[]; sourceName: string; documentYear: string; circular: string } | null> {
  if (!subject) return null;
  const [row] = await db
    .select()
    .from(annualTeachingPlansTable)
    .where(
      and(
        eq(annualTeachingPlansTable.subject, subject),
        eq(annualTeachingPlansTable.grade, grade),
        eq(annualTeachingPlansTable.effectiveYear, effectiveYear),
      ),
    )
    .limit(1);
  if (!row || !Array.isArray(row.sequence) || row.sequence.length === 0) return null;
  return {
    sequence: row.sequence as string[],
    sourceName: row.sourceName,
    documentYear: row.documentYear,
    circular: row.circular,
  };
}

// The lesson sequence a class should follow: the ATP where the department has
// re-directed the subject, otherwise the CAPS-derived preset sequence.
export async function sequenceForClass(
  subject: string,
  grade: number,
  capsSequence: string[],
  effectiveYear = ATP_DEFAULT_YEAR,
): Promise<{ sequence: string[]; source: "atp" | "caps"; sourceName?: string }> {
  const atp = await atpSequenceForClass(subject, grade, effectiveYear);
  if (atp) return { sequence: atp.sequence, source: "atp", sourceName: atp.sourceName };
  return { sequence: capsSequence, source: "caps" };
}
