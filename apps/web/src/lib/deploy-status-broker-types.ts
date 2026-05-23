import { z } from "zod";

/**
 * Shared types for `POST /api/broker/deploy-status` — the broker-authed
 * passthrough that artist sites call to learn their own deploy state.
 * The artist-site mirror lives at
 * `templates/musician-site/src/lib/publish-status-types.ts`; both files
 * agree on the wire shape (the artist site can't import from `apps/web`
 * directly — different package boundaries).
 */

export const deployStatusBrokerRequestSchema = z.object({
  siteId: z.string().min(1),
});

export type DeployStatusBrokerRequest = z.infer<typeof deployStatusBrokerRequestSchema>;

export type DeployStatusBrokerErrorCode =
  | "missing-bearer"
  | "invalid-body"
  | "site-not-found"
  | "invalid-secret"
  | "provider-failed";

export type DeployStatusBrokerError = {
  ok: false;
  code: DeployStatusBrokerErrorCode;
  error?: string;
};

/**
 * Coalesced deploy state across providers. Vercel and Netlify expose
 * different (and longer) raw state enums; we normalize to these five
 * meaningful phases so consumers can drive a single progress UI.
 *
 *   queued       waiting for a builder to pick up the job
 *   initializing builder is spinning up (cloning repo, npm ci, etc.)
 *   building     framework build is running (`next build` and similar)
 *   finalizing   build done, uploading artifacts / running post-deploy
 *                steps / swapping production alias
 *   ready        live and serving
 *   error        failed (or canceled, on Vercel)
 *   unknown      not yet known — provider returned no deploys, or the
 *                site has no deploy target configured
 *
 * Provider → enum mapping lives in `integrations/{vercel,netlify}.ts`.
 */
export type DeployState =
  | "queued"
  | "initializing"
  | "building"
  | "finalizing"
  | "ready"
  | "error"
  | "unknown";

export type DeployStatusBrokerSuccess = {
  ok: true;
  deploy: {
    id: string | null;
    state: DeployState;
    url: string | null;
    errorMessage?: string | null;
    createdAt: string | null;
  };
};

export type DeployStatusBrokerResponse = DeployStatusBrokerSuccess | DeployStatusBrokerError;
