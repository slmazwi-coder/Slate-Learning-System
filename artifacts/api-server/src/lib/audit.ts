import { db } from "@workspace/db";
import { auditLogTable } from "@workspace/db/schema";

export type AuditAction = "code_rotate" | "tutor_invite" | "tutor_invite_accept" | "class_expel";

// Immutable record of staff actions taken on a class (code rotation, tutor
// invitations, member expulsions). Auditing failures are swallowed so a
// broken audit write never blocks the underlying action.
export async function recordAudit(entry: {
  actorUserId: string;
  actorRole: string;
  action: AuditAction;
  classId?: string | null;
  memberId?: string | null;
  memberType?: string | null;
  detail?: string;
}) {
  try {
    await db.insert(auditLogTable).values({
      actorUserId: entry.actorUserId,
      actorRole: entry.actorRole,
      action: entry.action,
      classId: entry.classId ?? null,
      targetMemberId: entry.memberId ?? null,
      memberType: entry.memberType ?? null,
      detail: entry.detail ?? "",
    });
  } catch {
    // audited action already succeeded; avoid double failure
  }
}
