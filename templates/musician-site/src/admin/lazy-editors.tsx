"use client";

import dynamic from "next/dynamic";

/**
 * The Puck editors, each as its own lazily loaded chunk.
 *
 * Every admin page is served by the one admin catch-all route, and Next.js
 * ships a route's client modules together, so an editor imported directly
 * would load Puck (about 1 MB of script plus `puck.css`) on every admin
 * page, the sign-in page included. Behind `next/dynamic` an editor's
 * script and styles load only on the page that renders it.
 *
 * Client-only (`ssr: false`): server-rendered through `next/dynamic`, the
 * editor's canvas iframe came up empty and blocks couldn't be dropped in.
 * Puck builds its UI in the browser either way, and its stylesheet arrives
 * with the chunk, so the editor is still styled when it first paints.
 */

export const Editor = dynamic(() => import("./pages/[slug]/Editor.js").then((m) => m.Editor), { ssr: false });

export const TemplateEditorClient = dynamic(
  () => import("./collections/[slug]/template/TemplateEditorClient.js").then((m) => m.TemplateEditorClient),
  { ssr: false },
);

export const BodyEditorClient = dynamic(
  () =>
    import("./collections/[slug]/items/[itemSlug]/body/[fieldId]/BodyEditorClient.js").then(
      (m) => m.BodyEditorClient,
    ),
  { ssr: false },
);
