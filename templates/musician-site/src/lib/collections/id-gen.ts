/**
 * Server-only id generation for the Collection abstraction.
 *
 * Imports `node:crypto`, so this module must never be value-imported
 * from a `"use client"` file. It lives apart from `schema.ts` precisely
 * so the schema core stays node-free / client-importable — admin forms
 * can run the same Zod schemas the server uses without dragging
 * `node:crypto` into the browser bundle. Server callers reach these via
 * the barrel `@/lib/collections`; sibling submodules import `./id-gen`.
 */

import { randomUUID } from "node:crypto";

import type { FieldId, ItemId } from "./schema";

/**
 * ID generation helpers. Every consumer that creates a new field or
 * item should call these rather than rolling its own scheme — keeps
 * id shapes consistent across the codebase, and gives us one place to
 * change the strategy (e.g. swap UUID for nanoid) if we ever need to.
 *
 * The prefixes (`fld_` / `item_`) carry no semantic load at the data
 * layer; they exist so a stray id in a log line tells you what it
 * refers to.
 */
export const generateFieldId = (): FieldId => `fld_${randomUUID()}`;
export const generateItemId = (): ItemId => `item_${randomUUID()}`;
