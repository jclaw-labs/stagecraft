import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// No incremental cache override: the app renders dynamically and an R2 cache
// needs a bucket on a live Cloudflare account (deploy work is tracked in #324).
export default defineCloudflareConfig({});
