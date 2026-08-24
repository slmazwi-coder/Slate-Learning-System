import { eq, sql } from "drizzle-orm";
import { db, presetCurriculaTable } from "@workspace/db";

// Hardwired preset curriculum catalog. Content is extracted from the official
// South African CAPS documents supplied to Slate; entries are seeded into
// `slate_preset_curricula` on bootstrap and used to gate class creation.
// Adding a new subject = add an entry here (and optionally a document upload
// via the admin path later).

type PresetEntry = {
  phase: string;
  subject: string;
  gradeMin: number;
  gradeMax: number;
  sourceName: string;
  sequence: string[];
};

const CAPS_IP_SS = "CAPS Social Sciences Grades 4-6 (Intermediate Phase)";

export const PRESET_CURRICULA: PresetEntry[] = [
  {
    phase: "INTERMEDIATE_PHASE",
    subject: "Social Sciences — Geography",
    gradeMin: 4,
    gradeMax: 6,
    sourceName: CAPS_IP_SS,
    sequence: [
      "Grade 4 · Places where people live",
      "Grade 4 · Map skills",
      "Grade 4 · Food and farming in South Africa",
      "Grade 4 · Water in South Africa",
      "Grade 5 · Map skills: Africa",
      "Grade 5 · Physical features of South Africa",
      "Grade 5 · Weather, climate and vegetation of South Africa",
      "Grade 5 · Minerals and mining in South Africa",
      "Grade 6 · Map skills: World",
      "Grade 6 · Trade: South Africa and World",
      "Grade 6 · Climate and vegetation around the world",
      "Grade 6 · Population: why people live where they do",
    ],
  },
  {
    phase: "INTERMEDIATE_PHASE",
    subject: "Social Sciences — History",
    gradeMin: 4,
    gradeMax: 6,
    sourceName: CAPS_IP_SS,
    sequence: [
      "Grade 4 · Local history",
      "Grade 4 · Learning from leaders",
      "Grade 4 · Transport through time",
      "Grade 4 · Communication through time",
      "Grade 5 · Hunter-gatherers and herders in Southern Africa",
      "Grade 5 · The first farmers in Southern Africa",
      "Grade 5 · An ancient African society: Egypt",
      "Grade 5 · A heritage trail through the provinces of South Africa",
      "Grade 6 · An African kingdom long ago: Mapungubwe",
      "Grade 6 · Explorers from Europe find Southern Africa",
      "Grade 6 · Democracy and citizenship in South Africa",
      "Grade 6 · Medicine through time",
    ],
  },
];

// Convenience: every subject that currently has a hardwired preset.
export function presetSubjects() {
  return PRESET_CURRICULA.map((entry) => entry.subject);
}

export function presetForSubject(subject: string, grade: number): PresetEntry | null {
  return PRESET_CURRICULA.find((entry) => entry.subject === subject && grade >= entry.gradeMin && grade <= entry.gradeMax) ?? null;
}

// Upserts the registry into the catalog table (idempotent — used by the
// schema bootstrap and useful when the registry gains entries).
export async function syncPresetCurricula() {
  for (const entry of PRESET_CURRICULA) {
    await db
      .insert(presetCurriculaTable)
      .values({
        phase: entry.phase,
        subject: entry.subject,
        gradeMin: entry.gradeMin,
        gradeMax: entry.gradeMax,
        sourceName: entry.sourceName,
        sequence: entry.sequence,
      })
      .onConflictDoUpdate({
        target: [presetCurriculaTable.phase, presetCurriculaTable.subject, presetCurriculaTable.gradeMin, presetCurriculaTable.gradeMax],
        set: { sequence: entry.sequence, sourceName: entry.sourceName },
      });
  }
}

// Gate: a class can only be created against a preset subject at a covered
// grade. Returns the preset on success, or null when the subject is locked.
export async function resolvePresetForClass(subject: string, grade: number) {
  const preset = presetForSubject(subject, grade);
  if (!preset) return null;
  const [row] = await db
    .select()
    .from(presetCurriculaTable)
    .where(eq(presetCurriculaTable.subject, preset.subject))
    .limit(1);
  return { preset, row: row ?? null };
}

export async function listPresetCurricula() {
  const rows = await db
    .select()
    .from(presetCurriculaTable)
    .orderBy(sql`${presetCurriculaTable.gradeMin}, ${presetCurriculaTable.subject}`);
  return rows.map((row) => ({
    id: row.id,
    phase: row.phase,
    subject: row.subject,
    gradeMin: row.gradeMin,
    gradeMax: row.gradeMax,
    sourceName: row.sourceName,
    sequence: row.sequence,
  }));
}
