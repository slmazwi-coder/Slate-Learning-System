// Vercel build: emits a Build Output API v3 directory (.vercel/output) with the
// SLATE ALIS frontend as static assets and the Express API as one serverless
// function mounted at /api.
import { execFileSync } from "node:child_process";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";

const root = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(root, ".vercel", "output");
const staticDir = path.join(outputDir, "static");
const functionDir = path.join(outputDir, "functions", "api.func");

await rm(outputDir, { recursive: true, force: true });

execFileSync("pnpm", ["--filter", "@workspace/slate-alis", "run", "build"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: "production", PORT: "5000", BASE_PATH: "/" },
});

await mkdir(path.dirname(staticDir), { recursive: true });
await cp(path.join(root, "artifacts", "slate-alis", "dist", "public"), staticDir, { recursive: true });

await mkdir(functionDir, { recursive: true });

await esbuild({
  entryPoints: [path.join(root, "artifacts", "api-server", "src", "serverless.ts")],
  outfile: path.join(functionDir, "index.mjs"),
  platform: "node",
  target: "node22",
  format: "esm",
  bundle: true,
  minify: false,
  sourcemap: false,
  logLevel: "info",
  external: ["pg-native", "pino-pretty"],
  banner: {
    js: `import { createRequire as __cr } from 'node:module';
globalThis.require = __cr(import.meta.url);`,
  },
});

await writeFile(
  path.join(functionDir, "package.json"),
  `${JSON.stringify({ type: "module" }, null, 2)}\n`,
);

await writeFile(
  path.join(functionDir, ".vc-config.json"),
  `${JSON.stringify(
    {
      runtime: "nodejs22.x",
      handler: "index.mjs",
      launcherType: "Nodejs",
      shouldAddHelpers: false,
      maxDuration: 60,
    },
    null,
    2,
  )}\n`,
);

await writeFile(
  path.join(outputDir, "config.json"),
  `${JSON.stringify(
    {
      version: 3,
      routes: [
        { src: "/api(/.*)?", dest: "/api" },
        { handle: "filesystem" },
        { src: "/(.*)", dest: "/index.html" },
      ],
    },
    null,
    2,
  )}\n`,
);

console.log("Vercel build output ready at .vercel/output");
