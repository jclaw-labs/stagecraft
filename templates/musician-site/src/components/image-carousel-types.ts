/**
 * Server-safe types + constants for the ImageCarousel block. Split
 * out of `ImageCarousel.tsx` (which is `"use client"`) so server-
 * side importers — chiefly `puck/config.tsx`, which iterates
 * `CAROUSEL_ASPECT_RATIOS` to build the block's select-field
 * options — get real values instead of Next's client-reference
 * proxy.
 *
 * Same pattern this codebase already uses: `newsletter-types.ts`,
 * `field-classification.ts`, `filter-schema.ts`,
 * `puck-content-value.ts`, `field-ids.ts`.
 */

import type { ImageMetadata } from "@/lib/image-types";

export const CAROUSEL_ASPECT_RATIOS = ["16/9", "4/3", "1/1", "3/4"] as const;
export type CarouselAspectRatio = (typeof CAROUSEL_ASPECT_RATIOS)[number];

export const CAROUSEL_ASPECT_RATIO_LABELS: Record<CarouselAspectRatio, string> = {
  "16/9": "Widescreen (16:9)",
  "4/3": "Standard (4:3)",
  "1/1": "Square (1:1)",
  "3/4": "Portrait (3:4)",
};

export type ImageCarouselSlide = {
  image: ImageMetadata;
  caption?: string;
};
