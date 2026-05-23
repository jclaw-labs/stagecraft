/**
 * Puck `Config` for the template-rendering side.
 *
 * Built from `PRIMITIVE_BLOCKS` so the same registry drives both the
 * walker (which calls each entry's `resolveProps`) and Puck's
 * `<Render>` (which uses the corresponding `Component` as the
 * component's render function).
 *
 * The fields config is deliberately skeletal in PR 2 — `<Render>`
 * only needs to know which fields are slots (so it wraps their
 * contents into a `SlotComponent`). PR 6 swaps in binding-aware
 * custom fields for the editor.
 */

import type { Config } from "@measured/puck";

import { PRIMITIVE_BLOCKS, type BlockEntry } from "./primitives";

export function buildTemplatePuckConfig(
  registry: Readonly<Record<string, BlockEntry>> = PRIMITIVE_BLOCKS,
): Config {
  const components: Config["components"] = {};
  for (const [name, entry] of Object.entries(registry)) {
    components[name] = {
      fields: entry.fields as Config["components"][string]["fields"],
      render: entry.Component as Config["components"][string]["render"],
    };
  }
  return { components, root: { fields: {} } };
}

/** The default config built from `PRIMITIVE_BLOCKS`. Most callers use this. */
export const templatePuckConfig: Config = buildTemplatePuckConfig();
