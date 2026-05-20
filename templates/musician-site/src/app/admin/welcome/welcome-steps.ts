/**
 * Welcome-wizard step ids + shape of the in-flight form values.
 *
 * Split out from the client component so tests (and the request-body
 * Zod schema on the server) can import the types without dragging in
 * the React tree. The order of `WELCOME_STEPS` is the order the
 * artist walks; rearrange here to reshuffle the flow.
 */

import type { ImageMetadata } from "@/lib/image-types";

export const WELCOME_STEPS = ["name", "color", "wordmark", "firstPage"] as const;
export type WelcomeStep = (typeof WELCOME_STEPS)[number];

export type WelcomeFormValues = {
  artistName: string;
  primaryColor: string;
  wordmark: ImageMetadata | null;
  firstPageTitle: string;
};
