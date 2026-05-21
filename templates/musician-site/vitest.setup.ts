/**
 * Vitest setup — register the React Testing Library cleanup hook so
 * each `render()` call in an interaction test tears down before the
 * next, instead of letting DOM trees accumulate across tests in the
 * same file.
 *
 * RTL only auto-registers cleanup when vitest is configured with
 * `globals: true` (it reaches for an ambient `afterEach`); we don't
 * use globals, so we register the hook here explicitly.
 */

import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
