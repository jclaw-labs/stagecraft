/**
 * Public API for the template renderer (ADR-009 PR 2).
 *
 * Consumers should import from `@/lib/collections/template` rather
 * than the individual files so the surface stays curated.
 */

export * from "./binding";
export * from "./primitives";
export * from "./puck-config";
export * from "./renderer";
export * from "./tiptap-render";
export type { BlockInstance, Template } from "./types";
