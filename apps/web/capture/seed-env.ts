/**
 * Side-effect module: ensure DATABASE_URL is set before the Prisma
 * client (constructed at import time by `@stagecraft/db`) reads it.
 *
 * MUST be imported before `@stagecraft/db`. Mirrors the webServer
 * default in playwright.capture.config.ts so a bare
 * `npm run capture:screenshots` against the docker-compose Postgres
 * works without exporting DATABASE_URL first.
 */
import { CAPTURE_DATABASE_URL } from "../playwright.capture.config";

process.env.DATABASE_URL = CAPTURE_DATABASE_URL;
