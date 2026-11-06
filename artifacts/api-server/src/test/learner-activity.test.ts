import { describe, expect, it } from "vitest";
import type { LearnerSession } from "@workspace/db/schema";
import { summarizeLearnerActivityRows } from "../lib/learner-activity";

describe("learner activity summaries", () => {
  it("counts every session in totals while limiting recent visits to ten", () => {
    const now = new Date(2026, 10, 7, 14, 30);
    const todayRows: LearnerSession[] = Array.from({ length: 12 }, (_, index) => {
      const loginAt = new Date(2026, 10, 7, 12, index);
      return {
        id: `session-${index}`,
        learnerId: "learner-1",
        loginAt,
        lastSeenAt: new Date(loginAt.getTime() + 5 * 60_000),
        logoutAt: new Date(loginAt.getTime() + 5 * 60_000),
        durationMinutes: 5,
        createdAt: now,
      };
    });
    const yesterdayLogin = new Date(2026, 10, 6, 12);
    const rows = [
      ...todayRows,
      {
        id: "yesterday",
        learnerId: "learner-1",
        loginAt: yesterdayLogin,
        lastSeenAt: new Date(yesterdayLogin.getTime() + 7 * 60_000),
        logoutAt: new Date(yesterdayLogin.getTime() + 7 * 60_000),
        durationMinutes: 7,
        createdAt: now,
      },
    ].sort((a, b) => b.loginAt.getTime() - a.loginAt.getTime());

    const summary = summarizeLearnerActivityRows(rows, now);

    expect(summary.todaySessions).toBe(12);
    expect(summary.todayMinutes).toBe(60);
    expect(summary.weekMinutes).toBe(67);
    expect(summary.monthMinutes).toBe(67);
    expect(summary.recent).toHaveLength(10);
  });
});
