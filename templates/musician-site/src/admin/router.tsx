import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { matchRoute, type RouteMatch, type RouteParams } from "#lib/route-match.js";

import * as appearance from "./appearance/page.js";
import * as collectionItemBody from "./collections/[slug]/items/[itemSlug]/body/[fieldId]/page.js";
import * as collectionItem from "./collections/[slug]/items/[itemSlug]/page.js";
import * as collectionItemNew from "./collections/[slug]/items/new/page.js";
import * as collection from "./collections/[slug]/page.js";
import * as collectionSchema from "./collections/[slug]/schema/page.js";
import * as collectionTemplateDetail from "./collections/[slug]/template/detail/page.js";
import * as collectionTemplateItem from "./collections/[slug]/template/item/page.js";
import * as collectionNew from "./collections/new/page.js";
import * as collections from "./collections/page.js";
import * as login from "./login/page.js";
import * as navigation from "./navigation/page.js";
import * as root from "./page.js";
import * as pageEdit from "./pages/[slug]/page.js";
import * as pages from "./pages/page.js";
import * as settings from "./settings/page.js";
import * as welcome from "./welcome/page.js";

/**
 * The `/admin` router (ADR-016 §1). One optional catch-all route,
 * `app/admin/[[...path]]/page.tsx`, serves every admin page by mapping
 * the path to a page module here, so adding a page never changes the
 * artist-repo shell. An unknown path calls `notFound()`, which renders
 * `app/admin/not-found.tsx` rather than the artist-themed global 404.
 *
 * The catch-all route sets `dynamic = "force-dynamic"`: Next.js reads
 * route segment config statically from the route file, so it can't come
 * from the page modules. Admin pages read the session and draft content
 * on every request anyway.
 */

export type AdminSearchParams = Record<string, string | string[] | undefined>;

/** What Next.js passes the catch-all route's page and `generateMetadata`. */
export type AdminRouterProps = {
  params: Promise<{ path?: string[] }>;
  searchParams: Promise<AdminSearchParams>;
};

/** What the router passes a page module: its own params, as Next.js would. */
type PageProps = { params: Promise<RouteParams>; searchParams: Promise<AdminSearchParams> };

/** A page module: a default component, plus optional metadata. */
type PageModule = {
  default: unknown;
  metadata?: Metadata;
  generateMetadata?: unknown;
};

export type AdminRoute = { pattern: string; module: PageModule };

/** Every admin page, by path below `/admin`. `:name` is a dynamic segment. */
export const ADMIN_ROUTES: readonly AdminRoute[] = [
  { pattern: "", module: root },
  { pattern: "appearance", module: appearance },
  { pattern: "collections", module: collections },
  { pattern: "collections/new", module: collectionNew },
  { pattern: "collections/:slug", module: collection },
  { pattern: "collections/:slug/items/new", module: collectionItemNew },
  { pattern: "collections/:slug/items/:itemSlug", module: collectionItem },
  { pattern: "collections/:slug/items/:itemSlug/body/:fieldId", module: collectionItemBody },
  { pattern: "collections/:slug/schema", module: collectionSchema },
  { pattern: "collections/:slug/template/detail", module: collectionTemplateDetail },
  { pattern: "collections/:slug/template/item", module: collectionTemplateItem },
  { pattern: "login", module: login },
  { pattern: "navigation", module: navigation },
  { pattern: "pages", module: pages },
  { pattern: "pages/:slug", module: pageEdit },
  { pattern: "settings", module: settings },
  { pattern: "welcome", module: welcome },
];

/** The admin route serving `path` (the segments below `/admin`), or null. */
export function matchAdminRoute(path: readonly string[] = []): RouteMatch<AdminRoute> | null {
  return matchRoute(ADMIN_ROUTES, path);
}

async function resolve(params: AdminRouterProps["params"]): Promise<RouteMatch<AdminRoute>> {
  const match = matchAdminRoute((await params).path);
  if (!match) notFound();
  return match;
}

/** The catch-all page: renders the matched page module, or the admin 404. */
export default async function AdminRouter({ params, searchParams }: AdminRouterProps): Promise<ReactNode> {
  const { route, params: pageParams } = await resolve(params);
  // Each page types its own params; the router hands it exactly the
  // segments its pattern names, as a file route would get them.
  const Page = route.module.default as (props: PageProps) => ReactNode | Promise<ReactNode>;
  return <Page params={Promise.resolve(pageParams)} searchParams={searchParams} />;
}

/** The matched page's `generateMetadata` or `metadata`, else none. */
export async function generateMetadata({ params, searchParams }: AdminRouterProps): Promise<Metadata> {
  const match = matchAdminRoute((await params).path);
  if (!match) return {};
  const { module } = match.route;
  if (typeof module.generateMetadata === "function") {
    const generate = module.generateMetadata as (props: PageProps) => Metadata | Promise<Metadata>;
    return generate({ params: Promise.resolve(match.params), searchParams });
  }
  return module.metadata ?? {};
}
