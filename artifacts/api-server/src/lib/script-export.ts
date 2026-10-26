import type { MarkedScript } from "./marked-script";

// Red-pen script rendering and export.
//
// The printed script is a sheet of the learner's own answers with the marks
// beside them. It must NEVER carry the questions, the memorandum, the correct
// answers or any AI commentary — a script that leaks the memo is worthless as an
// assessment record and worse as a privacy risk. Every renderer here reads only
// `learnerAnswer`, the marks, and the identifying header, and the test suite
// asserts that the forbidden fields never appear in the output.

// CAPS rating codes. These are the bands South African schools report against.
export function capsRating(percentage: number): number {
  if (percentage >= 80) return 7;
  if (percentage >= 70) return 6;
  if (percentage >= 60) return 5;
  if (percentage >= 50) return 4;
  if (percentage >= 40) return 3;
  if (percentage >= 30) return 2;
  return 1;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// The learner- and parent-facing view keeps its current behaviour: it still shows
// the correct answer and the marking comment, but never the marker's derived
// expected answer or its reasoning, which exist for the teacher's moderation.
export function redactScriptForAudience(script: MarkedScript): MarkedScript {
  return {
    ...script,
    questions: script.questions.map(({ derivedExpectedAnswer: _expected, reason: _reason, needsTeacherReview: _flagged, markedBy: _markedBy, ...question }) => ({
      ...question,
      derivedExpectedAnswer: "",
      reason: "",
      needsTeacherReview: false,
      markedBy: null,
    })),
  };
}

type PrintQuestion = MarkedScript["questions"][number];

// Full marks, zero, or partial. Unanswered is neither: it is a dash.
export function markGlyph(question: Pick<PrintQuestion, "awardedMarks" | "marks" | "learnerAnswer" | "score">) {
  const answered = Boolean(question.learnerAnswer && question.learnerAnswer.trim());
  if (!answered) return "unanswered" as const;
  const awarded = question.awardedMarks;
  const max = question.marks;
  if (awarded === null || awarded === undefined || max === null || max === undefined || max === 0) {
    // No marks-out-of recorded (a legacy percentage mark): fall back to the score.
    const score = question.score ?? 0;
    return score >= 100 ? ("full" as const) : score <= 0 ? ("zero" as const) : ("partial" as const);
  }
  if (awarded >= max) return "full" as const;
  if (awarded <= 0) return "zero" as const;
  return "partial" as const;
}

// A thin red tick or cross, drawn as inline SVG so nothing is fetched and the
// stroke weight is exactly what the stylesheet says.
function markSvg(kind: "full" | "partial" | "zero", size = 18): string {
  const stroke = 'fill="none" stroke="#c02626" stroke-width="1" stroke-linecap="round"';
  if (kind === "zero") {
    return `<svg class="pen-mark" width="${size}" height="${size}" viewBox="0 0 18 18" aria-hidden="true"><path ${stroke} d="M3 3 L15 15"/><path ${stroke} d="M15 3 L3 15"/></svg>`;
  }
  // A tick; a partial mark gets a shorter, lighter stroke beside it.
  return `<svg class="pen-mark" width="${size}" height="${size}" viewBox="0 0 18 18" aria-hidden="true"><path ${stroke} d="M3 10 L7 14 L15 3"/></svg>`;
}

function formatDate(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function markedByLabel(markedBy: string): string {
  if (markedBy === "TEACHER") return "Marked by the teacher";
  if (markedBy === "MIXED") return "Marked by a mix of AI against the teacher's memorandum and the teacher";
  return "Marked by AI against the teacher's memorandum";
}

// The stylesheet is inlined with the markup so a printed script is a single,
// self-contained document. A4, one script per page, and no external font: the
// handwriting stack is whatever the machine already has.
const PRINT_STYLES = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #f4f2ee; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #1b1b1b; }
  .script-page {
    width: 210mm;
    min-height: 297mm;
    margin: 0 auto 12mm;
    padding: 14mm 16mm;
    background: #fff;
    position: relative;
    display: flex;
    flex-direction: column;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .script-head { border-bottom: 1px solid #c9c5bd; padding-bottom: 4mm; }
  .script-head h1 { font-size: 15pt; margin: 0 0 1mm; }
  .script-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 1mm 8mm; font-size: 9.5pt; }
  .script-meta dt { color: #5c574f; font-size: 8pt; text-transform: uppercase; letter-spacing: .08em; margin: 0; }
  .script-meta dd { margin: 0 0 1.5mm; }
  .script-total { position: absolute; top: 12mm; right: 16mm; text-align: center; }
  .script-total .circle {
    display: inline-grid; place-items: center;
    width: 26mm; height: 26mm; border: 1.4px solid #c02626; border-radius: 50%;
    font-family: "Segoe Script", "Bradley Hand", "Comic Sans MS", cursive;
    font-size: 15pt; color: #c02626;
  }
  .script-total .label { font-size: 7.5pt; color: #5c574f; margin-top: 1mm; text-transform: uppercase; letter-spacing: .08em; }
  .rows { margin-top: 6mm; flex: 1; }
  .row { display: grid; grid-template-columns: 12mm 1fr 12mm 16mm; align-items: start; gap: 3mm; padding: 3mm 0; border-bottom: 1px solid #ece9e3; }
  .row .num { font-size: 11pt; color: #5c574f; }
  .row .answer {
    font-family: "Segoe Script", "Bradley Hand", "Comic Sans MS", cursive;
    font-size: 12pt; line-height: 1.5; min-height: 9mm; white-space: pre-wrap; word-break: break-word;
  }
  .row .answer .dash { color: #8a857d; }
  .row .pen { display: grid; place-items: center; padding-top: 1mm; }
  .row .margin-mark {
    font-family: "Segoe Script", "Bradley Hand", "Comic Sans MS", cursive;
    font-size: 10pt; color: #c02626; opacity: .72; text-align: right; padding-top: 1mm;
  }
  .script-foot { margin-top: 6mm; border-top: 1px solid #c9c5bd; padding-top: 3mm; font-size: 8.5pt; color: #5c574f; display: grid; gap: 1mm; }
  .script-foot .privacy { font-weight: 700; color: #8a2b2b; }
  .script-foot .flag { color: #8a2b2b; }
  @media print {
    @page { size: A4; margin: 10mm; }
    body { background: #fff; }
    .script-page { width: auto; min-height: auto; margin: 0; padding: 0; page-break-after: always; }
    .script-page:last-child { page-break-after: auto; }
    .no-print { display: none !important; }
  }
`;

function renderRows(script: MarkedScript): string {
  return script.questions.map((question) => {
    const glyph = markGlyph(question);
    const answered = Boolean(question.learnerAnswer && question.learnerAnswer.trim());
    const answerHtml = answered
      ? escapeHtml(question.learnerAnswer!.trim())
      : '<span class="dash">—</span>';
    // A dash for an unanswered question, otherwise a tick or a cross. Partial
    // marks show a tick with the marks awarded beside it, and the faint mark in
    // the margin always says exactly how many of the available marks were won.
    const pen = glyph === "unanswered"
      ? '<span class="dash">—</span>'
      : glyph === "partial" && question.awardedMarks !== null && question.awardedMarks !== undefined
        ? `${markSvg("partial")}<span class="margin-mark">${question.awardedMarks}</span>`
        : markSvg(glyph);
    const margin = question.awardedMarks !== null && question.awardedMarks !== undefined && question.marks
      ? `${question.awardedMarks}/${question.marks}`
      : "";
    return `<div class="row">
      <div class="num">${escapeHtml(question.questionNumber)}</div>
      <div class="answer">${answerHtml}</div>
      <div class="pen">${pen}</div>
      <div class="margin-mark">${margin ? escapeHtml(margin) : ""}</div>
    </div>`;
  }).join("\n");
}

export type PrintContext = { printedBy: string; printedAt: Date; pageNumber: number; pageCount: number };

export function renderScriptPage(script: MarkedScript, context: PrintContext): string {
  const total = script.totalMarks > 0
    ? `${script.totalAwarded}/${script.totalMarks}`
    : `${Math.round(script.score)}%`;
  const date = formatDate(script.submittedAt);
  const flags: string[] = [];
  if (script.autoSubmitted) flags.push("This paper was submitted automatically by focus mode.");
  if (script.reopenedAt) flags.push(`This paper was reopened on ${formatDate(script.reopenedAt)}.`);
  return `<section class="script-page">
  <header class="script-head">
    <div class="script-total">
      <span class="circle">${escapeHtml(total)}</span>
      <div class="label">Total</div>
    </div>
    <h1>${escapeHtml(script.class?.schoolName ?? script.assignment.schoolName ?? "Slate")}</h1>
    <dl class="script-meta">
      <div><dt>Class</dt><dd>${escapeHtml(script.class?.label ?? script.assignment.subject)}</dd></div>
      <div><dt>Learner</dt><dd>${escapeHtml(script.learner.fullName)}</dd></div>
      <div><dt>SLATE ID</dt><dd>${escapeHtml(script.learner.slateId ?? "—")}</dd></div>
      <div><dt>Assignment</dt><dd>${escapeHtml(script.assignment.title)}</dd></div>
      <div><dt>Date</dt><dd>${escapeHtml(date)}</dd></div>
      <div><dt>Mark</dt><dd>${escapeHtml(total)}</dd></div>
    </dl>
  </header>
  <div class="rows">
${renderRows(script)}
  </div>
  <footer class="script-foot">
    <div>${escapeHtml(markedByLabel(script.markedBy))}.</div>
    ${flags.map((flag) => `<div class="flag">${escapeHtml(flag)}</div>`).join("\n    ")}
    <div class="privacy">Contains learner data</div>
    <div>Printed by ${escapeHtml(context.printedBy)} on ${escapeHtml(formatDate(context.printedAt.toISOString()))} · Page ${context.pageNumber} of ${context.pageCount}</div>
  </footer>
</section>`;
}

export function renderScriptDocument(scripts: MarkedScript[], printedBy: string, printedAt = new Date()): string {
  const pages = scripts.map((script, index) => renderScriptPage(script, {
    printedBy,
    printedAt,
    pageNumber: index + 1,
    pageCount: scripts.length,
  }));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Marked scripts</title>
<style>${PRINT_STYLES}</style>
</head>
<body>
${pages.join("\n")}
</body>
</html>`;
}

export type MarksheetRow = {
  learnerName: string;
  slateId: string | null;
  awarded: number;
  total: number;
  percentage: number;
  status: string;
};

// The mark sheet: one line per learner, with the CAPS rating code that matches
// the percentage. A blank mark (a learner who has not submitted) leaves the
// percentage and the code empty rather than inventing a zero.
export function marksheetCsv(rows: MarksheetRow[]): string {
  const header = ["Learner", "SLATE ID", "Mark", "Total", "Percentage", "CAPS rating", "Status"];
  const lines = [header.join(",")];
  for (const row of rows) {
    const submitted = row.total > 0 && row.status !== "missed";
    const percentage = submitted ? Math.round(row.percentage) : null;
    lines.push([
      csvCell(row.learnerName),
      csvCell(row.slateId ?? ""),
      submitted ? String(row.awarded) : "",
      row.total ? String(row.total) : "",
      percentage === null ? "" : String(percentage),
      percentage === null ? "" : String(capsRating(percentage)),
      csvCell(row.status),
    ].join(","));
  }
  return lines.join("\r\n");
}

function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
