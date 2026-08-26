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
  {
    phase: "INTERMEDIATE_PHASE",
    subject: "Natural Sciences and Technology",
    gradeMin: 4,
    gradeMax: 6,
    sourceName: "CAPS Natural Sciences and Technology Grades 4-6 (Intermediate Phase)",
    sequence: [
      // Grade 4
      "Grade 4 · Living and non-living things",
      "Grade 4 · Structures of plants and animals",
      "Grade 4 · What plants need to grow",
      "Grade 4 · Habitats of animals",
      "Grade 4 · Structures for animal shelters",
      "Grade 4 · Materials around us",
      "Grade 4 · Solid materials",
      "Grade 4 · Strengthening materials",
      "Grade 4 · Strong frame structures",
      "Grade 4 · Energy and energy transfer",
      "Grade 4 · Energy around us",
      "Grade 4 · Movement energy in a system",
      "Grade 4 · Energy and sound",
      "Grade 4 · Planet Earth, the Sun and the Moon",
      "Grade 4 · Rocket systems",
      // Grade 5
      "Grade 5 · Plants and animals on Earth",
      "Grade 5 · Animal skeletons",
      "Grade 5 · Food chains",
      "Grade 5 · Life cycles",
      "Grade 5 · Skeletons as structures",
      "Grade 5 · Metals and non-metals",
      "Grade 5 · Uses of metals",
      "Grade 5 · Processing materials",
      "Grade 5 · Processed materials",
      "Grade 5 · Stored energy in fuels",
      "Grade 5 · Energy and electricity",
      "Grade 5 · Energy and movement",
      "Grade 5 · Systems for moving things",
      "Grade 5 · Planet Earth and its surface",
      "Grade 5 · Sedimentary rocks and fossils",
      // Grade 6
      "Grade 6 · Photosynthesis",
      "Grade 6 · Nutrients in food and nutrition",
      "Grade 6 · Ecosystems and food webs",
      "Grade 6 · Food processing",
      "Grade 6 · Solids, liquids and gases",
      "Grade 6 · Mixtures and solutions",
      "Grade 6 · Dissolving, water resources and purifying water",
      "Grade 6 · Electric circuits",
      "Grade 6 · Electrical conductors and insulators",
      "Grade 6 · Mains electricity",
      "Grade 6 · Systems to solve problems",
      "Grade 6 · The Solar System and movements of Earth and planets",
      "Grade 6 · The movement of the Moon",
      "Grade 6 · Systems for looking into space",
      "Grade 6 · Systems to explore the Moon and Mars",
    ],
  },
  {
    phase: "INTERMEDIATE_PHASE",
    subject: "IsiZulu Home Language",
    gradeMin: 4,
    gradeMax: 6,
    sourceName: "CAPS IsiZulu Home Language (IsiZulu Ulwimi Lwasekhaya) Grades 4-6 (Intermediate Phase)",
    sequence: [
      // Language is organised by the four skills rather than topics; this is
      // the ordered teaching sequence built from the CAPS skill strands and
      // the annual writing genre progression per grade.
      "Ukulalela nokukhuluma (Listening and speaking)",
      "Ukulalela ngokuqondisisa nokuphendula (Attentive listening and responding)",
      "Ukufunda (Reading)",
      "Ukufunda ngokuqondisisa okuqukethwe (Reading comprehension)",
      "Amagama, ukubhala amagama nespelingi (Word work, spelling and vocabulary)",
      "Ukubhala umusho nesigaba (Writing sentences and paragraphs)",
      "Umbhalo wochazayo nolandisayo (Descriptive and narrative writing)",
      "Imibhalo yokushintshisana: izaziso, izikhangiso, amaposta (Transactional texts: notices, adverts, posters)",
      "Imibhalo enomthetho: izincwadi, imibiko, amakhadi ezibingelelo (Formal texts: letters, reports, cards)",
      "Indaba emfishane nenganekwane (Short stories and folktales)",
      "Izinkondlo (Poetry)",
      "Inoveli nomdlalo/idrama (Novel and drama)",
      "Isakhiwo nokusetshenziswa kolimi: amabizo, izichasiso, izenzo (Language structure: nouns, modifiers, verbs)",
      "Izimpawu zokuloba nenkulumongqo (Punctuation and direct/reported speech)",
      "Inqubo yokubhala ephelele (The full writing process)",
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
