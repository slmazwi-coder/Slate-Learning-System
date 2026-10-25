// Age Thirty4 support removal of an HOD from a class. This is deliberately NOT
// an HTTP route: a teacher must never be able to remove, block or hide a class
// from an HOD, so the only way a membership ends other than the HOD leaving is
// a support action run by an operator with database access. The script records
// who requested it and who approved it, and writes an audit entry so the
// removal is attributable.
//
//   DATABASE_URL=... pnpm --filter @workspace/scripts run hod:remove \
//     --class <classId> --hod <hodUserId> --requested-by <name> --approved-by <name> \
//     --reason "moved to another school"
//
// The audit row needs an actor_user_id (NOT NULL FK to slate_users), so the
// script requires a support account to attribute the action to:
//   --actor <supportUserId>   (defaults to the HOD being removed is NOT used;
//                              pass --actor explicitly in production)
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

// pnpm isolates node_modules per package and the scripts package does not
// depend on pg directly; anchor the require at the db package that does.
const require = createRequire(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../lib/db/src/index.ts"),
);
const { Pool } = require("pg");

type Options = {
  classId: string;
  hodUserId: string;
  requestedBy: string;
  approvedBy: string;
  reason: string;
  actorUserId: string;
  dryRun: boolean;
};

function readOption(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function usage(): never {
  console.error(
    "usage: hod:remove --class <classId> --hod <hodUserId> --requested-by <name> --approved-by <name> --reason <text> [--actor <supportUserId>] [--dry-run]",
  );
  process.exit(1);
}

function parseOptions(): Options {
  const argv = process.argv.slice(2);
  const classId = readOption(argv, "--class");
  const hodUserId = readOption(argv, "--hod");
  const requestedBy = readOption(argv, "--requested-by");
  const approvedBy = readOption(argv, "--approved-by");
  const reason = readOption(argv, "--reason");
  if (!classId || !hodUserId || !requestedBy || !approvedBy || !reason) usage();
  return {
    classId,
    hodUserId,
    requestedBy,
    approvedBy,
    reason,
    actorUserId: readOption(argv, "--actor") ?? hodUserId,
    dryRun: argv.includes("--dry-run"),
  };
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL must be set (the production Postgres connection string).");
  process.exit(1);
}

const options = parseOptions();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const active = await pool.query(
    `SELECT h.id, h.class_id, h.hod_user_id, u.full_name, u.email, c.subject, c.grade, c.section
       FROM slate_class_hods h
       JOIN slate_users u ON u.id = h.hod_user_id
       JOIN slate_classes c ON c.id = h.class_id
      WHERE h.class_id = $1 AND h.hod_user_id = $2
        AND h.left_at IS NULL AND h.removed_at IS NULL`,
    [options.classId, options.hodUserId],
  );
  if (active.rowCount === 0) {
    console.error(`No active HOD membership for class ${options.classId} and HOD ${options.hodUserId}.`);
    process.exit(1);
  }
  const membership = active.rows[0] as {
    id: string;
    full_name: string;
    email: string;
    subject: string;
    grade: number;
    section: string;
  };
  const detail =
    `Support removal of HOD ${membership.full_name} <${membership.email}> from `
    + `${membership.subject} (grade ${membership.grade}${membership.section || ""}). `
    + `Requested by: ${options.requestedBy}. Approved by: ${options.approvedBy}. Reason: ${options.reason}.`;

  if (options.dryRun) {
    console.log("Dry run — no change made.");
    console.log(detail);
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE slate_class_hods
          SET removed_at = now(), removed_by = $1, removal_reason = $2
        WHERE id = $3 AND removed_at IS NULL`,
      [`${options.approvedBy} (approved) / ${options.requestedBy} (requested)`, options.reason, membership.id],
    );
    await client.query(
      `INSERT INTO slate_audit_log (actor_user_id, actor_role, action, class_id, target_member_id, member_type, detail)
       VALUES ($1, 'SUPPORT', 'hod_support_remove', $2, $3, 'hod', $4)`,
      [options.actorUserId, options.classId, options.hodUserId, detail],
    );
    await client.query("COMMIT");
    console.log(`Removed HOD ${membership.full_name} from class ${options.classId}.`);
    console.log(detail);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

main()
  .then(() => pool.end())
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : error);
    await pool.end();
    process.exit(1);
  });
