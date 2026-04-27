# `@humanify/ui`

## Purpose

Shared HeroUI-based product shell primitives for the Humanify dashboard and verifier apps.

## Governing docs

- `AGENTS.md`
- `docs\architecture.md`
- `docs\workspaces.md`
- `docs\testing.md`

## Upstream references

- HeroUI React getting started: https://www.heroui.com/docs/react/getting-started
- HeroUI theming: https://www.heroui.com/docs/react/getting-started/theming
- HeroUI styling: https://www.heroui.com/docs/react/getting-started/styling
- Apple Human Interface Guidelines, Layout: https://developer.apple.com/design/human-interface-guidelines/layout
- WCAG 2.2, Animation from Interactions: https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html

## Current layout contract

- The shell uses a persistent owner-facing sidebar on wide screens for app identity, current status, and route or workflow navigation.
- The main content area keeps a constrained reading width, explicit top spacing, and separate content surfaces so routes do not collapse into one large stacked card.
- Motion remains subtle and must respect `prefers-reduced-motion`.
- Dashboard and verifier routes may supply their own sidebar content, but they should stay within the shared shell rather than inventing a second layout system.

## Test evidence

- `apps/dashboard-start/src/dashboard-mvp.test.tsx`
- `apps/verifier-start/src/verification-flow.test.ts`
- `bun run typecheck`
