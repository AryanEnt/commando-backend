const { spawnSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const clientJs = path.join(root, "node_modules", ".prisma", "client", "index.js");

const result = spawnSync("npx", ["prisma", "generate"], {
  cwd: root,
  stdio: "inherit",
  shell: true,
});

if (result.status === 0) {
  process.exit(0);
}

if (existsSync(clientJs)) {
  console.warn(
    "prisma generate could not replace the query engine (the API server is likely running and has it locked). Using the existing Prisma client.",
  );
  process.exit(0);
}

process.exit(result.status ?? 1);
