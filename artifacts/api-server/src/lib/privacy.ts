// POPIA privacy notice. The version is stored on every child account created
// by a parent or tutor, together with the timestamp the adult accepted it, so
// consent is provable.
export const PRIVACY_NOTICE_VERSION = "2026-01";

// What Slate stores for a learner, and the fact that answers and uploaded files
// are processed by an external AI service. Shown as the consent checkbox text
// when a parent or tutor creates a child account.
export const CONSENT_SUMMARY =
  "I confirm I am the parent or legal guardian of this child (or their tutor acting with the guardian's consent), "
  + "and I consent to Slate storing their name, grade, school, date of birth, gender, home language, answers and "
  + "learning profile. I understand that the child's answers and any files uploaded for them are sent to an external "
  + "AI service (Google Gemini) for question generation, marking and feedback. I have read the privacy notice and I "
  + "may withdraw consent at any time by asking Slate to export or delete the child's data.";

export const PRIVACY_NOTICE_PATH = "/privacy";
