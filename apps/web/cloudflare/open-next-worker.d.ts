/**
 * Type for the handler `opennextjs-cloudflare build` generates, so
 * cloudflare/worker.ts typechecks before a build has run. Once
 * .open-next/worker.js exists, TypeScript reads the generated file instead
 * (allowJs) and this declaration no longer applies.
 */
declare module "*/.open-next/worker.js" {
  const handler: {
    fetch: import("./scheduled").WorkerFetch<import("./scheduled").ScheduledEnv>;
  };
  export default handler;
}
