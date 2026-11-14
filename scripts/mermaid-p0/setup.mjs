import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dependencyDir = path.join(root, "scratch/mermaid-visual-editing-p0/dependencies");
const lockPath = new URL("./dependency-lock.json", import.meta.url);
const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
fs.mkdirSync(dependencyDir, { recursive: true });
fs.writeFileSync(
  path.join(dependencyDir, "package.json"),
  `${JSON.stringify(
    {
      name: lock.name,
      private: true,
      type: "module",
      // The tracked lock owns both direct pins and the full isolated dependency tree.
      dependencies: lock.packages[""].dependencies,
    },
    null,
    2,
  )}\n`,
);
fs.copyFileSync(lockPath, path.join(dependencyDir, "package-lock.json"));
const result = spawnSync("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], {
  cwd: dependencyDir,
  stdio: "inherit",
});
if (result.error) throw result.error;
if (result.status !== 0) process.exitCode = result.status ?? 1;
