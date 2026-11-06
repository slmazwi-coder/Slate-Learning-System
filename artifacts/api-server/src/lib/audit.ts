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
  // Automatic submit gave up (or a teacher retried it by hand). The learner's
  // answers are still on the session; the teacher needs to know.
  | "focus_auto_submit_failed"
  | "focus_auto_submit_retry"
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
  | "hod_support_remove"
  // Memorandum and marks events. A memo revision after the first submission is
  // the most sensitive of these: it changes marks a learner may already have
  // seen, so it always carries the reason the teacher gave.
  | "memo_save"
  | "memo_confirm"
  | "memo_revise"
  | "memo_extract"
  | "script_print"
  | "marksheet_export"
  // Support contact. Only the fact of the click, the role, the category and
  // the time are recorded; the message content is never logged.
  | "support_contact_click"
  // Zone engine. A cut-off change alters how every learner in the class is
  // banded, so it is audited with the old and the new values. An intervention is
  // the teacher's own support record and is audited too, so the HOD can see that
  // a red learner was picked up.
  | "zone_settings_change"
  | "zone_parent_visibility"
  | "zone_intervention";

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
