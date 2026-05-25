/**
 * Public API for the Collection abstraction (ADR-009).
 *
 * Callers should import from `@/lib/collections` rather than reaching
 * into the submodules directly so the surface stays curated.
 */

export * from "./schema";
export * from "./id-gen";
export * from "./store";
export * from "./read-store";
export * from "./accessors";
export * from "./schema-changes";
export * from "./routing";
export * from "./sort-key";
