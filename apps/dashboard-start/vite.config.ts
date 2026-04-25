/**
 * Purpose: Configures TanStack Start, React, and Tailwind CSS v4 for the dashboard shell.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\reference-baseline.md
 * - docs\workspaces.md
 * External references:
 * - https://tanstack.dev/start/latest/docs/framework/react/build-from-scratch
 * - https://tanstack.dev/start/latest/docs/framework/react/guide/tailwind-integration
 * - https://tailwindcss.com/docs/installation/using-vite
 * Tests:
 * - apps/dashboard-start package build
 */

import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [tanstackStart(), viteReact(), tailwindcss()],
  server: {
    port: 3000,
  },
});
