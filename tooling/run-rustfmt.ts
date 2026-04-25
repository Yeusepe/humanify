/**
 * Purpose: Runs rustfmt only when real Rust workspace members exist.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\reference-baseline.md
 * - docs\workspaces.md
 * External references:
 * - https://doc.rust-lang.org/cargo/reference/workspaces.html
 * - https://github.com/rust-lang/rustfmt/blob/master/Configurations.md
 * Tests:
 * - tooling/verify-workspaces.test.ts
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const cargoToml = readFileSync(join(process.cwd(), "Cargo.toml"), "utf8");
const shouldWrite = process.argv.includes("--write");

function parseMembers(workspaceToml: string) {
  const block = workspaceToml.match(/members\s*=\s*\[((?:.|\r|\n)*?)\]/m)?.[1] ?? "";

  return [...block.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

const members = parseMembers(cargoToml);
const hasWorkspaceMembers = members.length > 0;
const missingManifests = members.filter((member) => !existsSync(join(process.cwd(), member, "Cargo.toml")));

if (!hasWorkspaceMembers) {
  console.log("No Rust workspace members are scaffolded yet; skipping cargo fmt.");
  process.exit(0);
}

if (missingManifests.length > 0) {
  console.log(
    `Rust workspace is only partially scaffolded; skipping cargo fmt until these manifests exist: ${missingManifests.join(", ")}`,
  );
  process.exit(0);
}

const args = shouldWrite ? ["fmt", "--all"] : ["fmt", "--all", "--check"];
const result = spawnSync("cargo", args, { stdio: "inherit" });

process.exit(result.status ?? 1);
