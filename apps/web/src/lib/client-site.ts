import { narrowJobFields, type StoredJobFields } from "@stagecraft/shared";

/**
 * Shape a `Site` row, with its jobs, for a JSON response.
 *
 * Drops the broker secret hash: even hashed, the client has no use for it,
 * and exposing it widens the attack surface for any future weakness. Narrows
 * each job, since old rows can hold a retired type, status or failure
 * category (#447).
 */
export function toClientSite<J extends StoredJobFields, S extends { brokerSecretHash: string | null }>(
  site: S & { jobs: J[] },
) {
  const { brokerSecretHash, jobs, ...rest } = site;
  void brokerSecretHash;
  return { ...rest, jobs: jobs.map((job) => narrowJobFields(job)) };
}
