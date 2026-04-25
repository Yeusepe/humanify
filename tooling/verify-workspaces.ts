/**
 * Purpose: Validates the root Bun/Cargo workspace bootstrap before package and crate manifests land.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\reference-baseline.md
 * - docs\workspaces.md
 * External references:
 * - https://bun.sh/docs/install/workspaces
 * - https://doc.rust-lang.org/cargo/reference/workspaces.html
 * Tests:
 * - tooling/verify-workspaces.test.ts
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const requiredDirectories = [
  "apps",
  "apps\\api-bun",
  "apps\\bot-bun",
  "apps\\dashboard-start",
  "apps\\verifier-start",
  "packages",
  "packages\\contracts",
  "packages\\ui",
  "crates",
  "crates\\humanify-core",
  "crates\\humanify-evidence",
  "crates\\humanify-inference",
  "crates\\humanify-learning",
  "crates\\humanify-policy",
  "crates\\humanify-proto",
  "crates\\humanify-risk",
  "services",
  "services\\evidence-rs",
  "services\\inference-rs",
  "services\\learning-rs",
  "services\\trust-rs",
  "tooling",
];

export const requiredFiles = [
  ".gitignore",
  ".env.example",
  "package.json",
  "tsconfig.json",
  "Cargo.toml",
  "rustfmt.toml",
  "docker-compose.local.yml",
  "docker\\postgres\\init\\001-humanify.sql",
  "docs\\local-development.md",
  "docs\\workspaces.md",
  "apps\\api-bun\\package.json",
  "apps\\api-bun\\src\\app.ts",
  "apps\\api-bun\\src\\index.ts",
  "apps\\bot-bun\\package.json",
  "apps\\bot-bun\\src\\index.ts",
  "apps\\dashboard-start\\package.json",
  "apps\\dashboard-start\\src\\router.tsx",
  "apps\\dashboard-start\\src\\routes\\__root.tsx",
  "apps\\dashboard-start\\src\\routes\\index.tsx",
  "apps\\verifier-start\\package.json",
  "apps\\verifier-start\\src\\router.tsx",
  "apps\\verifier-start\\src\\routes\\__root.tsx",
  "apps\\verifier-start\\src\\routes\\index.tsx",
  "packages\\contracts\\package.json",
  "packages\\contracts\\src\\index.ts",
  "packages\\ui\\package.json",
  "packages\\ui\\src\\index.tsx",
  "tooling\\dev-stack.ts",
  "tooling\\dev-stack.test.ts",
  "tooling\\run-cargo-metadata.ts",
  "tooling\\run-rustfmt.ts",
];

type VerificationResult = {
  errors: string[];
  warnings: string[];
};

function readText(root: string, relativePath: string): string {
  return readFileSync(join(root, relativePath), "utf8");
}

export function verifyWorkspaces(root = process.cwd()): VerificationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const relativePath of requiredDirectories) {
    if (!existsSync(join(root, relativePath))) {
      errors.push(`Missing required directory: ${relativePath}`);
    }
  }

  for (const relativePath of requiredFiles) {
    if (!existsSync(join(root, relativePath))) {
      errors.push(`Missing required file: ${relativePath}`);
    }
  }

  const packageJsonText = readText(root, "package.json");
  if (!packageJsonText.includes('"apps/*"') || !packageJsonText.includes('"packages/*"')) {
    errors.push('Root package.json must declare Bun workspaces for "apps/*" and "packages/*".');
  }

  const cargoTomlText = readText(root, "Cargo.toml");
  if (!cargoTomlText.includes("[workspace]")) {
    errors.push("Root Cargo.toml must stay a Cargo workspace manifest.");
  }

  if (!packageJsonText.includes('"build": "bun run --sequential --filter \'*\' build"')) {
    warnings.push("Root package.json build script no longer matches the documented Bun workspace convention.");
  }

  if (!packageJsonText.includes('"dev": "bun run tooling/dev-stack.ts"')) {
    warnings.push("Root package.json dev script no longer matches the documented local stack convention.");
  }

  if (
    !packageJsonText.includes(
      '"check": "bun run check:workspace && bun run check:rust && bun run typecheck && bun test"',
    )
  ) {
    warnings.push("Root package.json check script no longer matches the documented Bun workspace convention.");
  }

  return { errors, warnings };
}

if (import.meta.main) {
  const { errors, warnings } = verifyWorkspaces();

  if (warnings.length > 0) {
    for (const warning of warnings) {
      console.warn(`warning: ${warning}`);
    }
  }

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`error: ${error}`);
    }

    process.exit(1);
  }

  console.log("Workspace bootstrap verification passed.");
}
