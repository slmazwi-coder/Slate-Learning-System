// Read-only learner/account search. Passwords are scrypt hashes and cannot be
// read back; this prints the login identity (username + stored email) and the
// surrounding records so a support request like "find this learner" can be
// resolved, then a reset issued via /recover.
//
//   DATABASE_URL=... pnpm --filter @workspace/scripts run find-learner <query...>
//   DATABASE_URL=... pnpm --filter @workspace/scripts run find-learner --since 2026-10-04
//   DATABASE_URL=... pnpm --filter @workspace/scripts run find-learner --since 2026-10-04 --all
//
// <query> is one or more words matched (case-insensitively) against the learner
// username, full name and email. `--since` lists every learner created on or
// after that date; add `--all` to also list parent/teacher/tutor accounts.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

// pnpm isolates node_modules per package, and the scripts package does not
// depend on pg directly; anchor the require at the db package that does.
const require = createRequire(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../lib/db/src/index.ts"),
);
const { Pool } = require("pg");

type LearnerRow = {
  id: string;
  username: string;
  email: string | null;
  full_name: string;
  grade: number;
  school_name: string;
  subjects: string[] | null;
  user_id: string | null;
  parent_id: string | null;
  tutor_id: string | null;
  created_at: Date | string;
  identity_email: string | null;
};

type AdultRow = {
  id: string;
  email: string;
  full_name: string;
  created_at: Date | string;
  role: string;
};

const argv = process.argv.slice(2);
const sinceIndex = argv.indexOf("--since");
const includeAll = argv.includes("--all");
const since = sinceIndex >= 0 ? argv[sinceIndex + 1] : undefined;
const words = argv.filter((arg, index) => !arg.startsWith("--") && (sinceIndex < 0 || index !== sinceIndex + 1));

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL must be set (the production Postgres connection string).");
  process.exit(1);
}
if (!since && words.length === 0) {
  console.error(
    "usage: find-learner <query...>\n" +
      "       find-learner --since <YYYY-MM-DD> [--all]",
  );
  process.exit(1);
}
if (since && Number.isNaN(Date.parse(since))) {
  console.error(`--since needs a date like 2026-10-04 (got "${since}").`);
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const iso = (value: Date | string | null | undefined) =>
  value ? (value instanceof Date ? value.toISOString() : new Date(value).toISOString()) : "never";

async function describeLearner(r: LearnerRow) {
  const [classes, parents, sessions, submissions] = await Promise.all([
    pool.query(
      `SELECT c.subject, c.grade, c.section, c.school_name, c.join_code
         FROM slate_class_learners cl JOIN slate_classes c ON c.id = cl.class_id
        WHERE cl.learner_id = $1 ORDER BY c.created_at`,
      [r.id],
    ),
    pool.query(
      `SELECT p.full_name, p.email
         FROM slate_parent_learners pl JOIN slate_parents p ON p.id = pl.parent_id
        WHERE pl.learner_id = $1`,
      [r.id],
    ),
    pool.query(
      `SELECT count(*)::int AS n, max(login_at) AS last_login
         FROM slate_learner_sessions WHERE learner_id = $1`,
      [r.id],
    ),
    pool.query(`SELECT count(*)::int AS n FROM slate_submissions WHERE learner_id = $1`, [r.id]),
  ]);

  console.log("─".repeat(70));
  console.log(`id          : ${r.id}`);
  console.log(`LOGIN USER  : ${r.username}`);
  console.log(`email       : ${r.email ?? r.identity_email ?? "(none)"}`);
  console.log(`full name   : ${r.full_name}`);
  console.log(`grade       : ${r.grade}`);
  console.log(`school      : ${r.school_name}`);
  console.log(`subjects    : ${(r.subjects ?? []).join(", ") || "(none)"}`);
  console.log(`created     : ${iso(r.created_at)}`);
  console.log(
    `parent link : ${parents.rows.map((p: { full_name: string; email: string }) => `${p.full_name} <${p.email}>`).join("; ") || (r.parent_id ? `legacy parent_id ${r.parent_id}` : "(none)")}`,
  );
  console.log(
    `classes     : ${classes.rows.map((c: { subject: string; grade: number; section: string; school_name: string; join_code: string }) => `${c.subject} (Gr ${c.grade}${c.section ? " " + c.section : ""} @ ${c.school_name}, code ${c.join_code})`).join("; ") || "(none)"}`,
  );
  console.log(`sessions    : ${sessions.rows[0].n} (last login ${iso(sessions.rows[0].last_login)})`);
  console.log(`submissions : ${submissions.rows[0].n}`);
}

try {
  if (since) {
    const { rows } = await pool.query(
      `SELECT l.id, l.username, l.email, l.full_name, l.grade, l.school_name,
              l.subjects, l.user_id, l.parent_id, l.tutor_id, l.created_at,
              u.email AS identity_email
         FROM slate_learners l
         LEFT JOIN slate_users u ON u.id = l.user_id
        WHERE l.created_at >= $1::date
        ORDER BY l.created_at DESC`,
      [since],
    ) as { rows: LearnerRow[] };
    console.log(`Learners created on/after ${since}: ${rows.length}`);
    for (const r of rows) await describeLearner(r);
    console.log("─".repeat(70));

    if (includeAll) {
      for (const table of ["slate_parents", "slate_teachers", "slate_tutors"] as const) {
        const { rows: adults } = await pool.query(
          `SELECT id, email, full_name, created_at, '${table}' AS role
             FROM ${table} WHERE created_at >= $1::date ORDER BY created_at DESC`,
          [since],
        ) as { rows: AdultRow[] };
        if (adults.length === 0) continue;
        console.log(`${table.replace("slate_", "")} accounts created on/after ${since}: ${adults.length}`);
        for (const a of adults) {
          console.log(`  ${iso(a.created_at)}  ${a.full_name} <${a.email}>  id=${a.id}`);
        }
        console.log("─".repeat(70));
      }
    }
    console.log("Passwords are stored as scrypt hashes and cannot be recovered. Issue a");
    console.log("reset at /recover with the email above, or via POST /auth/recover/reset.");
    process.exit(0);
  }

  const like = `%${words.join("%")}%`;
  const { rows } = await pool.query(
    `SELECT l.id, l.username, l.email, l.full_name, l.grade, l.school_name,
            l.subjects, l.user_id, l.parent_id, l.tutor_id, l.created_at,
            u.email AS identity_email
       FROM slate_learners l
       LEFT JOIN slate_users u ON u.id = l.user_id
      WHERE l.username ILIKE $1 OR l.full_name ILIKE $1
         OR COALESCE(l.email, u.email) ILIKE $1
      ORDER BY l.created_at DESC`,
    [like],
  ) as { rows: LearnerRow[] };

  if (rows.length === 0) {
    console.log(`No learner matched "${words.join(" ")}".`);
    process.exit(0);
  }
  for (const r of rows) await describeLearner(r);
  console.log("─".repeat(70));
  console.log("Passwords are stored as scrypt hashes and cannot be recovered. Issue a");
  console.log("reset at /recover with the email above, or via POST /auth/recover/reset.");
} finally {
  await pool.end();
}
