/**
 * Purpose: Defines the operator-facing dashboard MVP with honest read-model boundaries and role-split verification configuration language.
 * Governing docs:
 * - AGENTS.md
 * - Implementation Plan.txt
 * - docs\architecture.md
 * - docs\api.md
 * - docs\verification.md
 * - docs\cases-and-reports.md
 * - docs\operations.md
 * - docs\testing.md
 * - docs\workspaces.md
 * External references:
 * - https://tanstack.com/start/latest/docs/framework/react/overview
 * - https://www.heroui.com/docs/react/getting-started/theming
 * - https://www.heroui.com/docs/react/components/alert
 * - https://www.heroui.com/docs/react/components/button
 * - https://www.heroui.com/docs/react/components/card
 * - https://www.heroui.com/docs/react/components/drawer
 * - https://www.heroui.com/docs/react/components/form
 * - https://www.heroui.com/docs/react/components/input
 * - https://www.heroui.com/docs/react/components/modal
 * - https://www.heroui.com/docs/react/components/table
 * - https://www.heroui.com/docs/react/components/tabs
 * Tests:
 * - apps/dashboard-start/src/dashboard-mvp.test.tsx
 * - apps/dashboard-start package build
 */

import { useMemo, useState, type FormEvent } from "react";

import { Link } from "@tanstack/react-router";
import {
  Alert,
  Button,
  Card,
  Drawer,
  Form,
  Input,
  Modal,
  Table,
  Tabs,
} from "@heroui/react";

import { getHumanifyContractSummary, humanifyActionLadder } from "@humanify/contracts";
import { ProductShell } from "@humanify/ui";
import {
  getDefaultHumanifyIdClaimBundle,
  getHumanifyIdClaimBundles,
  humanifyVerificationOptionCatalog,
  resolveVerificationOptionCatalog,
  resolveVerificationOptionConfiguration,
  type VerificationOptionConfiguration,
  type VerificationOptionCatalog,
  type VerificationOptionDefinition,
} from "@humanify/verification-providers";

const contractSummary = getHumanifyContractSummary();

const dashboardSections = [
  {
    description: "Authority, route groups, and read-model readiness.",
    href: "/" as const,
    title: "Overview",
  },
  {
    description: "Risk queue and case read boundaries.",
    href: "/cases" as const,
    title: "Cases",
  },
  {
    description: "Verification session lifecycle and release gates.",
    href: "/verification" as const,
    title: "Verification",
  },
  {
    description: "Action clamps, score ladder, and execution authority.",
    href: "/policy" as const,
    title: "Policy",
  },
] as const;

const serviceInfoRows = [
  {
    detail: "Dashboard copy stays aligned with the Bun-owned API metadata route.",
    label: "Service metadata",
    value: "GET /service-info",
  },
  {
    detail: "Route groups, authority model, and shared package list are already concrete.",
    label: "Implemented route groups",
    value: "health, metadata, auth, guild-config, cases, reports, verification, callbacks, moderation, read-models",
  },
  {
    detail: "Shared contract metadata is safe to show now because it comes from a workspace package, not synthetic queue data.",
    label: "Contract summary",
    value: `v${contractSummary.contractVersion} (${contractSummary.schemaId})`,
  },
] as const;

const honestReadRows = [
  {
    operatorUse: "Show empty list state, explain projection dependency, and keep review mutations out of the UI.",
    readState: "pending_postgres_projection",
    surface: "GET /guilds/:guildId/cases",
  },
  {
    operatorUse: "Keep queue copy visible without inventing case rows or computed risk history.",
    readState: "pending_postgres_projection",
    surface: "GET /guilds/:guildId/risk-queue",
  },
  {
    operatorUse: "Reserve audit space and display backlog caveats until Postgres-backed audit views exist.",
    readState: "pending_postgres_projection",
    surface: "GET /guilds/:guildId/audit",
  },
  {
    operatorUse: "Do not pretend detailed moderation timelines exist before the read model lands.",
    readState: "dependency_unavailable",
    surface: "GET /guilds/:guildId/cases/:caseId",
  },
  {
    operatorUse: "Keep subject profile drill-down unavailable until Electric-backed profile projections are materialized.",
    readState: "dependency_unavailable",
    surface: "GET /guilds/:guildId/users/:userId/profile",
  },
] as const;

const verificationRows = [
  {
    meaning: "Signed challenge verified, but provider work has not started.",
    nextStep: "Complete the Discord-bound challenge step.",
    route: "GET /verification/sessions/:sessionId",
    state: "challenge_issued",
  },
  {
    meaning: "Challenge completion planned a canonical write, but server-side provider verification is still required.",
    nextStep: "Wait for the selected provider handoff to be verified server-side before any release decision.",
    route: "POST /verification/challenges/:challengeId/complete",
    state: "provider_pending",
  },
  {
    meaning: "Release stays blocked until Bun sees canonical passed state from a verified provider handoff.",
    nextStep: "Keep quarantine or review state intact.",
    route: "POST /verification/sessions/:sessionId/release",
    state: "release_blocked",
  },
] as const;

const verificationOptionRows = humanifyVerificationOptionCatalog.list();

const initialVerificationOptionConfiguration = resolveVerificationOptionConfiguration();
const verificationClaimBundleRows = getHumanifyIdClaimBundles();
const defaultVerificationClaimBundle = getDefaultHumanifyIdClaimBundle();

type VerificationRequirementDraft = {
  faceVerificationRequired: boolean;
  requiredBundleIds: string[];
};

type FetchLike = (input: URL | string | Request, init?: RequestInit) => Promise<Response>;

type ApiEnvelope<TData> = {
  contractVersion: string;
  data: TData;
  requestId: string;
};

type ApiErrorEnvelope = {
  errorCode: string;
  message: string;
  requestId: string;
  retryable: boolean;
};

type DashboardVerificationConfigSnapshot = {
  availableProviderIds: string[];
  defaultProviderId: string;
  defaultReusableProofBackendId?: string;
  enabledProviderIds: string[];
  faceVerificationRequired: boolean;
  fallbackRoles: string[];
  requiredBundleIds: string[];
  source: "catalog_default" | "persisted";
  suspiciousRoleIds: string[];
  trustedRoleIds: string[];
};

type DashboardVerificationConfigData = {
  persistence: string;
  verificationConfig: DashboardVerificationConfigSnapshot;
};

type DashboardVerificationSaveData = DashboardVerificationConfigData & {
  queueDelivery: string;
};

type VerificationEditorState = {
  actorUserId: string;
  defaultProviderId: string;
  defaultReusableProofBackendId?: string;
  enabledProviderIds: string[];
  faceVerificationRequired: boolean;
  guildId: string;
  requiredBundleIds: string[];
  suspiciousRoleIdsInput: string;
  trustedRoleIdsInput: string;
};

const initialVerificationRequirementDraft: VerificationRequirementDraft = {
  faceVerificationRequired: true,
  requiredBundleIds: [defaultVerificationClaimBundle.bundleId],
};

const safetyBoundaries = [
  "Bun authoritative",
  "Rust advisory",
  "Postgres canonical",
  "Electric read-only",
] as const;

const scoreBands = [
  {
    defaultAction: "No action, passive logging",
    notes: "Low risk is visible for operators but never treated as proof.",
    range: "1-3",
  },
  {
    defaultAction: "Watch",
    notes: "Useful for queue visibility, not punishment.",
    range: "4-5",
  },
  {
    defaultAction: "Verify",
    notes: "Challenge first, because release and escalation remain server-controlled.",
    range: "6",
  },
  {
    defaultAction: "Quarantine",
    notes: "High risk containment stays reversible.",
    range: "7-8",
  },
  {
    defaultAction: "Escalate for explicit policy review",
    notes: "Kick and ban are clamped by Bun policy and current Discord capability checks.",
    range: "9-10",
  },
] as const;

type DashboardPath = (typeof dashboardSections)[number]["href"];

type CaseQueryInputs = {
  caseId: string;
  guildId: string;
  subjectUserId: string;
};

type CaseQueryPlan = {
  audience: "case list" | "case detail";
  readModelStatus: "dependency_unavailable" | "pending_postgres_projection";
  scope: string;
  summary: string;
};

function trimOrEmpty(value: string) {
  return value.trim();
}

export function buildCaseQueryPlan(input: CaseQueryInputs): CaseQueryPlan {
  const guildId = trimOrEmpty(input.guildId);
  const caseId = trimOrEmpty(input.caseId);
  const subjectUserId = trimOrEmpty(input.subjectUserId);

  if (!guildId) {
    return {
      audience: "case list",
      readModelStatus: "pending_postgres_projection",
      scope: "Provide a guild ID to describe the queue and case-list projection boundary.",
      summary: "Add a guild ID before preparing a queue read plan.",
    };
  }

  if (caseId) {
    return {
      audience: "case detail",
      readModelStatus: "dependency_unavailable",
      scope: `Guild ${guildId}, case ${caseId}${subjectUserId ? `, subject ${subjectUserId}` : ""}.`,
      summary: "Case detail remains unavailable until Postgres-backed case projections land.",
    };
  }

  return {
    audience: "case list",
    readModelStatus: "pending_postgres_projection",
    scope: `Guild ${guildId}${subjectUserId ? `, subject ${subjectUserId}` : ""}.`,
    summary: "Queue and case-list reads stay projection-pending, so the MVP shows boundaries instead of synthetic rows.",
  };
}

export function updateVerificationOptionConfiguration(
  current: VerificationOptionConfiguration,
  action:
    | {
        type: "set-default";
        optionId: string;
      }
    | {
        type: "set-default-reusable";
        optionId: string;
      }
    | {
        type: "toggle-option";
        optionId: string;
      },
  availableCatalog: VerificationOptionCatalog = humanifyVerificationOptionCatalog,
): VerificationOptionConfiguration {
  if (action.type === "set-default") {
    return resolveVerificationOptionConfiguration({
      availableCatalog,
      defaultOptionId: action.optionId,
      defaultReusableProofBackendId: current.defaultReusableProofBackendId,
      enabledOptionIds: current.enabledOptionIds,
    });
  }

  if (action.type === "set-default-reusable") {
    return resolveVerificationOptionConfiguration({
      availableCatalog,
      defaultOptionId: current.defaultOptionId,
      defaultReusableProofBackendId: action.optionId,
      enabledOptionIds: current.enabledOptionIds,
    });
  }

  const isEnabled = current.enabledOptionIds.includes(action.optionId);
  const nextEnabledOptionIds = isEnabled
    ? current.enabledOptionIds.filter((optionId) => optionId !== action.optionId)
    : [...current.enabledOptionIds, action.optionId];

  const nextReusableOptions = availableCatalog.list().filter((option) =>
    option.role === "reusable_proof_backend" && nextEnabledOptionIds.includes(option.id)
  );
  const nextDefaultOptionId = isEnabled && current.defaultOptionId === action.optionId
    ? nextEnabledOptionIds[0]
    : current.defaultOptionId;
  const nextDefaultReusableProofBackendId = isEnabled && current.defaultReusableProofBackendId === action.optionId
    ? nextReusableOptions[0]?.id
    : current.defaultReusableProofBackendId;

  return resolveVerificationOptionConfiguration({
    availableCatalog,
    defaultOptionId: nextDefaultOptionId,
    defaultReusableProofBackendId: nextDefaultReusableProofBackendId,
    enabledOptionIds: nextEnabledOptionIds,
  });
}

function splitRoleIdsInput(value: string) {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const entry of value.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized;
}

function joinRoleIdsInput(values: readonly string[]) {
  return values.join(", ");
}

function buildApiUrl(apiBaseUrl: string, path: string) {
  return `${apiBaseUrl.replace(/\/+$/, "")}${path}`;
}

async function readApiEnvelope<TData>(response: Response): Promise<TData> {
  const json = (await response.json()) as ApiEnvelope<TData> | ApiErrorEnvelope;

  if (!response.ok) {
    const error = json as ApiErrorEnvelope;
    throw new Error(error.message ?? "Dashboard request failed.");
  }

  return (json as ApiEnvelope<TData>).data;
}

export function getDashboardApiBaseUrl(env: Record<string, string | undefined> = {}) {
  const configuredBaseUrl = env.VITE_HUMANIFY_API_BASE_URL?.trim();
  if (configuredBaseUrl) {
    return configuredBaseUrl.replace(/\/+$/, "");
  }

  return "http://127.0.0.1:3211";
}

export async function fetchGuildVerificationConfig(
  fetchImpl: FetchLike,
  input: {
    apiBaseUrl: string;
    guildId: string;
  },
) {
  const response = await fetchImpl(
    buildApiUrl(input.apiBaseUrl, `/guilds/${encodeURIComponent(input.guildId)}/verification`),
    {
      headers: {
        accept: "application/json",
      },
    },
  );

  return readApiEnvelope<DashboardVerificationConfigData>(response);
}

export function createVerificationEditorState(input: {
  actorUserId?: string;
  guildId: string;
  verificationConfig: DashboardVerificationConfigSnapshot;
}): VerificationEditorState {
  return {
    actorUserId: input.actorUserId ?? "",
    defaultProviderId: input.verificationConfig.defaultProviderId,
    defaultReusableProofBackendId: input.verificationConfig.defaultReusableProofBackendId,
    enabledProviderIds: [...input.verificationConfig.enabledProviderIds],
    faceVerificationRequired: input.verificationConfig.faceVerificationRequired,
    guildId: input.guildId,
    requiredBundleIds: [...input.verificationConfig.requiredBundleIds],
    suspiciousRoleIdsInput: joinRoleIdsInput(input.verificationConfig.suspiciousRoleIds),
    trustedRoleIdsInput: joinRoleIdsInput(input.verificationConfig.trustedRoleIds),
  };
}

export async function saveGuildVerificationConfig(
  fetchImpl: FetchLike,
  input: VerificationEditorState & {
    apiBaseUrl: string;
  },
) {
  const response = await fetchImpl(
    buildApiUrl(input.apiBaseUrl, `/guilds/${encodeURIComponent(input.guildId)}/verification`),
    {
      body: JSON.stringify({
        actorUserId: input.actorUserId,
        defaultProviderId: input.defaultProviderId,
        defaultReusableProofBackendId: input.defaultReusableProofBackendId,
        enabledProviderIds: input.enabledProviderIds,
        faceVerificationRequired: input.faceVerificationRequired,
        requiredBundleIds: input.requiredBundleIds,
        suspiciousRoleIds: splitRoleIdsInput(input.suspiciousRoleIdsInput),
        trustedRoleIds: splitRoleIdsInput(input.trustedRoleIdsInput),
      }),
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      method: "PUT",
    },
  );

  return readApiEnvelope<DashboardVerificationSaveData>(response);
}

function splitVerificationOptionsByRole(options: readonly VerificationOptionDefinition[]) {
  return {
    captureFlows: options.filter((option) => option.role === "capture_provider"),
    reusableProofBackends: options.filter((option) => option.role === "reusable_proof_backend"),
  };
}

function formatClaimKey(claim: string) {
  return claim.replace(/_/g, " ");
}

function statusTone(status: CaseQueryPlan["readModelStatus"] | (typeof honestReadRows)[number]["readState"]) {
  return status === "dependency_unavailable" ? "warning" : "accent";
}

function statusClassName(current: boolean) {
  return current
    ? "border-accent/40 bg-accent/8 text-foreground"
    : "border-border/60 bg-background text-muted hover:border-accent/30 hover:text-foreground";
}

function DashboardLayout({
  children,
  currentPath,
  sectionDescription,
  sectionTitle,
}: Readonly<{
  children: React.ReactNode;
  currentPath: DashboardPath;
  sectionDescription: string;
  sectionTitle: string;
}>) {
  return (
    <ProductShell
      description="The MVP keeps operator visibility useful without claiming live moderation truth that Postgres and Electric do not expose yet."
      eyebrow="HUMANIFY / DASHBOARD"
      panels={[
        {
          description: "Shared contract metadata comes from @humanify/contracts, not copied API constants.",
          title: "Contracts",
          value: `v${contractSummary.contractVersion}`,
        },
        {
          description: "Cases, queue, and audit views stay explicitly projection-pending until canonical read models exist.",
          title: "Read honesty",
          value: "Pending projections",
          variant: "secondary",
        },
        {
          description: "Bun still decides enforcement. Rust stays advisory and Postgres remains canonical.",
          title: "Authority",
          value: "Bun authoritative",
          variant: "tertiary",
        },
      ]}
      title="Moderation dashboard MVP"
    >
      <div className="space-y-6">
        <Card variant="secondary">
          <Card.Header className="gap-3">
            <Card.Title>{sectionTitle}</Card.Title>
            <Card.Description>{sectionDescription}</Card.Description>
          </Card.Header>
          <Card.Content className="grid gap-3 md:grid-cols-4">
            {dashboardSections.map((section) => (
              <Link
                className={`rounded-3xl border px-4 py-3 transition ${statusClassName(currentPath === section.href)}`}
                key={section.href}
                to={section.href}
              >
                <p className="text-sm font-semibold tracking-tight">{section.title}</p>
                <p className="mt-1 text-sm leading-6">{section.description}</p>
              </Link>
            ))}
          </Card.Content>
        </Card>

        {children}
      </div>
    </ProductShell>
  );
}

function StatusText({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <span className="inline-flex rounded-full border border-border/60 bg-default px-2.5 py-1 text-xs font-semibold tracking-[0.14em] text-muted uppercase">
      {children}
    </span>
  );
}

function ReadStateTable({
  rows,
}: Readonly<{
  rows: readonly {
    operatorUse: string;
    readState: string;
    surface: string;
  }[];
}>) {
  return (
    <Table variant="secondary">
      <Table.ScrollContainer>
        <Table.Content aria-label="Dashboard read-model status" className="min-w-[820px]">
          <Table.Header>
            <Table.Column isRowHeader>Surface</Table.Column>
            <Table.Column>Current state</Table.Column>
            <Table.Column>Operator meaning</Table.Column>
          </Table.Header>
          <Table.Body>
            {rows.map((row) => (
              <Table.Row key={row.surface}>
                <Table.Cell>{row.surface}</Table.Cell>
                <Table.Cell>
                  <StatusText>{row.readState}</StatusText>
                </Table.Cell>
                <Table.Cell>{row.operatorUse}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}

function VerificationOptionRoleTable({
  configuration,
  defaultButtonLabel,
  description,
  emptyState,
  onOptionAction,
  options,
  title,
}: Readonly<{
  configuration: VerificationOptionConfiguration;
  defaultButtonLabel: string;
  description: string;
  emptyState: string;
  onOptionAction: (action:
    | { optionId: string; type: "set-default" | "set-default-reusable" | "toggle-option" }
  ) => void;
  options: readonly VerificationOptionDefinition[];
  title: string;
}>) {
  if (options.length === 0) {
    return (
      <Card>
        <Card.Header className="gap-2">
          <Card.Title>{title}</Card.Title>
          <Card.Description>{description}</Card.Description>
        </Card.Header>
        <Card.Content className="text-sm leading-7 text-muted">
          <p>{emptyState}</p>
        </Card.Content>
      </Card>
    );
  }

  return (
    <Card>
      <Card.Header className="gap-2">
        <Card.Title>{title}</Card.Title>
        <Card.Description>{description}</Card.Description>
      </Card.Header>
      <Card.Content className="space-y-4 text-sm leading-7 text-muted">
        <Table variant="secondary">
          <Table.ScrollContainer>
            <Table.Content aria-label={title} className="min-w-[980px]">
              <Table.Header>
                <Table.Column isRowHeader>Option</Table.Column>
                <Table.Column>Best for</Table.Column>
                <Table.Column>What members need</Table.Column>
                <Table.Column>Privacy</Table.Column>
                <Table.Column>Enabled</Table.Column>
                <Table.Column>{defaultButtonLabel}</Table.Column>
              </Table.Header>
              <Table.Body>
                {options.map((option) => {
                  const enabled = configuration.enabledOptionIds.includes(option.id);
                  const isCaptureFlow = option.role === "capture_provider";
                  const isDefault = isCaptureFlow
                    ? configuration.defaultOptionId === option.id
                    : configuration.defaultReusableProofBackendId === option.id;

                  return (
                    <Table.Row key={option.id}>
                      <Table.Cell>
                        <div className="space-y-1">
                          <p className="font-semibold text-foreground">{option.title}</p>
                          <p className="text-xs leading-6">{option.summary}</p>
                        </div>
                      </Table.Cell>
                      <Table.Cell>{option.goodFor}</Table.Cell>
                      <Table.Cell>{option.whatYouNeed}</Table.Cell>
                      <Table.Cell>{option.privacySummary}</Table.Cell>
                      <Table.Cell>
                        <Button
                          onPress={() => onOptionAction({
                            optionId: option.id,
                            type: "toggle-option",
                          })}
                          variant={enabled ? "primary" : "secondary"}
                        >
                          {enabled ? "Enabled" : "Disabled"}
                        </Button>
                      </Table.Cell>
                      <Table.Cell>
                        <Button
                          isDisabled={!enabled}
                          onPress={() => onOptionAction({
                            optionId: option.id,
                            type: isCaptureFlow ? "set-default" : "set-default-reusable",
                          })}
                          variant={isDefault ? "primary" : "secondary"}
                        >
                          {isDefault ? defaultButtonLabel : `Make ${defaultButtonLabel.toLowerCase()}`}
                        </Button>
                      </Table.Cell>
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      </Card.Content>
    </Card>
  );
}

export function DashboardOverviewPage() {
  return (
    <DashboardLayout
      currentPath="/"
      sectionDescription="Overview / system state"
      sectionTitle="System state and operator trust boundaries"
    >
      <Alert status="warning">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>Live moderation rows stay disabled until canonical projections exist.</Alert.Title>
          <Alert.Description>
            This MVP shows route groups, safety invariants, and projection statuses now, but it will not invent queue items, moderator history, or case timelines.
          </Alert.Description>
        </Alert.Content>
      </Alert>

      <Tabs className="w-full" defaultSelectedKey="system-state" variant="secondary">
        <Tabs.ListContainer>
          <Tabs.List aria-label="Overview sections" className="w-full justify-start">
            <Tabs.Tab id="system-state">
              System state
              <Tabs.Indicator />
            </Tabs.Tab>
            <Tabs.Tab id="read-boundaries">
              Read boundaries
              <Tabs.Indicator />
            </Tabs.Tab>
            <Tabs.Tab id="safety-invariants">
              Safety invariants
              <Tabs.Indicator />
            </Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>

        <Tabs.Panel className="space-y-4 pt-4" id="system-state">
          <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
            <Card>
              <Card.Header className="gap-2">
                <Card.Title>Current API spine</Card.Title>
                <Card.Description>The dashboard is grounded in the implemented metadata and contract routes.</Card.Description>
              </Card.Header>
              <Card.Content className="space-y-3">
                {serviceInfoRows.map((row) => (
                  <div className="rounded-3xl border border-border/60 px-4 py-3" key={row.label}>
                    <p className="text-sm font-semibold tracking-tight text-foreground">{row.label}</p>
                    <p className="mt-1 text-sm text-muted">{row.value}</p>
                    <p className="mt-1 text-sm leading-6 text-muted">{row.detail}</p>
                  </div>
                ))}
              </Card.Content>
            </Card>

            <Card variant="secondary">
              <Card.Header className="gap-2">
                <Card.Title>Authority model</Card.Title>
                <Card.Description>These are the product-safety rules the dashboard must preserve.</Card.Description>
              </Card.Header>
              <Card.Content className="grid gap-3">
                {safetyBoundaries.map((boundary) => (
                  <div className="rounded-3xl border border-border/60 px-4 py-3" key={boundary}>
                    <p className="text-sm font-semibold tracking-tight text-foreground">{boundary}</p>
                  </div>
                ))}
              </Card.Content>
            </Card>
          </div>

          <Modal>
            <Button variant="secondary">Open operator handoff</Button>
            <Modal.Backdrop>
              <Modal.Container>
                <Modal.Dialog className="sm:max-w-[520px]">
                  <Modal.CloseTrigger />
                  <Modal.Header>
                    <Modal.Heading>Operator handoff</Modal.Heading>
                  </Modal.Header>
                  <Modal.Body>
                    <p>
                      This screen is intentionally useful before Electric sync lands: operators can review the system boundary, understand why queue rows are absent, and avoid mistaking planning metadata for canonical moderation state.
                    </p>
                    <p>
                      When Postgres-backed read models arrive, these sections can bind to real read data without changing the core information architecture.
                    </p>
                  </Modal.Body>
                  <Modal.Footer>
                    <Button slot="close" variant="secondary">
                      Close
                    </Button>
                  </Modal.Footer>
                </Modal.Dialog>
              </Modal.Container>
            </Modal.Backdrop>
          </Modal>
        </Tabs.Panel>

        <Tabs.Panel className="space-y-4 pt-4" id="read-boundaries">
          <ReadStateTable rows={honestReadRows} />
        </Tabs.Panel>

        <Tabs.Panel className="space-y-4 pt-4" id="safety-invariants">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <Card.Header className="gap-2">
                <Card.Title>Read-only UI rule</Card.Title>
                <Card.Description>Client views describe state; they do not grant enforcement authority.</Card.Description>
              </Card.Header>
              <Card.Content className="space-y-3 text-sm leading-7 text-muted">
                <p>Queue delivery does not prove business completion.</p>
                <p>Electric sync is for read models only.</p>
                <p>Operators see pending states instead of synthetic rows.</p>
              </Card.Content>
            </Card>
            <Card variant="secondary">
              <Card.Header className="gap-2">
                <Card.Title>Moderation safety</Card.Title>
                <Card.Description>The dashboard must never imply that advisory signals are executable truth.</Card.Description>
              </Card.Header>
              <Card.Content className="space-y-3 text-sm leading-7 text-muted">
                <p>Rust can score, classify, and assist.</p>
                <p>Bun evaluates policy and clamps automatic actions.</p>
                <p>Postgres receipts and audit rows remain the canonical moderation record.</p>
              </Card.Content>
            </Card>
          </div>
        </Tabs.Panel>
      </Tabs>
    </DashboardLayout>
  );
}

export function DashboardCasesPage() {
  const [filters, setFilters] = useState<CaseQueryInputs>({
    caseId: "",
    guildId: "",
    subjectUserId: "",
  });
  const [plan, setPlan] = useState<CaseQueryPlan>(() => buildCaseQueryPlan({ caseId: "", guildId: "", subjectUserId: "" }));

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPlan(buildCaseQueryPlan(filters));
  };

  return (
    <DashboardLayout
      currentPath="/cases"
      sectionDescription="Cases / risk queue"
      sectionTitle="Risk queue and case reads"
    >
      <Alert status={statusTone(plan.readModelStatus)}>
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>{plan.summary}</Alert.Title>
          <Alert.Description>{plan.scope}</Alert.Description>
        </Alert.Content>
      </Alert>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_1fr]">
      <Card>
          <Card.Header className="gap-2">
            <Card.Title>Projection filter prep</Card.Title>
            <Card.Description>Capture future query scope now without implying that read models already exist.</Card.Description>
          </Card.Header>
          <Card.Content>
            <Form aria-label="Cases projection filter prep" className="grid gap-4" onSubmit={handleSubmit}>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-foreground" htmlFor="cases-guild-id">
                    Guild ID
                  </label>
                  <Input
                    aria-label="Guild ID"
                    id="cases-guild-id"
                    onChange={(event) => setFilters((current) => ({ ...current, guildId: event.currentTarget.value }))}
                    placeholder="guild_123"
                    value={filters.guildId}
                    variant="secondary"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-semibold text-foreground" htmlFor="cases-case-id">
                    Case ID
                  </label>
                  <Input
                    aria-label="Case ID"
                    id="cases-case-id"
                    onChange={(event) => setFilters((current) => ({ ...current, caseId: event.currentTarget.value }))}
                    placeholder="case_456"
                    value={filters.caseId}
                    variant="secondary"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-semibold text-foreground" htmlFor="cases-subject-user-id">
                    Subject user ID
                  </label>
                  <Input
                    aria-label="Subject user ID"
                    id="cases-subject-user-id"
                    onChange={(event) => setFilters((current) => ({ ...current, subjectUserId: event.currentTarget.value }))}
                    placeholder="user_789"
                    value={filters.subjectUserId}
                    variant="secondary"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button type="submit">Prepare read plan</Button>
                <Button
                  onPress={() => {
                    const resetFilters = { caseId: "", guildId: "", subjectUserId: "" };
                    setFilters(resetFilters);
                    setPlan(buildCaseQueryPlan(resetFilters));
                  }}
                  type="button"
                  variant="secondary"
                >
                  Clear scope
                </Button>
              </div>
            </Form>
          </Card.Content>
        </Card>

        <Card variant="secondary">
          <Card.Header className="gap-2">
            <Card.Title>Current boundary</Card.Title>
            <Card.Description>The MVP shows what the API can honestly tell an operator today.</Card.Description>
          </Card.Header>
          <Card.Content className="space-y-3 text-sm leading-7 text-muted">
            <p>
              <strong className="text-foreground">Audience:</strong> {plan.audience}
            </p>
            <p>
              <strong className="text-foreground">Status:</strong> {plan.readModelStatus}
            </p>
            <p>
              <strong className="text-foreground">Scope:</strong> {plan.scope}
            </p>
          </Card.Content>
        </Card>
      </div>

      <ReadStateTable rows={honestReadRows} />

      <Drawer>
        <Button variant="secondary">Queue read boundary</Button>
        <Drawer.Backdrop>
          <Drawer.Content placement="right">
            <Drawer.Dialog>
              <Drawer.Header>
                <Drawer.Heading>Queue read boundary</Drawer.Heading>
              </Drawer.Header>
              <Drawer.Body className="space-y-4">
                <p>
                  The current queue screen is deliberately operational rather than data-rich: it tells moderators which read surfaces are real, which are pending, and why case rows are absent.
                </p>
                <p>
                  Once Postgres-backed queue projections land, this route can swap in real queue rows without rewriting the route structure or operator wording.
                </p>
              </Drawer.Body>
              <Drawer.Footer>
                <Button slot="close" variant="secondary">
                  Close
                </Button>
              </Drawer.Footer>
            </Drawer.Dialog>
          </Drawer.Content>
        </Drawer.Backdrop>
      </Drawer>
    </DashboardLayout>
  );
}

export function DashboardVerificationPage() {
  const env = import.meta.env as Record<string, string | undefined>;
  const apiBaseUrl = getDashboardApiBaseUrl(env);
  const [editorState, setEditorState] = useState<VerificationEditorState>({
    actorUserId: "",
    defaultProviderId: initialVerificationOptionConfiguration.defaultOptionId,
    defaultReusableProofBackendId: initialVerificationOptionConfiguration.defaultReusableProofBackendId,
    enabledProviderIds: initialVerificationOptionConfiguration.enabledOptionIds,
    faceVerificationRequired: initialVerificationRequirementDraft.faceVerificationRequired,
    guildId: "",
    requiredBundleIds: initialVerificationRequirementDraft.requiredBundleIds,
    suspiciousRoleIdsInput: "",
    trustedRoleIdsInput: "",
  });
  const [loadedConfig, setLoadedConfig] = useState<DashboardVerificationConfigData | null>(null);
  const [requestState, setRequestState] = useState<"error" | "idle" | "loading" | "ready" | "saving">("idle");
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(
    "Enter a guild ID to load the current server-owned verification settings.",
  );

  const availableOptionCatalog = useMemo(
    () =>
      loadedConfig
        ? resolveVerificationOptionCatalog({
            enabledOptionIds: loadedConfig.verificationConfig.availableProviderIds,
          })
        : humanifyVerificationOptionCatalog,
    [loadedConfig],
  );
  const optionRows = useMemo(() => availableOptionCatalog.list(), [availableOptionCatalog]);
  const optionGroups = useMemo(() => splitVerificationOptionsByRole(optionRows), [optionRows]);
  const optionConfiguration = useMemo(
    () =>
      resolveVerificationOptionConfiguration({
        availableCatalog: availableOptionCatalog,
        defaultOptionId: editorState.defaultProviderId,
        defaultReusableProofBackendId: editorState.defaultReusableProofBackendId,
        enabledOptionIds: editorState.enabledProviderIds,
      }),
    [
      availableOptionCatalog,
      editorState.defaultProviderId,
      editorState.defaultReusableProofBackendId,
      editorState.enabledProviderIds,
    ],
  );
  const enabledCaptureFlows = optionGroups.captureFlows.filter((option) =>
    optionConfiguration.enabledOptionIds.includes(option.id)
  );
  const enabledReusableProofBackends = optionGroups.reusableProofBackends.filter((option) =>
    optionConfiguration.enabledOptionIds.includes(option.id)
  );
  const currentDefaultCaptureFlow = optionRows.find((option) => optionConfiguration.defaultOptionId === option.id);
  const currentDefaultReusableProof = optionRows.find((option) =>
    optionConfiguration.defaultReusableProofBackendId === option.id
  );
  const requiredBundles = verificationClaimBundleRows.filter((bundle) =>
    editorState.requiredBundleIds.includes(bundle.bundleId)
  );
  const fallbackRoles = loadedConfig?.verificationConfig.fallbackRoles ?? [];

  const handleLoad = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const guildId = trimOrEmpty(editorState.guildId);
    if (!guildId) {
      setRequestState("error");
      setFeedbackMessage("Enter a guild ID before loading verification settings.");
      return;
    }

    setRequestState("loading");
    setFeedbackMessage(null);

    try {
      const data = await fetchGuildVerificationConfig(fetch, {
        apiBaseUrl,
        guildId,
      });
      setLoadedConfig(data);
      setEditorState(createVerificationEditorState({
        actorUserId: editorState.actorUserId,
        guildId,
        verificationConfig: data.verificationConfig,
      }));
      setRequestState("ready");
      setFeedbackMessage(
        data.verificationConfig.source === "persisted"
          ? "Loaded the saved verification settings for this server."
          : "Loaded the current server defaults. Save once to persist a guild-specific configuration.",
      );
    } catch (error) {
      setRequestState("error");
      setFeedbackMessage(error instanceof Error ? error.message : "Verification settings could not be loaded.");
    }
  };

  const handleSave = async () => {
    const guildId = trimOrEmpty(editorState.guildId);
    const actorUserId = trimOrEmpty(editorState.actorUserId);
    if (!guildId) {
      setRequestState("error");
      setFeedbackMessage("Enter a guild ID before saving verification settings.");
      return;
    }

    if (!actorUserId) {
      setRequestState("error");
      setFeedbackMessage("Enter the actor user ID before saving verification settings.");
      return;
    }

    setRequestState("saving");
    setFeedbackMessage(null);

    try {
      const data = await saveGuildVerificationConfig(fetch, {
        ...editorState,
        actorUserId,
        apiBaseUrl,
        defaultProviderId: optionConfiguration.defaultOptionId,
        defaultReusableProofBackendId: optionConfiguration.defaultReusableProofBackendId,
        enabledProviderIds: optionConfiguration.enabledOptionIds,
        guildId,
      });
      setLoadedConfig(data);
      setEditorState(createVerificationEditorState({
        actorUserId,
        guildId,
        verificationConfig: data.verificationConfig,
      }));
      setRequestState("ready");
      setFeedbackMessage("Saved the server-owned verification settings.");
    } catch (error) {
      setRequestState("error");
      setFeedbackMessage(error instanceof Error ? error.message : "Verification settings could not be saved.");
    }
  };

  return (
    <DashboardLayout
      currentPath="/verification"
      sectionDescription="Verification / release flow"
      sectionTitle="Verification state"
    >
      <Alert status="accent">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>Verification is designed to release legitimate users safely.</Alert.Title>
          <Alert.Description>
            The dashboard reflects challenge, provider-verification, and release gates explicitly so operators can see where sessions stop without assuming provider success equals release.
          </Alert.Description>
        </Alert.Content>
      </Alert>

      <Card>
        <Card.Header className="gap-2">
          <Card.Title>Load server verification settings</Card.Title>
          <Card.Description>
            This screen now reads and writes the Bun-owned guild verification config instead of relying on dashboard-only draft defaults.
          </Card.Description>
        </Card.Header>
        <Card.Content>
          <Form aria-label="Verification settings loader" className="grid gap-4" onSubmit={handleLoad}>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground" htmlFor="verification-guild-id">
                  Guild ID
                </label>
                <Input
                  aria-label="Guild ID"
                  id="verification-guild-id"
                  onChange={(event) => setEditorState((current) => ({ ...current, guildId: event.currentTarget.value }))}
                  placeholder="guild_123"
                  value={editorState.guildId}
                  variant="secondary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground" htmlFor="verification-actor-user-id">
                  Actor user ID
                </label>
                <Input
                  aria-label="Actor user ID"
                  id="verification-actor-user-id"
                  onChange={(event) =>
                    setEditorState((current) => ({ ...current, actorUserId: event.currentTarget.value }))}
                  placeholder="mod_123"
                  value={editorState.actorUserId}
                  variant="secondary"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button isDisabled={requestState === "loading" || requestState === "saving"} type="submit">
                {requestState === "loading" ? "Loading settings…" : "Load settings"}
              </Button>
              <Button
                isDisabled={requestState === "loading" || requestState === "saving"}
                onPress={handleSave}
                type="button"
                variant="secondary"
              >
                {requestState === "saving" ? "Saving settings…" : "Save settings"}
              </Button>
            </div>
          </Form>
        </Card.Content>
      </Card>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <Card.Header className="gap-2">
            <Card.Title>First-time capture flows</Card.Title>
            <Card.Description>Fresh document-check paths members can start in Humanify.</Card.Description>
          </Card.Header>
          <Card.Content className="space-y-2 text-sm leading-7 text-muted">
            <p>{enabledCaptureFlows.length} enabled</p>
            <p>Default capture: {currentDefaultCaptureFlow?.title ?? "Not set"}</p>
          </Card.Content>
        </Card>
        <Card variant="secondary">
          <Card.Header className="gap-2">
            <Card.Title>Reusable proof backends</Card.Title>
            <Card.Description>Privacy-preserving proof paths for people who already hold a credential.</Card.Description>
          </Card.Header>
          <Card.Content className="space-y-2 text-sm leading-7 text-muted">
            <p>{enabledReusableProofBackends.length} enabled</p>
            <p>Default reusable proof: {currentDefaultReusableProof?.title ?? "Not set"}</p>
          </Card.Content>
        </Card>
        <Card variant="secondary">
          <Card.Header className="gap-2">
            <Card.Title>Required proof bundles</Card.Title>
            <Card.Description>Member-facing proof choices built from Humanify claim bundles.</Card.Description>
          </Card.Header>
          <Card.Content className="space-y-2 text-sm leading-7 text-muted">
            <p>{requiredBundles.length} required option(s)</p>
            <p>{requiredBundles.map((bundle) => bundle.title).join(", ") || "None selected"}</p>
          </Card.Content>
        </Card>
        <Card variant="tertiary">
          <Card.Header className="gap-2">
            <Card.Title>Face verification policy</Card.Title>
            <Card.Description>Only applies to first-time capture flows, never reusable proof backends.</Card.Description>
          </Card.Header>
          <Card.Content className="space-y-2 text-sm leading-7 text-muted">
            <p>{editorState.faceVerificationRequired ? "Required for first-time capture" : "Not required"}</p>
            <p>Humanify stores only whether the face check ran and whether it passed.</p>
          </Card.Content>
        </Card>
      </div>

      <Alert status={requestState === "error" ? "warning" : "accent"}>
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>
            {loadedConfig?.verificationConfig.source === "persisted"
              ? "Loaded persisted verification config"
              : "Verification config status"}
          </Alert.Title>
          <Alert.Description>
            {feedbackMessage ?? "Load a guild to view the current verification setup."}
          </Alert.Description>
        </Alert.Content>
      </Alert>

      <div className="grid gap-4 xl:grid-cols-2">
        <VerificationOptionRoleTable
          configuration={optionConfiguration}
          defaultButtonLabel="Default capture"
          description="Server owners decide which first-time capture flows members can use when they need a fresh check."
          emptyState="No first-time capture flow is enabled for this server."
          onOptionAction={(action) =>
            setEditorState((current) => {
              const nextConfiguration = updateVerificationOptionConfiguration(
                optionConfiguration,
                action,
                availableOptionCatalog,
              );

              return {
                ...current,
                defaultProviderId: nextConfiguration.defaultOptionId,
                defaultReusableProofBackendId: nextConfiguration.defaultReusableProofBackendId,
                enabledProviderIds: nextConfiguration.enabledOptionIds,
              };
            })}
          options={optionGroups.captureFlows}
          title="First-time capture flows"
        />

        <VerificationOptionRoleTable
          configuration={optionConfiguration}
          defaultButtonLabel="Default reusable proof"
          description="Reusable proof backends stay separate from first-time capture so members can reuse a credential when they already have one."
          emptyState="No reusable proof backend is enabled for this server."
          onOptionAction={(action) =>
            setEditorState((current) => {
              const nextConfiguration = updateVerificationOptionConfiguration(
                optionConfiguration,
                action,
                availableOptionCatalog,
              );

              return {
                ...current,
                defaultProviderId: nextConfiguration.defaultOptionId,
                defaultReusableProofBackendId: nextConfiguration.defaultReusableProofBackendId,
                enabledProviderIds: nextConfiguration.enabledOptionIds,
              };
            })}
          options={optionGroups.reusableProofBackends}
          title="Reusable proof backends"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <Card.Header className="gap-2">
            <Card.Title>Required proof bundles</Card.Title>
            <Card.Description>
              Pick the member-facing proof bundles this server accepts. These bundles stay grounded in the shared Humanify claim catalog.
            </Card.Description>
          </Card.Header>
          <Card.Content className="space-y-4 text-sm leading-7 text-muted">
            {verificationClaimBundleRows.map((bundle) => {
              const required = editorState.requiredBundleIds.includes(bundle.bundleId);

              return (
                <div className="rounded-3xl border border-border/60 px-4 py-4" key={bundle.bundleId}>
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <p className="font-semibold text-foreground">{bundle.title}</p>
                      <p>{bundle.summary}</p>
                      <p className="text-xs leading-6">
                        <span className="font-semibold text-foreground">Best for:</span> {bundle.bestFor}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {bundle.claims.map((claim) => (
                          <span
                            className="rounded-full border border-border/60 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-foreground"
                            key={claim}
                          >
                            {formatClaimKey(claim)}
                          </span>
                        ))}
                      </div>
                    </div>
                    <Button
                      onPress={() =>
                        setEditorState((current) => {
                          const alreadyRequired = current.requiredBundleIds.includes(bundle.bundleId);
                          if (alreadyRequired && current.requiredBundleIds.length === 1) {
                            return current;
                          }

                          return {
                            ...current,
                            requiredBundleIds: alreadyRequired
                              ? current.requiredBundleIds.filter((bundleId) => bundleId !== bundle.bundleId)
                              : [...current.requiredBundleIds, bundle.bundleId],
                          };
                        })}
                      variant={required ? "primary" : "secondary"}
                    >
                      {required ? "Required" : "Optional"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </Card.Content>
        </Card>

        <Card variant="secondary">
          <Card.Header className="gap-2">
            <Card.Title>Face verification policy</Card.Title>
            <Card.Description>
              Apply this only to first-time capture flows when the server needs a liveness or selfie check.
            </Card.Description>
          </Card.Header>
          <Card.Content className="space-y-4 text-sm leading-7 text-muted">
            <p>
              Reusable proof backends stay document-free at the Humanify boundary. A face check belongs only to first-time capture.
            </p>
            <Button
              onPress={() =>
                setEditorState((current) => ({
                  ...current,
                  faceVerificationRequired: !current.faceVerificationRequired,
                }))}
              variant={editorState.faceVerificationRequired ? "primary" : "secondary"}
            >
              {editorState.faceVerificationRequired ? "Face verification required" : "Face verification optional"}
            </Button>
            <ul className="list-disc space-y-1 pl-5">
              <li>Use this when the server needs a live selfie or liveness step before release.</li>
              <li>Humanify keeps only the normalized pass/fail facts, not raw biometric captures.</li>
              <li>Members who use reusable proofs do not repeat a fresh face capture in the current flow.</li>
            </ul>
          </Card.Content>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card variant="secondary">
          <Card.Header className="gap-2">
            <Card.Title>Trusted roles</Card.Title>
            <Card.Description>
              Members who pass verification can be released into these server roles.
            </Card.Description>
          </Card.Header>
          <Card.Content className="space-y-4 text-sm leading-7 text-muted">
            <Input
              aria-label="Trusted roles"
              onChange={(event) =>
                setEditorState((current) => ({ ...current, trustedRoleIdsInput: event.currentTarget.value }))}
              placeholder="role_verified, role_member"
              value={editorState.trustedRoleIdsInput}
              variant="secondary"
            />
            <p>Fallback roles from the API: {fallbackRoles.join(", ") || "None returned yet"}</p>
          </Card.Content>
        </Card>

        <Card variant="secondary">
          <Card.Header className="gap-2">
            <Card.Title>Suspicious roles</Card.Title>
            <Card.Description>
              Keep these role IDs available for suspicious or quarantine-style release paths when the guild uses them.
            </Card.Description>
          </Card.Header>
          <Card.Content className="space-y-4 text-sm leading-7 text-muted">
            <Input
              aria-label="Suspicious roles"
              onChange={(event) =>
                setEditorState((current) => ({ ...current, suspiciousRoleIdsInput: event.currentTarget.value }))}
              placeholder="role_suspicious, role_quarantine"
              value={editorState.suspiciousRoleIdsInput}
              variant="secondary"
            />
            <p>Use comma-separated role IDs. Humanify saves them as the Bun-owned guild config.</p>
          </Card.Content>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {verificationRows.map((row) => (
          <Card key={row.state}>
            <Card.Header className="gap-2">
              <Card.Title>{row.state}</Card.Title>
              <Card.Description>{row.meaning}</Card.Description>
            </Card.Header>
            <Card.Content className="space-y-2 text-sm leading-7 text-muted">
              <p>{row.route}</p>
              <p>{row.nextStep}</p>
            </Card.Content>
          </Card>
        ))}
      </div>

      <Table variant="secondary">
        <Table.ScrollContainer>
          <Table.Content aria-label="Verification state table" className="min-w-[820px]">
            <Table.Header>
              <Table.Column isRowHeader>Session state</Table.Column>
              <Table.Column>Route</Table.Column>
              <Table.Column>Operator meaning</Table.Column>
              <Table.Column>Next step</Table.Column>
            </Table.Header>
            <Table.Body>
              {verificationRows.map((row) => (
                <Table.Row key={row.state}>
                  <Table.Cell>{row.state}</Table.Cell>
                  <Table.Cell>{row.route}</Table.Cell>
                  <Table.Cell>{row.meaning}</Table.Cell>
                  <Table.Cell>{row.nextStep}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>

      <Modal>
        <Button variant="secondary">Release rules</Button>
        <Modal.Backdrop>
          <Modal.Container>
            <Modal.Dialog className="sm:max-w-[560px]">
              <Modal.CloseTrigger />
              <Modal.Header>
                <Modal.Heading>Release rules</Modal.Heading>
              </Modal.Header>
              <Modal.Body className="space-y-4">
                <p>A browser success message is never enough.</p>
                <p>Provider verification and replay protection must pass server-side first.</p>
                <p>Only Bun can decide whether release-to-role or quarantine removal is currently allowed for the guild.</p>
              </Modal.Body>
              <Modal.Footer>
                <Button slot="close" variant="secondary">
                  Close
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </DashboardLayout>
  );
}

export function DashboardPolicyPage() {
  return (
    <DashboardLayout
      currentPath="/policy"
      sectionDescription="Policy / action boundary"
      sectionTitle="Action and policy boundary"
    >
      <Alert status="warning">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>No dashboard control implies direct execution authority.</Alert.Title>
          <Alert.Description>
            The API can plan writes and clamp moderation actions today, but this MVP intentionally stops short of presenting live execution controls or fabricated moderation history.
          </Alert.Description>
        </Alert.Content>
      </Alert>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <Card.Header className="gap-2">
            <Card.Title>Policy read</Card.Title>
            <Card.Description>Current policy reads come from Bun env defaults until guild-backed persistence lands.</Card.Description>
          </Card.Header>
          <Card.Content className="space-y-2 text-sm leading-7 text-muted">
            <p>GET /guilds/:guildId/policy</p>
            <StatusText>env_default_policy</StatusText>
          </Card.Content>
        </Card>
        <Card variant="secondary">
          <Card.Header className="gap-2">
            <Card.Title>Automatic ban guardrail</Card.Title>
            <Card.Description>allowAutoBan defaults to false and remains policy data, never inferred from model output.</Card.Description>
          </Card.Header>
          <Card.Content className="space-y-2 text-sm leading-7 text-muted">
            <p>Critical actions still require Bun-side clamp checks.</p>
            <p>Discord capability checks run before execution.</p>
          </Card.Content>
        </Card>
        <Card variant="tertiary">
          <Card.Header className="gap-2">
            <Card.Title>Action ladder</Card.Title>
            <Card.Description>{humanifyActionLadder.join(" → ")}</Card.Description>
          </Card.Header>
          <Card.Content className="space-y-2 text-sm leading-7 text-muted">
            <p>Rust recommendations can point to an action.</p>
            <p>Bun policy and canonical state decide whether it is allowed.</p>
          </Card.Content>
        </Card>
      </div>

      <Table variant="secondary">
        <Table.ScrollContainer>
          <Table.Content aria-label="Action ladder table" className="min-w-[820px]">
            <Table.Header>
              <Table.Column isRowHeader>Score band</Table.Column>
              <Table.Column>Default action</Table.Column>
              <Table.Column>Boundary note</Table.Column>
            </Table.Header>
            <Table.Body>
              {scoreBands.map((band) => (
                <Table.Row key={band.range}>
                  <Table.Cell>{band.range}</Table.Cell>
                  <Table.Cell>{band.defaultAction}</Table.Cell>
                  <Table.Cell>{band.notes}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
    </DashboardLayout>
  );
}
