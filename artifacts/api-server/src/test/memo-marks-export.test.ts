import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { ensureSchemaReady, resetDatabase, startTestServer, stopTestServer } from "./harness";
import {
  createPublishedAssignment,
  joinClass,
  memoAwareMarkingModel,
  registerLearner,
  registerTeacher,
  SAMPLE_QUESTIONS,
  submitAssignment,
} from "./fixtures";
import { setGeminiModelForTesting, setGeminiSleepForTesting } from "../lib/ai";
import { capsRating, marksheetCsv, redactScriptForAudience, renderScriptDocument } from "../lib/script-export";

const answers = SAMPLE_QUESTIONS.map((question) => ({ questionId: question.id, answer: question.answer }));

// The memorandum is a publish prerequisite, marks per question drive the total,
// and the exported script must never carry the memo or the correct answers.
describe("marks per question, memorandum and script export", () => {
  beforeAll(async () => {
    await startTestServer();
    await ensureSchemaReady();
    setGeminiSleepForTesting(async () => {});
    setGeminiModelForTesting(memoAwareMarkingModel({ ratio: 1 }));
  });
  afterAll(async () => {
    await stopTestServer();
    setGeminiModelForTesting(null);
    setGeminiSleepForTesting(null);
  });
  beforeEach(async () => { await resetDatabase(); });

  it("refuses to publish until every numbered question has a confirmed memorandum", async () => {
    const { client: teacher, classes } = await registerTeacher();
    const created = await teacher.post("/api/tis/assignments", {
      classIds: [classes[0].id],
      topic: "Equivalent fractions",
      questionCount: SAMPLE_QUESTIONS.length,
      openAt: new Date(Date.now() - 60_000).toISOString(),
      closeAt: new Date(Date.now() + 3_600_000).toISOString(),
      markingMode: "auto",
      questionSource: "manual",
      questions: SAMPLE_QUESTIONS,
    });
    expect(created.status).toBe(201);
    const assignmentId = created.body.assignments[0].id;

    // No memorandum yet: publish is refused and names the gate.
    const withoutMemo = await teacher.post(`/api/tis/assignments/${assignmentId}/publish`, { questions: SAMPLE_QUESTIONS });
    expect(withoutMemo.status).toBe(400);
    expect(withoutMemo.body.requiresConfirmedMemo).toBe(true);

    // A draft memorandum is still not enough: it must be confirmed.
    const draft = await teacher.post(`/api/tis/assignments/${assignmentId}/memo`, {
      source: "TEACHER",
      items: SAMPLE_QUESTIONS.map((question) => ({
        questionNumber: question.questionNumber,
        modelAnswer: question.answer,
        markingGuide: "Full marks for the correct answer.",
        acceptableAlternatives: [],
      })),
    });
    expect(draft.status).toBe(200);
    const stillDraft = await teacher.post(`/api/tis/assignments/${assignmentId}/publish`, { questions: SAMPLE_QUESTIONS });
    expect(stillDraft.status).toBe(400);
    expect(stillDraft.body.requiresConfirmedMemo).toBe(true);

    // Confirming it opens the gate.
    const confirmed = await teacher.post(`/api/tis/assignments/${assignmentId}/memo`, {
      source: "TEACHER",
      confirm: true,
      samplesChecked: true,
      items: SAMPLE_QUESTIONS.map((question) => ({
        questionNumber: question.questionNumber,
        modelAnswer: question.answer,
        markingGuide: "Full marks for the correct answer.",
        acceptableAlternatives: [],
      })),
    });
    expect(confirmed.status).toBe(200);
    const published = await teacher.post(`/api/tis/assignments/${assignmentId}/publish`, { questions: SAMPLE_QUESTIONS });
    expect(published.status).toBe(200);
    expect(published.body.isPublished).toBe(true);
  });

  it("scores the paper from the marks awarded over the marks available", async () => {
    const { client: teacher, classes } = await registerTeacher();
    // 10 + 10 + 10 = 30 marks available; the mock awards all of them.
    const { assignmentId } = await createPublishedAssignment(teacher, classes[0].id, { markingMode: "auto" });
    const { client: learner } = await registerLearner();
    await joinClass(learner, classes[0].joinCode);
    const submitted = await submitAssignment(learner, assignmentId, answers);
    expect(submitted.body.markingStatus).toBe("MARKED");
    // The score is withheld until the teacher releases it.
    expect(submitted.body.score).toBeNull();
    await teacher.post(`/api/tis/assignments/${assignmentId}/release-results`, { action: "release" });
    const review = await learner.get(`/api/assignments/${assignmentId}/review`);
    // 30 marks awarded out of 30 available.
    expect(review.body.score).toBe(100);

    const memo = await teacher.get(`/api/tis/assignments/${assignmentId}/memo`);
    expect(memo.status).toBe(200);
    expect(memo.body.totalMarks).toBe(30);
    expect(memo.body.memo.status).toBe("confirmed");
    expect(memo.body.memo.items).toHaveLength(3);
  });

  it("shows the teacher a mark sheet with the CAPS rating for each learner", async () => {
    const { client: teacher, classes } = await registerTeacher();
    const { assignmentId } = await createPublishedAssignment(teacher, classes[0].id, { markingMode: "auto" });
    const { client: learner, learner: learnerRow } = await registerLearner();
    await joinClass(learner, classes[0].joinCode);
    await submitAssignment(learner, assignmentId, answers);

    const csv = await teacher.get(`/api/tis/assignments/${assignmentId}/marksheet.csv`);
    expect(csv.status).toBe(200);
    expect(csv.body).toContain("Learner");
    expect(csv.body).toContain("CAPS rating");
    // 100% is a CAPS 7.
    expect(csv.body).toContain(learnerRow.fullName);
    expect(csv.body).toContain(",7,");
  });

  it("prints the learner's answers with the marks, and never the memo or the correct answers", async () => {
    const { client: teacher, classes } = await registerTeacher();
    const { assignmentId } = await createPublishedAssignment(teacher, classes[0].id, { markingMode: "auto" });
    const { client: learner } = await registerLearner();
    await joinClass(learner, classes[0].joinCode);
    await submitAssignment(learner, assignmentId, answers);

    const print = await teacher.get(`/api/tis/assignments/${assignmentId}/scripts/print`);
    expect(print.status).toBe(200);
    expect(print.body).toContain("script-page");
    // The sheet carries the learner's own answers and the marks beside them.
    // It deliberately does NOT reproduce the questions.
    expect(print.body).toContain('class="margin-mark">10/10');
    expect(print.body).toContain('class="answer">4');
    expect(print.body).not.toContain("What is 2 + 2?");
    // The memorandum's marking method and the correct answer are not.
    expect(print.body).not.toContain("Full marks for the correct answer.");
    expect(print.body).not.toContain("Memorandum");
  });
});

describe("script export redaction (unit)", () => {
  it("maps a percentage to the CAPS rating band", () => {
    expect(capsRating(100)).toBe(7);
    expect(capsRating(80)).toBe(7);
    expect(capsRating(79)).toBe(6);
    expect(capsRating(60)).toBe(5);
    expect(capsRating(50)).toBe(4);
    expect(capsRating(40)).toBe(3);
    expect(capsRating(30)).toBe(2);
    expect(capsRating(29)).toBe(1);
  });

  it("strips the marker's private fields but keeps the learner-facing ones", () => {
    const script = {
      learner: { fullName: "Thandi M", slateId: "L000123" },
      assignment: { title: "Fractions", subject: "Mathematics", schoolName: "Slate" },
      class: null,
      score: 80,
      totalAwarded: 8,
      totalMarks: 10,
      submittedAt: new Date().toISOString(),
      autoSubmitted: false,
      reopenedAt: null,
      markedBy: "AI",
      questions: [{
        questionNumber: "1",
        learnerAnswer: "4",
        score: 80,
        awardedMarks: 8,
        marks: 10,
        correctAnswer: "4",
        explanation: "Correct.",
        // Teacher-only: must be redacted for a learner or parent.
        derivedExpectedAnswer: "The sum of two and two.",
        reason: "The memo says the method earns the mark.",
        needsTeacherReview: true,
        markedBy: "AI",
      }],
    } as never;
    const redacted = redactScriptForAudience(script);
    expect(redacted.questions[0].derivedExpectedAnswer).toBe("");
    expect(redacted.questions[0].reason).toBe("");
    expect(redacted.questions[0].needsTeacherReview).toBe(false);
    expect(redacted.questions[0].markedBy).toBeNull();
    // The learner still sees their own answer, the mark and the correct answer.
    expect(redacted.questions[0].learnerAnswer).toBe("4");
    expect(redacted.questions[0].awardedMarks).toBe(8);
    expect(redacted.questions[0].correctAnswer).toBe("4");
  });

  it("leaves a not-submitted learner's percentage and rating blank on the mark sheet", () => {
    const csv = marksheetCsv([
      { learnerName: "Thandi M", slateId: "L000123", awarded: 8, total: 10, percentage: 80, status: "submitted" },
      { learnerName: "Sipho N", slateId: "L000124", awarded: 0, total: 30, percentage: 0, status: "missed" },
    ]);
    const [, thandi, sipho] = csv.split("\n");
    expect(thandi).toContain(",80,7,submitted");
    // A missed paper is not a zero: no percentage and no rating.
    expect(sipho).toBe("Sipho N,L000124,,30,,,missed");
  });

  it("escapes HTML in a learner's answer so a script cannot inject markup", () => {
    const script = {
      learner: { fullName: "Thandi M", slateId: "L000123" },
      assignment: { title: "Fractions", subject: "Mathematics", schoolName: "Slate" },
      class: null,
      score: 0,
      totalAwarded: 0,
      totalMarks: 10,
      submittedAt: new Date().toISOString(),
      autoSubmitted: false,
      reopenedAt: null,
      markedBy: "AI",
      questions: [{
        questionNumber: "1",
        learnerAnswer: "<script>alert(1)</script>",
        score: 0,
        awardedMarks: 0,
        marks: 10,
        correctAnswer: "4",
        explanation: "",
        derivedExpectedAnswer: "",
        reason: "",
        needsTeacherReview: false,
        markedBy: null,
      }],
    } as never;
    const html = renderScriptDocument([script], "Ms Teacher");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
