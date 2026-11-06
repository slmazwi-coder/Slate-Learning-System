// Watcher for departmental curriculum updates. The department publishes Annual
// Teaching Plans on its ATP pages and signals a change by labelling documents
// with a new teaching year (e.g. "Mathematics (2026)"). This script fetches the
// phase pages, extracts those year labels, and reports what has changed against
// the directives and plans the running Slate API has recorded.
//
// It reads the deployed API rather than importing server modules, so it reports
// on what is actually live. It is read-only and never writes: a departmental
// update is a curriculum decision, so a human records it in
// CURRICULUM_DIRECTIVES and loads the documents. The script's job is to make the
// change impossible to miss.
//
//   pnpm --filter @workspace/scripts run atp-watch
//   SLATE_API_BASE=http://localhost:12000 pnpm --filter @workspace/scripts run atp-watch

const ATP_INDEX_URL =
  "https://www.education.gov.za/Curriculum/NationalCurriculumStatementsGradesR-12/2023ATPs.aspx";

const ATP_PHASE_URLS: Record<string, string> = {
  FOUNDATION_PHASE: "https://www.education.gov.za/Curriculum/NationalCurriculumStatementsGradesR-12/2023ATPsFP.aspx",
  INTERMEDIATE_PHASE: "https://www.education.gov.za/Curriculum/NationalCurriculumStatementsGradesR-12/2023ATPsIP.aspx",
  SENIOR_PHASE: "https://www.education.gov.za/Curriculum/NationalCurriculumStatementsGradesR-12/2023ATPsSP.aspx",
  FET_PHASE: "https://www.education.gov.za/Curriculum/NationalCurriculumStatementsGradesR-12/2023ATPsFET.aspx",
};

const API_BASE = (process.env.SLATE_API_BASE ?? "https://slate-alis.co.za").replace(/\/$/, "");
const YEAR_LABEL = /\((\d{4})\)/g;

type Found = { phase: string; subject: string; year: string };
type Directive = {
  year: string;
  circular: string;
  policy: string;
  exclusions: string[];
  loaded: boolean;
};
type Plan = { subject: string; grade: number; effectiveYear: string; documentYear: string };

function decodeEntities(html: string) {
  return html
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"');
}

// The department is not consistent about subject labels between its phase pages:
// the Intermediate page lists both "Natural Science and Technology" and "Natural
// Sciences and Technology", and the Senior page says "Natural Science" where the
// subject is "Natural Sciences". Comparing labels literally reports those as
// missing plans, which would train an operator to ignore the report. Normalising
// away the plural and the conjunction makes the comparison about the subject.
function normalizeSubject(subject: string) {
  return subject
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((word) => word && word !== "and")
    .map((word) => (word.endsWith("s") && word.length > 3 ? word.slice(0, -1) : word))
    .join(" ")
    .trim();
}

// The phase pages are an ASP.NET GridView: each row is one subject and the year
// lives in the link text as a "(YYYY)" suffix.
function extractYears(html: string, phase: string): Found[] {
  const found: Found[] = [];
  const anchor = /<a\b[^>]*>(.*?)<\/a>/gis;
  let match: RegExpExecArray | null;
  while ((match = anchor.exec(html)) !== null) {
    const text = decodeEntities(match[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (!text) continue;
    YEAR_LABEL.lastIndex = 0;
    let year: RegExpExecArray | null;
    while ((year = YEAR_LABEL.exec(text)) !== null) {
      const subject = text.slice(0, year.index).trim().replace(/[:\-–]\s*$/, "").trim();
      if (subject) found.push({ phase, subject, year: year[1] });
    }
  }
  return found;
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: { "user-agent": "slate-curriculum-watcher/1.0 (+https://slate-alis.co.za)" },
    });
    if (!response.ok) {
      console.error(`  ! ${url} -> HTTP ${response.status}`);
      return null;
    }
    return await response.text();
  } catch (error) {
    console.error(`  ! ${url} -> ${(error as Error).message}`);
    return null;
  }
}

async function loadState(): Promise<{ directives: Directive[]; plans: Plan[] } | null> {
  try {
    const [directivesResponse, plansResponse] = await Promise.all([
      fetch(`${API_BASE}/api/curriculum/directives`),
      fetch(`${API_BASE}/api/curriculum/atp`),
    ]);
    if (!directivesResponse.ok || !plansResponse.ok) {
      console.error(`  ! ${API_BASE} -> directives ${directivesResponse.status}, plans ${plansResponse.status}`);
      return null;
    }
    const directives = (await directivesResponse.json()) as { directives: Directive[] };
    const plans = (await plansResponse.json()) as { plans: Plan[] };
    return { directives: directives.directives, plans: plans.plans };
  } catch (error) {
    console.error(`  ! ${API_BASE} -> ${(error as Error).message}`);
    return null;
  }
}

async function main() {
  console.log("SLATE curriculum watcher\n");
  console.log(`Department index: ${ATP_INDEX_URL}`);
  console.log(`Slate API:        ${API_BASE}\n`);

  const state = await loadState();
  if (!state) {
    console.error("Could not read the directive and plan state from the API.");
    process.exitCode = 1;
    return;
  }
  console.log(`Directives on record: ${state.directives.map((d) => d.year).join(", ")}`);
  console.log(`Plans loaded:         ${state.plans.length}\n`);

  const found: Found[] = [];
  let reachable = 0;
  for (const [phase, url] of Object.entries(ATP_PHASE_URLS)) {
    const html = await fetchText(url);
    if (!html) continue;
    reachable += 1;
    const years = extractYears(html, phase);
    found.push(...years);
    const distinct = [...new Set(years.map((entry) => entry.year))].sort();
    console.log(`${phase}: ${years.length} labelled documents, years ${distinct.join(", ") || "none"}`);
  }

  if (!reachable) {
    console.error("\nNo phase page could be reached (offline, or the department moved the pages).");
    process.exitCode = 1;
    return;
  }

  const publishedYears = [...new Set(found.map((entry) => entry.year))].sort();
  console.log(`\nTeaching years published by the department: ${publishedYears.join(", ")}`);

  const recorded = new Set(state.directives.map((directive) => directive.year));
  const unrecorded = publishedYears.filter((year) => !recorded.has(year));
  if (unrecorded.length) {
    console.log(`\nACTION: the department publishes ${unrecorded.join(", ")}, which no directive records.`);
    console.log("  Fetch the circular, add a CURRICULUM_DIRECTIVES entry, then load the affected documents.");
  } else {
    console.log("\nEvery published year is recorded in the directive registry.");
  }

  // A document labelled with a year no loaded plan carries means the department
  // has published a plan Slate does not yet teach. Comparing on the normalised
  // subject avoids re-reporting the department's own label inconsistencies.
  const loadedYearsBySubject = new Map<string, Set<string>>();
  const loadedSubjects = new Set<string>();
  for (const plan of state.plans) {
    const key = normalizeSubject(plan.subject);
    loadedSubjects.add(key);
    const set = loadedYearsBySubject.get(key) ?? new Set<string>();
    set.add(plan.documentYear);
    loadedYearsBySubject.set(key, set);
  }

  const publishedByYear = new Map<string, Found[]>();
  for (const entry of found) {
    const list = publishedByYear.get(entry.year) ?? [];
    list.push(entry);
    publishedByYear.set(entry.year, list);
  }

  const unloaded: Found[] = [];
  for (const [year, entries] of [...publishedByYear.entries()].sort()) {
    const seen = new Set<string>();
    const missing = entries.filter((entry) => {
      const key = normalizeSubject(entry.subject);
      if (seen.has(key)) return false;
      seen.add(key);
      return !loadedYearsBySubject.get(key)?.has(year);
    });
    if (missing.length) {
      console.log(`\nDocuments published for ${year} that Slate does not teach:`);
      for (const entry of missing) {
        const label = entry.subject.replace(/\s+$/g, "");
        const known = loadedSubjects.has(normalizeSubject(label)) ? " (subject is loaded, but not this year's document)" : "";
        console.log(`  - ${entry.phase}: ${label} (${entry.year})${known}`);
      }
      console.log("  Fetch these documents, extract the topics, and load them into the ATP catalog.");
      unloaded.push(...missing);
    }
  }
  if (!unloaded.length) {
    console.log("\nEvery published document is loaded.");
  }

  // A directive that names subjects but has no plan loaded for them is a gap.
  console.log("\nDirective gaps:");
  let gaps = 0;
  for (const directive of state.directives) {
    const missing = directive.exclusions.filter(
      (subject) => !loadedSubjects.has(normalizeSubject(subject)),
    );
    if (directive.loaded && missing.length) {
      console.log(`  ${directive.year}: named but not loaded -> ${missing.join(", ")}`);
      gaps += 1;
    }
    if (!directive.loaded) {
      console.log(`  ${directive.year}: not loaded yet (${directive.circular})`);
    }
  }
  if (!gaps) console.log("  none");

  console.log("\nPlans in force by teaching year:");
  const byYear = new Map<string, number>();
  for (const plan of state.plans) {
    byYear.set(plan.effectiveYear, (byYear.get(plan.effectiveYear) ?? 0) + 1);
  }
  for (const [year, count] of [...byYear.entries()].sort()) {
    console.log(`  ${year}: ${count} subject-grade plans`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
