// Read-only learner/account search over the Supabase REST (PostgREST) API.
// Use this when a Postgres connection string is unavailable but the project's
// service_role key is. Passwords are scrypt hashes and are never returned.
//
//   SUPABASE_SERVICE_ROLE_KEY=... pnpm --filter @workspace/scripts run find-learner-rest uluthando mazwi
//   SUPABASE_SERVICE_ROLE_KEY=... pnpm --filter @workspace/scripts run find-learner-rest --since 2026-10-04 --all
//
// SUPABASE_URL defaults to the Slate project; override it for other projects.
const SUPABASE_URL = (process.env.SUPABASE_URL ?? "https://daxutrsgtifscygmetba.supabase.co").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) {
  console.error("SUPABASE_SERVICE_ROLE_KEY must be set (Settings -> API Keys -> service_role).");
  process.exit(1);
}

const argv = process.argv.slice(2);
const sinceIndex = argv.indexOf("--since");
const includeAll = argv.includes("--all");
const since = sinceIndex >= 0 ? argv[sinceIndex + 1] : undefined;
const words = argv.filter((arg, index) => !arg.startsWith("--") && (sinceIndex < 0 || index !== sinceIndex + 1));

if (!since && words.length === 0) {
  console.error("usage: find-learner-rest <query...>\n       find-learner-rest --since <YYYY-MM-DD> [--all]");
  process.exit(1);
}
if (since && Number.isNaN(Date.parse(since))) {
  console.error(`--since needs a date like 2026-10-04 (got "${since}").`);
  process.exit(1);
}

const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

async function rest<T = unknown>(path: string, extra: Record<string, string> = {}): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { ...headers, ...extra } });
  if (!res.ok) throw new Error(`REST ${res.status} on ${path}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

async function count(table: string, filter: string): Promise<number> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=id&${filter}&limit=1`, {
    headers: { ...headers, Prefer: "count=exact", Range: "0-0" },
  });
  const range = res.headers.get("content-range");
  return range ? Number(range.split("/")[1]) : 0;
}

type Learner = {
  id: string;
  username: string;
  email: string | null;
  full_name: string;
  grade: number;
  school_name: string;
  subjects: string[] | null;
  user_id: string | null;
  parent_id: string | null;
  created_at: string;
};

const iso = (value: string | null | undefined) => (value ? new Date(value).toISOString() : "never");

async function describeLearner(l: Learner) {
  const [classes, parentLinks, identity, sessionCount, lastSessions, submissionCount] = await Promise.all([
    rest<{ subject: string; slate_classes: { grade: number; section: string; school_name: string; join_code: string } | null }[]>(
      `slate_class_learners?select=subject,slate_classes(grade,section,school_name,join_code)&learner_id=eq.${l.id}`,
    ),
    rest<{ slate_parents: { full_name: string; email: string } | null }[]>(
      `slate_parent_learners?select=slate_parents(full_name,email)&learner_id=eq.${l.id}`,
    ),
    l.email || !l.user_id
      ? Promise.resolve<{ email: string }[]>([])
      : rest<{ email: string }[]>(`slate_users?select=email&id=eq.${l.user_id}`),
    count("slate_learner_sessions", `learner_id=eq.${l.id}`),
    rest<{ login_at: string }[]>(`slate_learner_sessions?select=login_at&learner_id=eq.${l.id}&order=login_at.desc&limit=1`),
    count("slate_submissions", `learner_id=eq.${l.id}`),
  ]);

  console.log("─".repeat(70));
  console.log(`id          : ${l.id}`);
  console.log(`LOGIN USER  : ${l.username}`);
  console.log(`email       : ${l.email ?? identity[0]?.email ?? "(none)"}`);
  console.log(`full name   : ${l.full_name}`);
  console.log(`grade       : ${l.grade}`);
  console.log(`school      : ${l.school_name}`);
  console.log(`subjects    : ${(l.subjects ?? []).join(", ") || "(none)"}`);
  console.log(`created     : ${iso(l.created_at)}`);
  const parents = parentLinks.map((p) => p.slate_parents).filter(Boolean) as { full_name: string; email: string }[];
  console.log(`parent link : ${parents.map((p) => `${p.full_name} <${p.email}>`).join("; ") || (l.parent_id ? `legacy parent_id ${l.parent_id}` : "(none)")}`);
  console.log(
    `classes     : ${classes
      .map((c) => `${c.subject}${c.slate_classes ? ` (Gr ${c.slate_classes.grade}${c.slate_classes.section ? " " + c.slate_classes.section : ""} @ ${c.slate_classes.school_name}, code ${c.slate_classes.join_code})` : ""}`)
      .join("; ") || "(none)"}`,
  );
  console.log(`sessions    : ${sessionCount} (last login ${iso(lastSessions[0]?.login_at)})`);
  console.log(`submissions : ${submissionCount}`);
}

const learnerSelect =
  "select=id,username,email,full_name,grade,school_name,subjects,user_id,parent_id,tutor_id,created_at";

try {
  if (since) {
    const learners = await rest<Learner[]>(`slate_learners?${learnerSelect}&created_at=gte.${since}&order=created_at.desc`);
    console.log(`Learners created on/after ${since}: ${learners.length}`);
    for (const l of learners) await describeLearner(l);
    console.log("─".repeat(70));

    if (includeAll) {
      for (const table of ["slate_parents", "slate_teachers", "slate_tutors"] as const) {
        const adults = await rest<{ id: string; email: string; full_name: string; created_at: string }[]>(
          `${table}?select=id,email,full_name,created_at&created_at=gte.${since}&order=created_at.desc`,
        );
        if (adults.length === 0) continue;
        console.log(`${table.replace("slate_", "")} accounts created on/after ${since}: ${adults.length}`);
        for (const a of adults) console.log(`  ${iso(a.created_at)}  ${a.full_name} <${a.email}>  id=${a.id}`);
        console.log("─".repeat(70));
      }
    }
  } else {
    const pattern = words.join("*");
    const filter = ["username", "full_name", "email"].map((col) => `${col}.ilike.*${pattern}*`).join(",");
    const learners = await rest<Learner[]>(`slate_learners?${learnerSelect}&or=(${filter})&order=created_at.desc`);
    if (learners.length === 0) {
      console.log(`No learner matched "${words.join(" ")}".`);
      process.exit(0);
    }
    for (const l of learners) await describeLearner(l);
    console.log("─".repeat(70));
  }
  console.log("Passwords are stored as scrypt hashes and cannot be recovered. Issue a");
  console.log("reset at /recover with the email above, or via POST /auth/recover/reset.");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

export {};
