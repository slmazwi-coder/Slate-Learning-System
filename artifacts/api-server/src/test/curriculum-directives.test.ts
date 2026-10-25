import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { client, ensureSchemaReady, resetDatabase, startTestServer, stopTestServer } from "./harness";
import { registerTeacher } from "./fixtures";
import {
  ATP_INDEX_URL,
  CURRICULUM_DIRECTIVES,
  directiveFor,
  governingCircular,
  latestPublishedYear,
  listCurriculumDirectives,
  reviewCurriculum,
} from "../lib/curriculum-directives";

// The department signals a curriculum change through a circular, not by editing
// the plans in place. Slate records the directive per year so a class's syllabus
// is traceable to a decision, and so a year whose documents have not been loaded
// shows up as a known gap rather than as silent drift.
describe("departmental curriculum directives", () => {
  beforeAll(async () => { await startTestServer(); await ensureSchemaReady(); });
  afterAll(async () => { await stopTestServer(); });
  beforeEach(async () => { await resetDatabase(); });

  it("records the 2026 retention circular with its named exclusions", () => {
    const directive = directiveFor("2026")!;
    expect(directive).toBeTruthy();
    expect(directive.circular).toBe("Circular S19 of 2025");
    expect(directive.policy).toBe("retention");
    expect(directive.loaded).toBe(true);
    // The circular excludes these from retention; each maps to a loaded plan.
    expect(directive.exclusions).toEqual(
      expect.arrayContaining([
        "Computer Applications Technology",
        "Information Technology",
        "Mathematics",
        "Natural Sciences",
        "Natural Sciences and Technology",
      ]),
    );
  });

  it("carries a placeholder for the next teaching year, marked unloaded", () => {
    const next = directiveFor("2027")!;
    expect(next).toBeTruthy();
    expect(next.circular).toBe("Not yet published");
    expect(next.loaded).toBe(false);
    // The placeholder must not be treated as the current authority.
    expect(latestPublishedYear()).toBe("2026");
  });

  it("does not let the 2027 placeholder change what a class follows today", () => {
    // A placeholder with no exclusions means nothing is re-directed for 2027 yet,
    // so no subject is reported missing against it.
    const review = reviewCurriculum("2027");
    expect(review.directive?.loaded).toBe(false);
    expect(review.current).toHaveLength(0);
    expect(review.missing).toHaveLength(0);
  });

  it("reports no gaps for the loaded 2026 directive", () => {
    const review = reviewCurriculum("2026");
    // Every subject the circular names has a plan loaded, so nothing is missing.
    expect(review.missing).toEqual([]);
    expect(review.current.length).toBeGreaterThan(0);
    // Every current item belongs to the directive year.
    for (const item of review.current) {
      expect(item.loadedYear).toBe("2026");
      expect(item.status).toBe("current");
      expect(item.circular).toBeTruthy();
    }
    // The re-directed subjects carry the circular that actually governs them:
    // Mathematics and Natural Sciences come from S19, while CAT/IT were reissued
    // for new technologies under S9.
    const maths = review.current.find((item) => item.subject === "Mathematics");
    expect(maths!.circular).toContain("Circular S19 of 2025");
    const cat = review.current.find((item) => item.subject === "Computer Applications Technology");
    expect(cat!.circular).toContain("Circular S9 of 2025");
  });

  it("surfaces a plan as stale when it belongs to an older directive", () => {
    const review = reviewCurriculum("2026");
    // The CAT/IT plans run on 2023/24 documents but are still the plans in force
    // for 2026, so they are current and their vintage is reported alongside.
    const cat = review.current.find((item) => item.subject === "Computer Applications Technology");
    expect(cat).toBeTruthy();
    expect(cat!.documentYear).toBe("2023/24");
    expect(cat!.loadedYear).toBe("2026");
  });

  it("exposes the directives and the department index over the API", async () => {
    const c = client();
    const response = await c.get("/api/curriculum/directives");
    expect(response.status).toBe(200);
    expect(response.body.atpIndexUrl).toBe(ATP_INDEX_URL);
    const years = response.body.directives.map((directive: any) => directive.year);
    expect(years).toContain("2026");
    expect(years).toContain("2027");
    const directive = response.body.directives.find((entry: any) => entry.year === "2026");
    expect(directive.circular).toBe("Circular S19 of 2025");
    expect(Array.isArray(directive.exclusions)).toBe(true);
  });

  it("persists the directive registry and reads it back", async () => {
    const rows = await listCurriculumDirectives();
    expect(rows.length).toBe(CURRICULUM_DIRECTIVES.length);
    for (const row of rows) {
      expect(row.circular).toBeTruthy();
      expect(row.sourceUrl).toBeTruthy();
      expect(["retention", "standalone"]).toContain(row.policy);
    }
  });

  it("names the circular governing a class's subject and grade", () => {
    // A re-directed subject names its own circular...
    expect(governingCircular("Mathematics", 8)).toContain("Circular S19 of 2025");
    expect(governingCircular("Computer Applications Technology", 10)).toContain("Circular S9 of 2025");
    // ...and a retained subject names the retention circular in force.
    expect(governingCircular("Life Skills", 2)).toContain("Circular S19 of 2025");
    expect(governingCircular("English Home Language", 8)).toContain("Circular S19 of 2025");
  });

  it("exposes the governing circular on a teacher's class row", async () => {
    const { client: teacher, classes } = await registerTeacher({ grade: 8, subject: "Mathematics" });
    const response = await teacher.get("/api/tis/summary");
    const row = response.body.classes.find((entry: any) => entry.id === classes[0].id);
    // Grade 8 Mathematics is ATP-governed, so the row names the S19 circular.
    expect(row.curriculumCircular).toContain("Circular S19 of 2025");
    expect(row.curriculumFileName).toMatch(/Annual Teaching Plan/i);
  });

  it("records the 2024 Physical Sciences plans as their own directive", () => {
    const directive = directiveFor("2024");
    expect(directive).toBeTruthy();
    expect(directive!.policy).toBe("retention");
    // The FET Physical Sciences plans were published for 2024 separately from
    // the retained 2023/24 plans, so the directive names them.
    expect(directive!.exclusions).toContain("Physical Sciences");
    expect(directive!.notes).toMatch(/Physical Sciences/);
  });

  it("keeps the review endpoint behind the platform-admin gate", async () => {
    const c = client();
    // Unauthenticated: the gate rejects before any review is produced.
    const response = await c.get("/api/curriculum/review");
    expect([401, 403, 503]).toContain(response.status);
    expect(response.body.review).toBeUndefined();
  });
});
