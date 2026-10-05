// Read-only learner search. Passwords are scrypt hashes and cannot be read
// back; this prints the login identity (username + stored email) and the
// surrounding records so a support request like "find this learner" can be
// resolved, then a reset issued via /recover.
//
//   DATABASE_URL=... pnpm --filter @workspace/scripts run find-learner <query...>
//
// <query> is one or more words matched (case-insensitively) against the learner
// username, full name and email. Example:
//   DATABASE_URL=... pnpm --filter @workspace/scripts run find-learner uluthando mazwi
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

// pnpm isolates node_modules per package, and the scripts package does not
// depend on pg directly; anchor the require at the db package that does.
const require = createRequire(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../lib/db/src/index.ts"),
);
const { Pool } = require("pg");

const words = process.argv.slice(2).filter(Boolean);
if (words.length === 0) {
  console.error("usage: find-learner <query...>   (e.g. find-learner uluthando mazwi)");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL must be set (the production Postgres connection string).");
  process.exit(1);
}

const like = `%${words.join("%")}%`;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
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
  );

  if (rows.length === 0) {
    console.log(`No learner matched "${words.join(" ")}".`);
    process.exit(0);
  }

  for (const r of rows) {
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
      pool.query(
        `SELECT count(*)::int AS n FROM slate_submissions WHERE learner_id = $1`,
        [r.id],
      ),
    ]);

    console.log("─".repeat(70));
    console.log(`id          : ${r.id}`);
    console.log(`LOGIN USER  : ${r.username}`);
    console.log(`email       : ${r.email ?? r.identity_email ?? "(none)"}`);
    console.log(`full name   : ${r.full_name}`);
    console.log(`grade       : ${r.grade}`);
    console.log(`school      : ${r.school_name}`);
    console.log(`subjects    : ${(r.subjects ?? []).join(", ") || "(none)"}`);
    console.log(`created     : ${r.created_at?.toISOString?.() ?? r.created_at}`);
    console.log(`parent link : ${parents.rows.map((p: { full_name: string; email: string }) => `${p.full_name} <${p.email}>`).join("; ") || (r.parent_id ? `legacy parent_id ${r.parent_id}` : "(none)")}`);
    console.log(`classes     : ${classes.rows.map((c: { subject: string; grade: number; section: string; school_name: string; join_code: string }) => `${c.subject} (Gr ${c.grade}${c.section ? " " + c.section : ""} @ ${c.school_name}, code ${c.join_code})`).join("; ") || "(none)"}`);
    console.log(`sessions    : ${sessions.rows[0].n} (last login ${sessions.rows[0].last_login?.toISOString?.() ?? "never"})`);
    console.log(`submissions : ${submissions.rows[0].n}`);
  }
  console.log("─".repeat(70));
  console.log("Passwords are stored as scrypt hashes and cannot be recovered. Issue a");
  console.log("reset at /recover with the email above, or via POST /auth/recover/reset.");
} finally {
  await pool.end();
}
