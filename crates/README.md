# Crates Workspace

## Governing docs

- `AGENTS.md`
- `Implementation Plan.txt`
- `docs\reference-baseline.md`
- `docs\workspaces.md`

## Upstream docs

- Cargo workspaces: https://doc.rust-lang.org/cargo/reference/workspaces.html
- Cargo manifests: https://doc.rust-lang.org/cargo/reference/manifest.html

## Planned crate directories

- `humanify-core`
- `humanify-evidence`
- `humanify-inference`
- `humanify-learning`
- `humanify-policy`
- `humanify-proto`
- `humanify-risk`

These directories are reserved for real shared Rust crates. Cargo workspace membership stays empty until those crates are scaffolded with real manifests and sources.
