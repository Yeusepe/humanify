/**
 * Purpose: Keeps provider-specific browser launch and reusable-proof UI behavior behind option runtimes so verifier main files stay provider-neutral.
 * Governing docs:
 * - AGENTS.md
 * - docs\api.md
 * - docs\verification.md
 * - docs\workspaces.md
 * External references:
 * - https://docs.didit.me/integration/api-full-flow
 * - https://docs.privado.id/docs/verifier/verifier-overview/
 * Tests:
 * - apps/verifier-start/src/verification-flow.test.ts
 */

import type { VerificationProviderDefinition } from "@humanify/verification-providers";

export type VerificationOptionLaunch = {
  mode: "didit_sdk";
  packageName: "@didit-protocol/sdk-web";
  providerId: "didit";
  providerSessionId: string;
  providerStatus: string;
  url: string;
};

export type VerificationOptionBrowserResult = {
  kind: "cancelled" | "completed" | "failed";
  message: string;
  refreshStatus: boolean;
};

type VerificationOptionBoundaryLike = {
  launch?: VerificationOptionLaunch;
};

type DiditVerificationResult = {
  error?: {
    message?: string;
  };
  session?: {
    status?: string;
  };
  type: "cancelled" | "completed" | "failed";
};

type DiditSdkLike = {
  onComplete?: (result: DiditVerificationResult) => void;
  startVerification(input: {
    configuration?: Record<string, unknown>;
    url: string;
  }): Promise<void>;
};

type BrowserLaunchRuntime = {
  challengeAcceptedMessage(provider: VerificationProviderDefinition): string;
  errorMessage(provider: VerificationProviderDefinition): string;
  getLaunch(boundary: VerificationOptionBoundaryLike): VerificationOptionLaunch | null;
  intro(provider: VerificationProviderDefinition): string;
  launchButtonLabel(provider: VerificationProviderDefinition, state: "idle" | "launching"): string;
  pendingNote(provider: VerificationProviderDefinition): string;
  start(launch: VerificationOptionLaunch, input: { onBrowserResult: (result: VerificationOptionBrowserResult) => void }): Promise<void>;
};

type ReusableProofRuntime = {
  createRequestLabel(provider: VerificationProviderDefinition, hasExistingRequest: boolean): string;
  openWalletLabel(provider: VerificationProviderDefinition): string;
  startErrorMessage(provider: VerificationProviderDefinition): string;
  startSuccessMessage(provider: VerificationProviderDefinition): string;
  summaryBullets(provider: VerificationProviderDefinition): string[];
  summaryTitle(provider: VerificationProviderDefinition): string;
  verifyErrorMessage(provider: VerificationProviderDefinition): string;
};

type VerificationOptionRouteRuntime = {
  browserLaunch?: BrowserLaunchRuntime;
  reusableProof?: ReusableProofRuntime;
};

function readSharedDiditSdk() {
  const maybeWindow = globalThis as {
    window?: {
      DiditSdk?: {
        shared?: DiditSdkLike;
      };
    };
  };

  return maybeWindow.window?.DiditSdk?.shared;
}

function summarizeDiditBrowserResult(result: DiditVerificationResult): VerificationOptionBrowserResult {
  switch (result.type) {
    case "completed":
      return {
        kind: "completed",
        message: `Verification finished in your browser with status "${result.session?.status ?? "Unknown"}". Humanify is now checking the server-confirmed result.`,
        refreshStatus: true,
      };
    case "cancelled":
      return {
        kind: "cancelled",
        message: "You closed the browser verification flow before Humanify received a finished result. Your verification is still pending.",
        refreshStatus: false,
      };
    case "failed":
      return {
        kind: "failed",
        message: result.error?.message
          ? `The browser verification flow could not continue: ${result.error.message}`
          : "The browser verification flow could not continue. Please try again or choose another proof path.",
        refreshStatus: false,
      };
  }
}

const diditBrowserLaunchRuntime: BrowserLaunchRuntime = {
  challengeAcceptedMessage(provider) {
    return `Challenge accepted. Humanify created your ${provider.title} session on the server. Start ${provider.title} when you're ready, and remember that Humanify only trusts the backend verification receipt.`;
  },
  errorMessage(provider) {
    return `${provider.title} could not be started.`;
  },
  getLaunch(boundary) {
    return boundary.launch?.mode === "didit_sdk"
      && boundary.launch.providerId === "didit"
      && typeof boundary.launch.url === "string"
      ? boundary.launch
      : null;
  },
  intro(provider) {
    return `${provider.title} is Humanify's current browser capture path for people who need a fresh identity and liveness flow. The tradeoff is that the provider briefly processes raw identity material before Humanify reduces the result to a minimal receipt.`;
  },
  launchButtonLabel(provider, state) {
    return state === "launching" ? `Opening ${provider.title}…` : `Start ${provider.title} verification`;
  },
  pendingNote(provider) {
    return `If ${provider.title} says you are done but Humanify still shows pending, wait for the server-side reconciliation or refresh this page.`;
  },
  async start(launch, input) {
    const sdk = readSharedDiditSdk() ?? (await import("@didit-protocol/sdk-web")).DiditSdk.shared as unknown as DiditSdkLike;
    sdk.onComplete = (result) => {
      input.onBrowserResult(summarizeDiditBrowserResult(result));
    };

    await sdk.startVerification({
      configuration: {
        closeModalOnComplete: true,
        showExitConfirmation: true,
      },
      url: launch.url,
    });
  },
};

const privadoReusableProofRuntime: ReusableProofRuntime = {
  createRequestLabel(provider, hasExistingRequest) {
    return hasExistingRequest ? `Create a new ${provider.title} proof request` : `Create ${provider.title} proof request`;
  },
  openWalletLabel(provider) {
    return `Open ${provider.title} wallet`;
  },
  startErrorMessage(provider) {
    return `${provider.title} proof request creation failed.`;
  },
  startSuccessMessage(provider) {
    return `${provider.title} proof request created. Open your wallet or the ${provider.title} web wallet, then return here so Humanify can verify the proof server-side.`;
  },
  summaryBullets() {
    return [
      "You keep the credential and wallet state.",
      "Humanify only learns whether the requested claims passed, plus minimal proof receipt data.",
      "Humanify does not ingest your full credential payload or document images.",
    ];
  },
  summaryTitle(provider) {
    return `${provider.title} reusable proof`;
  },
  verifyErrorMessage(provider) {
    return `${provider.title} proof verification failed.`;
  },
};

const optionRouteRuntimes: Partial<Record<VerificationProviderDefinition["id"], VerificationOptionRouteRuntime>> = {
  didit: {
    browserLaunch: diditBrowserLaunchRuntime,
  },
  privado: {
    reusableProof: privadoReusableProofRuntime,
  },
};

const genericRouteRuntime: VerificationOptionRouteRuntime = {};

export function resolveVerificationOptionRouteRuntime(provider: VerificationProviderDefinition): VerificationOptionRouteRuntime {
  return optionRouteRuntimes[provider.id] ?? genericRouteRuntime;
}

export function getVerificationOptionBrowserLaunch(
  boundary: VerificationOptionBoundaryLike,
): VerificationOptionLaunch | null {
  const launch = boundary.launch;
  if (!launch) {
    return null;
  }

  const runtime = optionRouteRuntimes[launch.providerId];
  return runtime?.browserLaunch?.getLaunch(boundary) ?? null;
}

export async function startVerificationOptionBrowserLaunch(
  launch: VerificationOptionLaunch,
  input: { onBrowserResult: (result: VerificationOptionBrowserResult) => void },
) {
  const runtime = optionRouteRuntimes[launch.providerId]?.browserLaunch;
  if (!runtime) {
    throw new Error(`Browser launch is not configured for "${launch.providerId}".`);
  }

  await runtime.start(launch, input);
}
