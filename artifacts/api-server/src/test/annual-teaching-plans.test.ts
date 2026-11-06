import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { client, ensureSchemaReady, resetDatabase, startTestServer, stopTestServer } from "./harness";
import { registerTeacher } from "./fixtures";
import {
  ATP_DEFAULT_YEAR,
  atpEntryFor,
  hasDirectedAtp,
  listAnnualTeachingPlans,
  sequenceForClass,
} from "../lib/atp";
import { ATP_CATALOG } from "../lib/atp-catalog";

// The department re-directs a named set of subjects each year (Circular S19 of
// 2025). Every other subject is *retained*, so it must keep the CAPS-derived
// sequence. These tests pin that distinction: re-sequencing a retained subject
// would move live classes for no reason.
describe("Annual Teaching Plan catalog", () => {
  beforeAll(async () => { await startTestServer(); await ensureSchemaReady(); });
  afterAll(async () => { await stopTestServer(); });
  beforeEach(async () => { await resetDatabase(); });

  it("covers exactly the subjects the departmental circular re-directs", () => {
    // Circular S19 of 2025 excludes CAT, IT, Natural Sciences and Mathematics
    // for the Intermediate and Senior phases from retention.
    const directed = new Set(ATP_CATALOG.map((entry) => entry.subject));
    expect(directed).toEqual(
      new Set([
        "Mathematics",
        "Natural Sciences",
        "Natural Sciences and Technology",
        "Computer Applications Technology",
        "Information Technology",
      ]),
    );
  });

  it("only re-directs the grade ranges named in the circular", () => {
    // Mathematics Grades 4-5 and 8-9 are re-directed; Grades 6 and 7 are not,
    // even though they sit in the same multi-grade preset as directed grades.
    expect(hasDirectedAtp("Mathematics", 4)).toBe(true);
    expect(hasDirectedAtp("Mathematics", 5)).toBe(true);
    expect(hasDirectedAtp("Mathematics", 6)).toBe(false);
    expect(hasDirectedAtp("Mathematics", 8)).toBe(true);
    expect(hasDirectedAtp("Mathematics", 9)).toBe(true);
    expect(hasDirectedAtp("Mathematics", 7)).toBe(false);
    // Natural Sciences and Technology Grades 4-9 are all re-directed.
    for (const grade of [4, 5, 6]) {
      expect(hasDirectedAtp("Natural Sciences and Technology", grade)).toBe(true);
    }
    for (const grade of [7, 8, 9]) {
      expect(hasDirectedAtp("Natural Sciences", grade)).toBe(true);
    }
  });

  it("leaves retained subjects on their CAPS sequence", () => {
    // Not named in any exclusion, so these keep the CAPS-derived plan.
    for (const subject of ["Life Skills", "Social Sciences", "English Home Language", "Technology"]) {
      expect(hasDirectedAtp(subject, 5)).toBe(false);
      expect(hasDirectedAtp(subject, 8)).toBe(false);
    }
    // Foundation Phase and FET Mathematics are retained, even though other
    // grades of the same subject are re-directed.
    expect(hasDirectedAtp("Mathematics", 2)).toBe(false);
    expect(hasDirectedAtp("Mathematics", 11)).toBe(false);
  });

  it("keeps the document vintage separate from the teaching year", () => {
    // The 2026 CAT/IT plans run on 2023/24 documents, so the two fields differ.
    const cat = atpEntryFor("Computer Applications Technology", 10);
    expect(cat).not.toBeNull();
    expect(cat!.effectiveYear).toBe("2026");
    expect(cat!.documentYear).toBe("2023/24");
    expect(cat!.circular).toContain("Circular S9 of 2025");
    // The re-directed Mathematics plan is a 2026 document.
    const maths = atpEntryFor("Mathematics", 4);
    expect(maths!.effectiveYear).toBe("2026");
    expect(maths!.documentYear).toBe("2026");
  });

  it("scopes every topic to its own grade", () => {
    for (const entry of ATP_CATALOG) {
      expect(entry.sequence.length).toBeGreaterThan(0);
      for (const topic of entry.sequence) {
        expect(topic.startsWith(`Grade ${entry.grade} ·`)).toBe(true);
      }
    }
  });

  it("serves the directives over the API", async () => {
    const c = client();
    const response = await c.get(`/api/curriculum/atp`);
    expect(response.status).toBe(200);
    expect(response.body.year).toBe(ATP_DEFAULT_YEAR);
    expect(response.body.plans.length).toBe(ATP_CATALOG.length);
    const maths = response.body.plans.find((plan: any) => plan.subject === "Mathematics" && plan.grade === 4);
    expect(maths).toBeTruthy();
    expect(maths.topicCount).toBeGreaterThan(0);
    expect(maths.circular).toContain("Circular S19 of 2025");
  });

  it("prefers the ATP sequence and falls back to CAPS", async () => {
    // Re-directed subject: the ATP drives the sequence.
    const caps = ["Grade 8 · Term 1 CAPS-derived topic"];
    const directed = await sequenceForClass("Mathematics", 8, caps);
    expect(directed.source).toBe("atp");
    expect(directed.sequence).not.toEqual(caps);
    expect(directed.sequence.every((topic) => topic.startsWith("Grade 8 ·"))).toBe(true);

    // Retained subject: the CAPS sequence stands untouched.
    const retained = await sequenceForClass("Life Orientation", 8, caps);
    expect(retained.source).toBe("caps");
    expect(retained.sequence).toEqual(caps);
  });

  it("creates a class on the ATP sequence for a re-directed subject", async () => {
    const { classes } = await registerTeacher({ grade: 8, subject: "Mathematics" });
    expect(classes).toHaveLength(1);
    const sequence = classes[0].lessonSequence as string[];
    const atp = atpEntryFor("Mathematics", 8)!;
    expect(sequence).toEqual(atp.sequence);
    // The class is labelled with the ATP as its source, not the CAPS preset.
    expect(classes[0].curriculumFileName).toContain("Annual Teaching Plan");
  });

  it("creates a class on the CAPS sequence for a retained subject", async () => {
    const { classes } = await registerTeacher({ grade: 8, subject: "Life Orientation" });
    const sequence = classes[0].lessonSequence as string[];
    // Retained: the sequence comes from the CAPS preset, so it is not the ATP.
    expect(sequence).not.toEqual(atpEntryFor("Mathematics", 8)!.sequence);
    expect(classes[0].curriculumFileName).not.toContain("Annual Teaching Plan");
  });

  it("exposes the catalog table contents", async () => {
    const plans = await listAnnualTeachingPlans();
    expect(plans.length).toBe(ATP_CATALOG.length);
    for (const plan of plans) {
      expect(plan.topicCount).toBeGreaterThan(0);
      expect(plan.circular).toBeTruthy();
    }
  });
});
