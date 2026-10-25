import { db, curriculumDirectivesTable } from "@workspace/db";
import { ATP_CATALOG, type AtpEntry } from "./atp-catalog";
import { ATP_DEFAULT_YEAR } from "./atp";

// The department does not reissue every Annual Teaching Plan each year. It
// publishes a circular that either retains the previous plans or names a set of
// subjects to be replaced. Slate therefore records the *directive* per teaching
// year, so the plan in force for a class is always traceable to a departmental
// decision rather than to whenever a document happened to be downloaded.
export type CurriculumDirective = {
  /** Teaching year the directive governs, e.g. "2026". */
  year: string;
  /** The circular that carries the decision. */
  circular: string;
  /** Where the circular and its annexures are published. */
  sourceUrl: string;
  /**
   * "retention" keeps the previous year's plans except for `exclusions`;
   * "standalone" means the year's plans were issued on their own terms.
   */
  policy: "retention" | "standalone";
  /** Subjects whose plans this directive replaces (retention) or issues (standalone). */
  exclusions: string[];
  /** How the department applies the directive, for an operator reading the report. */
  notes: string;
  /**
   * Whether Slate has extracted the plans this directive calls for. A directive
   * that is recorded but not yet loaded is a known gap, not a silent one.
   */
  loaded: boolean;
};

// Index of the departmental ATP pages, used by the watcher script and quoted in
// the admin report so an operator can go straight to the source.
export const ATP_INDEX_URL =
  "https://www.education.gov.za/Curriculum/NationalCurriculumStatementsGradesR-12/2023ATPs.aspx";
export const ATP_PHASE_URLS: Record<string, string> = {
  FOUNDATION_PHASE: "https://www.education.gov.za/Curriculum/NationalCurriculumStatementsGradesR-12/2023ATPsFP.aspx",
  INTERMEDIATE_PHASE: "https://www.education.gov.za/Curriculum/NationalCurriculumStatementsGradesR-12/2023ATPsIP.aspx",
  SENIOR_PHASE: "https://www.education.gov.za/Curriculum/NationalCurriculumStatementsGradesR-12/2023ATPsSP.aspx",
  FET_PHASE: "https://www.education.gov.za/Curriculum/NationalCurriculumStatementsGradesR-12/2023ATPsFET.aspx",
};

export const CURRICULUM_DIRECTIVES: CurriculumDirective[] = [
  {
    year: "2023",
    circular: "Circular S33 of 2022",
    sourceUrl: ATP_INDEX_URL,
    policy: "standalone",
    exclusions: [],
    notes:
      "The 2023/24 Annual Teaching Plans, issued to guide recovery of learning after COVID-19. "
      + "Still the document in force for most subjects, because later circulars retain it.",
    loaded: false,
  },
  {
    year: "2024",
    circular: "Circular S33 of 2022 (retained), with 2024 Physical Sciences ATPs",
    sourceUrl: ATP_INDEX_URL,
    policy: "retention",
    // The FET Physical Sciences plans were published for 2024 on their own terms,
    // separate from the retained 2023/24 plans.
    exclusions: ["Physical Sciences"],
    notes:
      "The 2023/24 plans continued unchanged, except that separate 2024 Annual Teaching Plans were published for FET Physical Sciences "
      + "(Grades 10, 11 and a Grade 12 recovery plan).",
    loaded: false,
  },
  {
    year: "2025",
    circular: "Circular S15 of 2024",
    sourceUrl: ATP_INDEX_URL,
    policy: "retention",
    exclusions: [],
    notes: "Reiterated retention of the 2023/24 plans, revised weightings and School-Based Assessment.",
    loaded: false,
  },
  {
    year: "2026",
    circular: "Circular S19 of 2025",
    sourceUrl: ATP_INDEX_URL,
    policy: "retention",
    // Circular S33 of 2022 remains applicable for 2026 *with* these exclusions;
    // the excluded subjects carry their own updated plans.
    exclusions: [
      "Computer Applications Technology",
      "Information Technology",
      "Mathematics",
      "Natural Sciences",
      "Natural Sciences and Technology",
    ],
    notes:
      "Retains the 2023/24 plans, excluding CAT, IT, and Natural Sciences and Mathematics for the Intermediate and Senior Phases. "
      + "CAT and IT were updated to accommodate new trends and peripherals under Circular S9 of 2025. "
      + "Natural Sciences, Natural Sciences and Technology (Grades 4-9) and Mathematics (Grades 4-5 and 8-9) carry a new directive "
      + "restoring content removed during COVID-19, in preparation for the Trends in International Mathematics and Science Study (TIMSS) in 2027.",
    loaded: true,
  },
  {
    year: "2027",
    circular: "Not yet published",
    sourceUrl: ATP_INDEX_URL,
    policy: "retention",
    exclusions: [],
    notes:
      "Placeholder for the next teaching year. Until the department publishes its circular, 2027 is assumed to retain the 2026 position. "
      + "The TIMSS 2027 study is the reason the 2026 Mathematics and Natural Sciences plans restored the COVID-19 content, "
      + "so watch for a further directive ahead of that assessment. Run the ATP watcher when the circular lands and record the new directive "
      + "before the year starts.",
    loaded: false,
  },
];

export function directiveFor(year: string): CurriculumDirective | null {
  return CURRICULUM_DIRECTIVES.find((directive) => directive.year === year) ?? null;
}

// The most recent year for which the department has actually published a
// decision. The 2027 placeholder does not count, so a class created today still
// resolves against the 2026 position.
export function latestPublishedYear(): string {
  const published = CURRICULUM_DIRECTIVES.filter((directive) => directive.circular !== "Not yet published");
  return published.length ? published[published.length - 1].year : "2026";
}

export type CurriculumReviewItem = {
  subject: string;
  grade: number;
  phase: string;
  /** The directive year the loaded plan belongs to. */
  loadedYear: string;
  /** Document vintage of the loaded plan. */
  documentYear: string;
  circular: string;
  status: "current" | "stale";
};

export type CurriculumReview = {
  year: string;
  directive: CurriculumDirective | null;
  /** Plans loaded for the year the directive governs. */
  current: CurriculumReviewItem[];
  /**
   * Plans still carried over from an earlier directive. Non-empty means the
   * department re-directed a subject but the new document has not been loaded.
   */
  stale: CurriculumReviewItem[];
  /** Subjects the directive names that have no plan loaded at all yet. */
  missing: string[];
};

// Compares the directives on record against the plans actually loaded, so a
// departmental update surfaces as a review item rather than as silent drift.
export function reviewCurriculum(year: string): CurriculumReview {
  const directive = directiveFor(year);
  const current: CurriculumReviewItem[] = [];
  const stale: CurriculumReviewItem[] = [];

  for (const entry of ATP_CATALOG) {
    const item: CurriculumReviewItem = {
      subject: entry.subject,
      grade: entry.grade,
      phase: entry.phase,
      loadedYear: entry.effectiveYear,
      documentYear: entry.documentYear,
      circular: entry.circular,
      status: entry.effectiveYear === year ? "current" : "stale",
    };
    if (item.status === "current") current.push(item);
    else stale.push(item);
  }

  const loadedSubjects = new Set(ATP_CATALOG.map((entry) => entry.subject));
  const missing = (directive?.exclusions ?? []).filter((subject) => !loadedSubjects.has(subject));

  return { year, directive, current, stale, missing };
}

// Upserts the directive registry (idempotent — run from the schema bootstrap).
export async function syncCurriculumDirectives() {
  for (const directive of CURRICULUM_DIRECTIVES) {
    await db
      .insert(curriculumDirectivesTable)
      .values({
        year: directive.year,
        circular: directive.circular,
        sourceUrl: directive.sourceUrl,
        policy: directive.policy,
        exclusions: directive.exclusions,
        notes: directive.notes,
        loaded: directive.loaded,
      })
      .onConflictDoUpdate({
        target: curriculumDirectivesTable.year,
        set: {
          circular: directive.circular,
          sourceUrl: directive.sourceUrl,
          policy: directive.policy,
          exclusions: directive.exclusions,
          notes: directive.notes,
          loaded: directive.loaded,
        },
      });
  }
}

export async function listCurriculumDirectives() {
  const rows = await db.select().from(curriculumDirectivesTable);
  return rows
    .map((row) => ({
      year: row.year,
      circular: row.circular,
      sourceUrl: row.sourceUrl,
      policy: row.policy,
      exclusions: (row.exclusions as string[] | null) ?? [],
      notes: row.notes,
      loaded: row.loaded,
    }))
    .sort((a, b) => a.year.localeCompare(b.year));
}

// Every plan the department has re-directed, as a flat list. Used by the
// watcher script and the admin report to say what Slate currently overrides.
export function directedPlans(year: string): AtpEntry[] {
  return ATP_CATALOG.filter((entry) => entry.effectiveYear === year);
}

// The circular that governs a class's subject and grade: the Annual Teaching
// Plan's own circular where the department re-directed the subject, and the
// retention circular otherwise. Every class is governed by *some* circular, so a
// teacher can always see where their plan comes from. Synchronous and in-memory
// so it can be used while serializing a class row.
export function governingCircular(subject: string, grade: number): string | null {
  const plan = ATP_CATALOG.find(
    (entry) => entry.subject === subject && entry.grade === grade && entry.effectiveYear === ATP_DEFAULT_YEAR,
  );
  if (plan) return plan.circular;
  const retention = [...CURRICULUM_DIRECTIVES]
    .reverse()
    .find((directive) => directive.loaded && directive.policy === "retention");
  return retention?.circular ?? null;
}
