import { NextResponse } from "next/server";

import { matchRoute, type RouteParams } from "#lib/route-match.js";

import * as authDevLogin from "./auth/dev-login/route.js";
import * as authLogout from "./auth/logout/route.js";
import * as authRequest from "./auth/request/route.js";
import * as authVerify from "./auth/verify/route.js";
import * as collectionItem from "./collections/[slug]/items/[itemSlug]/route.js";
import * as collectionItems from "./collections/[slug]/items/route.js";
import * as collectionOrder from "./collections/[slug]/order/route.js";
import * as collectionSchema from "./collections/[slug]/schema/route.js";
import * as collectionTemplate from "./collections/[slug]/template/[kind]/route.js";
import * as collections from "./collections/route.js";
import * as contact from "./contact/route.js";
import * as discardDraft from "./discard-draft/route.js";
import * as draftChanges from "./draft-changes/route.js";
import * as publishDraft from "./publish-draft/route.js";
import * as publishSelected from "./publish-selected/route.js";
import * as publishStatus from "./publish-status/route.js";
import * as uploadImage from "./upload-image/route.js";
import * as welcomeComplete from "./welcome/complete/route.js";
import * as welcomeReset from "./welcome/reset/route.js";

/**
 * The `/api` router (ADR-016 §1). One catch-all route,
 * `app/api/[...path]/route.ts`, serves every endpoint by dispatching on
 * path and method to the handler modules here, so adding an endpoint
 * never changes the artist-repo shell.
 */

export const API_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type ApiMethod = (typeof API_METHODS)[number];

/** What Next.js passes the catch-all route's handlers. */
export type ApiRouterContext = { params: Promise<{ path?: string[] }> };

/** A handler as Next.js would call it from a file route of its own. */
type Handler = (request: Request, ctx: { params: Promise<RouteParams> }) => Response | Promise<Response>;

/** A route module: some of the method handlers. */
type HandlerModule = Partial<Record<ApiMethod, unknown>>;

export type ApiRoute = { pattern: string; module: HandlerModule };

/** Every endpoint, by path below `/api`. `:name` is a dynamic segment. */
export const API_ROUTES: readonly ApiRoute[] = [
  { pattern: "auth/dev-login", module: authDevLogin },
  { pattern: "auth/logout", module: authLogout },
  { pattern: "auth/request", module: authRequest },
  { pattern: "auth/verify", module: authVerify },
  { pattern: "collections", module: collections },
  { pattern: "collections/:slug/items", module: collectionItems },
  { pattern: "collections/:slug/items/:itemSlug", module: collectionItem },
  { pattern: "collections/:slug/order", module: collectionOrder },
  { pattern: "collections/:slug/schema", module: collectionSchema },
  { pattern: "collections/:slug/template/:kind", module: collectionTemplate },
  { pattern: "contact", module: contact },
  { pattern: "discard-draft", module: discardDraft },
  { pattern: "draft-changes", module: draftChanges },
  { pattern: "publish-draft", module: publishDraft },
  { pattern: "publish-selected", module: publishSelected },
  { pattern: "publish-status", module: publishStatus },
  { pattern: "upload-image", module: uploadImage },
  { pattern: "welcome/complete", module: welcomeComplete },
  { pattern: "welcome/reset", module: welcomeReset },
];

/** The methods a route module serves, in `API_METHODS` order. */
export function allowedMethods(module: HandlerModule): ApiMethod[] {
  return API_METHODS.filter((method) => typeof module[method] === "function");
}

/**
 * Dispatch `request` to the handler for its path and `method`: a 404 for
 * an unknown path, and a 405 with an `Allow` header for a method the path
 * doesn't serve.
 */
export async function dispatch(method: ApiMethod, request: Request, ctx: ApiRouterContext): Promise<Response> {
  const match = matchRoute(API_ROUTES, (await ctx.params).path ?? []);
  if (!match) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const handler = match.route.module[method];
  if (typeof handler !== "function") {
    return NextResponse.json(
      { error: "Method not allowed" },
      { status: 405, headers: { Allow: allowedMethods(match.route.module).join(", ") } },
    );
  }
  return (handler as Handler)(request, { params: Promise.resolve(match.params) });
}

export const GET = (request: Request, ctx: ApiRouterContext) => dispatch("GET", request, ctx);
export const POST = (request: Request, ctx: ApiRouterContext) => dispatch("POST", request, ctx);
export const PUT = (request: Request, ctx: ApiRouterContext) => dispatch("PUT", request, ctx);
export const PATCH = (request: Request, ctx: ApiRouterContext) => dispatch("PATCH", request, ctx);
export const DELETE = (request: Request, ctx: ApiRouterContext) => dispatch("DELETE", request, ctx);
