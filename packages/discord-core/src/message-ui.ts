/**
 * Purpose: Builds Discord Components v2 message cards for Humanify moderator and admin surfaces.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\architecture.md
 * - docs\discord-bot.md
 * - docs\api.md
 * External references:
 * - https://discord.com/developers/docs/components/reference
 * - https://discord.com/developers/docs/resources/message#message-object-message-flags
 * - https://discord.js.org/docs/packages/builders/main/ContainerBuilder:Class
 * - https://discord.js.org/docs/packages/builders/main/SectionBuilder:Class
 * Tests:
 * - apps/bot-bun/src/index.test.ts
 * - apps/scan-worker-temporal/src/index.test.ts
 */

import { ContainerBuilder, MessageFlags, SeparatorBuilder, TextDisplayBuilder } from "discord.js";

export type HumanifyMessageTone = "danger" | "info" | "success" | "warning";

export type HumanifyMessageSection = {
  lines?: readonly string[];
  markdown?: string;
  title?: string;
};

const toneAccentColors: Record<HumanifyMessageTone, number> = {
  danger: 0xed4245,
  info: 0x5865f2,
  success: 0x57f287,
  warning: 0xfee75c,
};

function normalizeMarkdownBlock(value: string) {
  return value.replace(/\r/g, "").trim();
}

function buildSectionMarkdown(section: HumanifyMessageSection) {
  const parts: string[] = [];
  if (section.title) {
    parts.push(`### ${section.title}`);
  }

  if (section.markdown) {
    const normalized = normalizeMarkdownBlock(section.markdown);
    if (normalized) {
      parts.push(normalized);
    }
  }

  if (section.lines?.length) {
    const normalizedLines = section.lines
      .map((line) => normalizeMarkdownBlock(line))
      .filter((line) => line.length > 0);

    if (normalizedLines.length > 0) {
      parts.push(normalizedLines.join("\n"));
    }
  }

  const markdown = parts.join("\n");
  return markdown.length > 0 ? markdown : undefined;
}

function createTextDisplay(markdown: string) {
  return new TextDisplayBuilder().setContent(normalizeMarkdownBlock(markdown));
}

export function mergeHumanifyMessageFlags(...flags: Array<number | undefined>) {
  let mergedFlags = MessageFlags.IsComponentsV2;
  for (const value of flags) {
    mergedFlags |= value ?? 0;
  }

  return mergedFlags;
}

export function createHumanifyMessageContainer(input: {
  actionRows?: readonly any[];
  sections?: readonly HumanifyMessageSection[];
  summary?: string;
  title: string;
  tone?: HumanifyMessageTone;
}) {
  const container = new ContainerBuilder()
    .setAccentColor(toneAccentColors[input.tone ?? "info"])
    .addTextDisplayComponents(
      createTextDisplay(
        [
          `## ${normalizeMarkdownBlock(input.title)}`,
          input.summary ? normalizeMarkdownBlock(input.summary) : undefined,
        ].filter((value): value is string => Boolean(value)).join("\n"),
      ),
    );

  for (const section of input.sections ?? []) {
    const markdown = buildSectionMarkdown(section);
    if (!markdown) {
      continue;
    }

    container
      .addSeparatorComponents(new SeparatorBuilder())
      .addTextDisplayComponents(createTextDisplay(markdown));
  }

  if (input.actionRows?.length) {
    container
      .addSeparatorComponents(new SeparatorBuilder())
      .addActionRowComponents(...input.actionRows);
  }

  return container;
}

export function createHumanifyMessagePayload(input: {
  actionRows?: readonly any[];
  flags?: number;
  sections?: readonly HumanifyMessageSection[];
  summary?: string;
  title: string;
  tone?: HumanifyMessageTone;
}) {
  return {
    components: [
      createHumanifyMessageContainer({
        actionRows: input.actionRows,
        sections: input.sections,
        summary: input.summary,
        title: input.title,
        tone: input.tone,
      }),
    ],
    flags: mergeHumanifyMessageFlags(input.flags),
  };
}
