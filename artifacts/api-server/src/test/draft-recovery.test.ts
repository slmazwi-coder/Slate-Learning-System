import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase, ensureSchemaReady, startTestServer, stopTestServer } from './harness';
import { registerTeacher, registerLearner, joinClass, createPublishedAssignment } from './fixtures';

describe('assignment draft recovery', () => {
  beforeAll(async () => { await startTestServer(); await ensureSchemaReady(); });
  afterAll(stopTestServer);
  beforeEach(resetDatabase);
  it('restores only the owning learner draft for an ordinary assignment', async () => {
    const teacher = await registerTeacher();
    const learner = await registerLearner();
    const other = await registerLearner();
    await joinClass(learner.client, teacher.classes[0].joinCode);
    await joinClass(other.client, teacher.classes[0].joinCode);
    const { assignmentId } = await createPublishedAssignment(teacher.client, teacher.classes[0].id, { markingMode: 'manual' });
    expect((await teacher.client.post(`/api/tis/assignments/${assignmentId}/focus-mode`, { enabled: false })).status).toBe(200);
    const opened = await learner.client.post(`/api/assignments/${assignmentId}/open`, {});
    const answers = [{ questionId: opened.body.questions[0].id, answer: 'My working' }];
    expect((await learner.client.post(`/api/assignments/${assignmentId}/focus/answers`, { sessionId: opened.body.sessionId, answers })).status).toBe(200);
    expect((await learner.client.get("/api/dashboard/summary")).body.markedCount).toBe(0);
    const reopened = await learner.client.post(`/api/assignments/${assignmentId}/open`, {});
    expect(reopened.body.draftAnswers).toEqual(answers);
    expect(reopened.body.questions[0]).not.toHaveProperty('answer');
    expect((await other.client.post(`/api/assignments/${assignmentId}/focus/answers`, { sessionId: opened.body.sessionId, answers })).status).toBe(404);
    expect((await other.client.post(`/api/assignments/${assignmentId}/open`, {})).body.draftAnswers ?? []).toEqual([]);
  });
});
