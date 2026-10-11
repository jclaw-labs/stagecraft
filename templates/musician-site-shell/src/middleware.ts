export { middleware } from "@jclaw-labs/musician-site/middleware";

// A literal: Next.js reads the matcher statically. The package decides
// which of these paths are public.
export const config = {
  matcher: ["/admin/:path*", "/api/:path*"],
};
