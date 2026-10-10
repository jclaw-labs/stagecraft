/**
 * Public API for the template renderer (ADR-009 PR 2).
 *
 * Consumers should import from `#lib/collections/template` rather
 * than the individual files so the surface stays curated.
 */

export * from "./bindable-slots.js";
export * from "./binding.js";
export * from "./renderer.js";
export * from "./tiptap-render.js";
export type { BlockInstance, Template } from "./types.js";
