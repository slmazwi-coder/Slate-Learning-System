import { db } from "@workspace/db";
import { auditLogTable } from "@workspace/db/schema";

export type AuditAction =
  | "code_rotate"
  | "tutor_invite"
  | "tutor_invite_accept"
  | "class_expel"
  | "class_learner_add"
  | "results_release"
  | "results_hold"
  | "marking_override"
  | "marking_retry"
  | "focus_mode_change"
  | "focus_reopen"
  | "focus_exemption"
  | "live_session_start"
  | "live_session_end"
  | "child_export"
  | "child_delete"
  | "hostafrica_dns_add"
  | "hostafrica_dns_edit"
  | "hostafrica_dns_delete"
  | "hostafrica_nameservers_update"
  | "hostafrica_domain_setting_update"
  // HOD supervisory events. Every HOD lifecycle step and every script an HOD
  // opens is recorded, so the class owner can always account for oversight.
  | "hod_join"
  | "hod_leave"
  | "hod_code_rotate"
  | "hod_script_access_toggle"
  | "hod_script_view"
  | "hod_support_remove";

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
