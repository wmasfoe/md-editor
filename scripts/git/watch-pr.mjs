#!/usr/bin/env node
import { execSync, spawn } from "node:child_process";

function getActiveBranch() {
  try {
    return execSync("git branch --show-current", { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function findPullRequest(branch) {
  try {
    const output = execSync(`gh pr list --head "${branch}" --json number,url,title,state`, {
      encoding: "utf8",
    });
    const prs = JSON.parse(output);
    return prs.find((pr) => pr.state === "OPEN") || null;
  } catch {
    return null;
  }
}

async function main() {
  const branch = getActiveBranch();
  if (!branch) {
    console.log("⚠️ Unable to determine current git branch.");
    process.exit(0);
  }

  console.log(`🔍 Checking for open PR on branch: ${branch}...`);
  const pr = findPullRequest(branch);
  if (!pr) {
    console.log(`ℹ️ No open Pull Request found for branch "${branch}". Skipping CI watch.`);
    process.exit(0);
  }

  console.log(`📌 Found active PR #${pr.number}: ${pr.title}`);
  console.log(`🔗 ${pr.url}`);
  console.log("👀 Watching CI checks in real-time (gh pr checks --watch)...");

  const child = spawn("gh", ["pr", "checks", String(pr.number), "--watch"], {
    stdio: "inherit",
  });

  child.on("close", (code) => {
    if (code === 0) {
      console.log("\n✅ All CI checks completed successfully!");
      process.exit(0);
    } else {
      console.error(`\n❌ CI checks failed or returned non-zero status (code: ${code}).`);
      process.exit(code || 1);
    }
  });

  child.on("error", (err) => {
    console.error("❌ Failed to spawn 'gh pr checks':", err.message);
    process.exit(1);
  });
}

main();
