import { isPlatformConfigured, readEnv, type Env } from "./publish";

/**
 * Coalesced deploy state used by the editor's publish-status pill.
 * Mirrors the platform-side `apps/web/src/lib/deploy-status-broker-types.ts`
 * union — kept in sync by hand because the artist site can't import from
 * `apps/web` (different package boundary).
 */
export type DeployState =
  | "queued"
  | "initializing"
  | "building"
  | "finalizing"
  | "ready"
  | "error"
  | "unknown";

export type DeployStatus = {
  id: string | null;
  state: DeployState;
  url: string | null;
  errorMessage?: string | null;
  createdAt: string | null;
};

export class DeployStatusError extends Error {
  constructor(
    public code: "broker-unreachable" | "broker-rejected" | "no-platform-configured",
    message: string,
  ) {
    super(message);
    this.name = "DeployStatusError";
  }
}

/**
 * Fetch the latest deploy status for this site by hitting the platform's
 * broker endpoint. Returns the same normalized shape as the platform's
 * own /api/sites/[id]/deploy-status endpoint.
 *
 * Throws `DeployStatusError("no-platform-configured")` when the artist
 * site is running in dev fallback (no broker env vars) — caller should
 * treat that as a non-error and skip polling.
 */
export async function fetchDeployStatus(env: Env = readEnv()): Promise<DeployStatus> {
  if (!isPlatformConfigured(env)) {
    throw new DeployStatusError(
      "no-platform-configured",
      "STAGECRAFT_PLATFORM_URL / STAGECRAFT_SITE_ID / STAGECRAFT_BROKER_SECRET must all be set",
    );
  }

  let response: Response;
  try {
    response = await fetch(`${env.platformUrl}/api/broker/deploy-status`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.brokerSecret}`,
      },
      body: JSON.stringify({ siteId: env.siteId }),
      // Disable Next.js fetch caching — this is a polling endpoint, the
      // whole point is to see fresh state.
      cache: "no-store",
    });
  } catch (cause) {
    throw new DeployStatusError(
      "broker-unreachable",
      `Could not reach deploy-status broker: ${String(cause)}`,
    );
  }

  if (!response.ok) {
    throw new DeployStatusError(
      "broker-rejected",
      `Broker returned ${response.status} ${response.statusText}`,
    );
  }

  const body = (await response.json()) as { ok: true; deploy: DeployStatus } | { ok: false };
  if (!body.ok) {
    throw new DeployStatusError("broker-rejected", "Broker returned ok:false");
  }
  return body.deploy;
}
