/**
 * Purpose: Runs cargo metadata only when the current Rust workspace members have local manifests available.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\reference-baseline.md
 * - docs\workspaces.md
 * External references:
 * - https://doc.rust-lang.org/cargo/reference/workspaces.html
 * - https://doc.rust-lang.org/cargo/reference/manifest.html
 * Tests:
 * - tooling/verify-workspaces.test.ts
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function parseMembers(cargoToml: string) {
  const block = cargoToml.match(/members\s*=\s*\[((?:.|\r|\n)*?)\]/m)?.[1] ?? "";

  return [...block.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

const cargoTomlPath = join(process.cwd(), "Cargo.toml");
const cargoToml = readFileSync(cargoTomlPath, "utf8");
const members = parseMembers(cargoToml);
const missingManifests = members.filter((member) => !existsSync(join(process.cwd(), member, "Cargo.toml")));

if (missingManifests.length > 0) {
  console.warn(
    `Skipping cargo metadata because the Rust workspace is not fully scaffolded yet: ${missingManifests.join(", ")}`,
  );
  process.exit(0);
}

const result = spawnSync("cargo", ["metadata", "--format-version", "1", "--no-deps"], {
  stdio: "inherit",
});

process.exit(result.status ?? 1);
