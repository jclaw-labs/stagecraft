import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import {
  BLOCK_DESCRIPTIONS,
  newsletterUrlDescription,
  puckConfig,
  HEADING_LEVELS,
  SECTION_WIDTHS,
  BUTTON_VARIANTS,
  SPACER_SIZES,
  COLUMN_LAYOUTS,
  TEXT_ALIGNMENTS,
} from "./config";

function render<K extends keyof typeof puckConfig.components>(
  name: K,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  props: any,
): string {
  const component = puckConfig.components[name];
  // Puck's render is typed loosely; cast to a callable for tests.
  const renderFn = component.render as (p: unknown) => React.ReactElement;
  return renderToStaticMarkup(createElement(() => renderFn(props)));
}

describe("puckConfig", () => {
  it("exposes the expected block names", () => {
    expect(Object.keys(puckConfig.components).sort()).toEqual(
      [
        "Button",
        "Card",
        "CenteredBlock",
        "Columns",
        "ContactForm",
        "Divider",
        "Embed",
        "EmbedResponsive",
        "FullscreenSection",
        "Heading",
        "Image",
        "ImageCarousel",
        "NewsletterSignup",
        "Quote",
        "RichText",
        "Section",
        "Spacer",
      ].sort(),
    );
  });

  it("declares per-page root fields (title, isSplashPage, isFooterHidden)", () => {
    expect(puckConfig.root?.fields?.title?.type).toBe("text");
    expect(puckConfig.root?.fields?.isSplashPage?.type).toBe("radio");
    expect(puckConfig.root?.fields?.isFooterHidden?.type).toBe("radio");
  });

  it("categorises every registered component (no implicit `other` group)", () => {
    // If a new block lands in `components` but the author forgets to
    // add it to a category, Puck silently drops it into an implicit
    // `other` group. We don't define `other`, so the block can end up
    // in an unstyled fallback section. Catch that here rather than
    // discovering it via "where's my block in the drawer?".
    const inCategories = new Set(
      Object.values(puckConfig.categories ?? {}).flatMap(
        (c) => c?.components ?? [],
      ),
    );
    const categoryKeys = Object.keys(puckConfig.categories ?? {}).join(" | ");
    for (const name of Object.keys(puckConfig.components)) {
      expect(
        inCategories,
        `block "${name}" is not assigned to any drawer category. ` +
          `Add it to one of [${categoryKeys}] in puckConfig.categories ` +
          `(src/puck/config.tsx).`,
      ).toContain(name);
    }
  });

  it("has a non-empty description for every registered block", () => {
    // TypeScript catches a missing key at the `Record<keyof BlockProps,
    // string>` declaration site, but the runtime check covers two
    // residual cases: an accidental empty string slipping in, and a
    // block being added via cast / refactor that bypasses the static
    // record.
    const where = "Add an entry in BLOCK_DESCRIPTIONS (src/puck/config.tsx).";
    for (const name of Object.keys(puckConfig.components)) {
      const description =
        BLOCK_DESCRIPTIONS[name as keyof typeof BLOCK_DESCRIPTIONS];
      expect(
        description,
        `block "${name}" is missing an inspector description. ${where}`,
      ).toBeTruthy();
      expect(
        description?.length,
        `BLOCK_DESCRIPTIONS["${name}"] is too short to be useful ` +
          `(aim for one full sentence).`,
      ).toBeGreaterThan(10);
    }
  });

  describe("Heading", () => {
    it("select options match HEADING_LEVELS", () => {
      const field = puckConfig.components.Heading.fields?.level;
      expect(field?.type).toBe("select");
      if (field?.type === "select") {
        expect(field.options.map((o) => o.value)).toEqual([...HEADING_LEVELS]);
      }
    });
  });

  describe("Section", () => {
    it("select options match SECTION_WIDTHS", () => {
      const field = puckConfig.components.Section.fields?.width;
      expect(field?.type).toBe("select");
      if (field?.type === "select") {
        expect(field.options.map((o) => o.value)).toEqual([...SECTION_WIDTHS]);
      }
    });

    it("uses a slot for children (artists drop blocks inside, not a textarea body)", () => {
      // Puck's `Config<T>` generic collapses BlockProps.Section's `children`
      // slot through the same path as Image — cast for the runtime check.
      const fields = (puckConfig.components.Section.fields ?? {}) as Record<
        string,
        { type?: string }
      >;
      expect(fields.children?.type).toBe("slot");
      // Headline / body were removed when Section became a slot container —
      // the artist drops a Heading and/or RichText block instead.
      expect(fields.headline).toBeUndefined();
      expect(fields.body).toBeUndefined();
    });

    it("renders a <section> with the configured max-width and calls the children slot", () => {
      // Stub the slot component to a tag we can detect in the output.
      const slot = () => "<<children-rendered>>" as unknown as React.ReactElement;
      const html = render("Section", {
        width: "md",
        textAlign: "start",
        children: slot,
      });
      expect(html).toContain("<section");
      expect(html).toMatch(/max-width:\s*var\(--max-width-content\)/);
      expect(html).toContain("&lt;&lt;children-rendered&gt;&gt;");
    });
  });

  describe("RichText", () => {
    it("splits the textarea into multiple <p> tags on blank lines", () => {
      const html = render("RichText", { text: "First paragraph.\n\nSecond paragraph." });
      const matches = html.match(/<p>/g) ?? [];
      expect(matches).toHaveLength(2);
      expect(html).toContain("First paragraph.");
      expect(html).toContain("Second paragraph.");
    });

    it("ignores blank-only paragraphs (no empty <p></p>)", () => {
      const html = render("RichText", { text: "Hello.\n\n   \n\nWorld." });
      const matches = html.match(/<p>/g) ?? [];
      expect(matches).toHaveLength(2);
      expect(html).not.toContain("<p></p>");
    });

    it("renders a single <p> when the text has no blank lines", () => {
      const html = render("RichText", { text: "Just one paragraph." });
      const matches = html.match(/<p>/g) ?? [];
      expect(matches).toHaveLength(1);
    });
  });

  describe("Button", () => {
    it("select options match BUTTON_VARIANTS", () => {
      const field = puckConfig.components.Button.fields?.variant;
      expect(field?.type).toBe("select");
      if (field?.type === "select") {
        expect(field.options.map((o) => o.value)).toEqual([...BUTTON_VARIANTS]);
      }
    });

    it("renders an anchor with the given href + text", () => {
      const html = render("Button", { text: "Buy ticket", href: "/tickets", variant: "primary" });
      expect(html).toContain('href="/tickets"');
      expect(html).toContain("Buy ticket");
    });

    it("variant changes the inline style", () => {
      const primary = render("Button", { text: "x", href: "#", variant: "primary" });
      const outline = render("Button", { text: "x", href: "#", variant: "outline" });
      expect(primary).not.toBe(outline);
    });
  });

  describe("Image", () => {
    const sampleImage = {
      id: "abc1234567890def",
      alt: "stage shot",
      width: 1200,
      height: 800,
      placeholderDataUri: "data:image/webp;base64,AAAA",
      contentSlug: "uploads",
      originalExt: "jpg" as const,
    };

    it("uses a custom field for image picking (no raw text inputs for src/alt/width/height)", () => {
      // Puck's Config<T> generic collapses BlockProps.Image's fields type
      // through the branded ImageId — TS infers `fields` as `{}` so the
      // `image`/`caption` keys aren't statically reachable. Cast through
      // a permissive shape; runtime keys + types are what we're asserting.
      const fields = (puckConfig.components.Image.fields ?? {}) as Record<
        string,
        { type?: string }
      >;
      const fieldKeys = Object.keys(fields).sort();
      expect(fieldKeys).toEqual(["caption", "image"].sort());
      expect(fields.image?.type).toBe("custom");
    });

    it("renders an empty-state placeholder when image is null", () => {
      const html = render("Image", { image: null, caption: "" });
      expect(html).toContain("No image picked yet");
      expect(html).not.toContain("<picture");
    });

    it("renders the public <Image> (a <picture>) when image is set", () => {
      const html = render("Image", { image: sampleImage, caption: "" });
      expect(html).toContain("<picture");
      // The public Image component emits avif + webp <source> tags pointing
      // at /images/<slug>/<id>/<width>.<ext>
      expect(html).toMatch(/srcSet="\/images\/uploads\/abc1234567890def\/[0-9]+\.webp/);
      expect(html).toContain('alt="stage shot"');
    });

    it("renders <figcaption> only when caption is non-empty", () => {
      const without = render("Image", { image: sampleImage, caption: "" });
      const withCaption = render("Image", { image: sampleImage, caption: "Live at the venue" });
      expect(without).not.toContain("<figcaption");
      expect(withCaption).toContain("<figcaption");
      expect(withCaption).toContain("Live at the venue");
    });

    it("is layout-transparent (no max-width or horizontal centering on the figure)", () => {
      // The enclosing Section owns layout. A future refactor that
      // accidentally restores a self-imposed container would re-double
      // padding when the artist nests the block inside a Section.
      const html = render("Image", { image: sampleImage, caption: "" });
      expect(html).not.toMatch(/max-width/);
      expect(html).not.toMatch(/margin:\s*[^;]*auto/);
    });
  });

  describe("Spacer", () => {
    it("select options match SPACER_SIZES", () => {
      const field = puckConfig.components.Spacer.fields?.size;
      expect(field?.type).toBe("select");
      if (field?.type === "select") {
        expect(field.options.map((o) => o.value)).toEqual([...SPACER_SIZES]);
      }
    });

    it("renders a presentation div whose height is a CSS-token reference, distinct per size", () => {
      const refs = SPACER_SIZES.map((size) => {
        const html = render("Spacer", { size });
        const match = html.match(/height:\s*var\(--space-([0-9]+)\)/);
        expect(match, `Spacer size=${size} should resolve to a var(--space-N) token`).not.toBeNull();
        return parseInt(match![1], 10);
      });
      // sm < md < lg < xl (token numeric scale increases monotonically)
      expect(refs).toEqual([...refs].sort((a, b) => a - b));
      // and they're all distinct
      expect(new Set(refs).size).toBe(refs.length);
    });

    it("is aria-hidden (presentation only)", () => {
      const html = render("Spacer", { size: "md" });
      expect(html).toContain("aria-hidden");
    });
  });

  describe("Columns", () => {
    it("select options match COLUMN_LAYOUTS", () => {
      const field = puckConfig.components.Columns.fields?.layout;
      expect(field?.type).toBe("select");
      if (field?.type === "select") {
        expect(field.options.map((o) => o.value)).toEqual([...COLUMN_LAYOUTS]);
      }
    });

    it("declares col1/col2/col3 as slots (each column accepts any block)", () => {
      const fields = (puckConfig.components.Columns.fields ?? {}) as Record<
        string,
        { type?: string }
      >;
      expect(fields.col1?.type).toBe("slot");
      expect(fields.col2?.type).toBe("slot");
      expect(fields.col3?.type).toBe("slot");
    });

    it("renders only the slots required by the chosen layout (2 for 1-1, 3 for 1-1-1)", () => {
      // Stub each slot with a distinguishable marker so we can assert
      // which columns the renderer actually invoked.
      const stub = (label: string) =>
        (() => label as unknown as React.ReactElement) as unknown;
      const html2 = render("Columns", {
        layout: "1-1",
        col1: stub("COL_A"),
        col2: stub("COL_B"),
        col3: stub("COL_C_HIDDEN"),
      });
      expect(html2).toContain("COL_A");
      expect(html2).toContain("COL_B");
      expect(html2).not.toContain("COL_C_HIDDEN");

      const html3 = render("Columns", {
        layout: "1-1-1",
        col1: stub("COL_A"),
        col2: stub("COL_B"),
        col3: stub("COL_C"),
      });
      expect(html3).toContain("COL_A");
      expect(html3).toContain("COL_B");
      expect(html3).toContain("COL_C");
    });

    it("uses CSS Grid with token-only spacing", () => {
      const stub = () => null as unknown as React.ReactElement;
      const html = render("Columns", {
        layout: "1-2",
        col1: stub,
        col2: stub,
        col3: stub,
      });
      expect(html).toMatch(/display:\s*grid/);
      expect(html).toMatch(/grid-template-columns:\s*1fr 2fr/);
      expect(html).toMatch(/gap:\s*var\(--space-/);
    });
  });

  describe("Quote", () => {
    it("renders blockquote text wrapped in curly quotes", () => {
      const html = render("Quote", { text: "Great show!", attribution: "Sarah" });
      expect(html).toContain("Great show!");
      expect(html).toContain("Sarah");
      expect(html).toContain("<blockquote");
      expect(html).toContain("<figcaption");
    });

    it("omits the figcaption when attribution is blank", () => {
      const html = render("Quote", { text: "Wow.", attribution: "" });
      expect(html).not.toContain("<figcaption");
    });

    it("is layout-transparent (no max-width or horizontal centering on the figure)", () => {
      // Same contract as Image/Embed/RichText — the enclosing Section
      // owns horizontal layout. Quote's left padding stays (intrinsic,
      // offsets text from the borderLeft) but max-width and margin:auto
      // must not return.
      const html = render("Quote", { text: "Great show!", attribution: "Sarah" });
      expect(html).not.toMatch(/max-width/);
      expect(html).not.toMatch(/margin:\s*[^;]*auto/);
    });
  });

  describe("FullscreenSection", () => {
    it("renders headline + body even without an image", () => {
      const html = render("FullscreenSection", {
        headline: "Welcome",
        body: "Now playing.",
        image: null,
        textAlign: "center",
        overlayOpacity: 0.3,
      });
      expect(html).toContain("Welcome");
      expect(html).toContain("Now playing.");
      // No image means no <picture> overlay.
      expect(html).not.toContain("<picture");
    });

    it("clamps overlayOpacity into [0,1]", () => {
      const sampleImage = {
        id: "abc1234567890def",
        alt: "stage shot",
        width: 1200,
        height: 800,
        placeholderDataUri: "data:image/webp;base64,AAAA",
        contentSlug: "uploads",
        originalExt: "jpg" as const,
      };
      const high = render("FullscreenSection", {
        headline: "x",
        body: "",
        image: sampleImage,
        textAlign: "center",
        overlayOpacity: 5, // clamped to 1
      });
      // The overlay opacity ends up in inline style; "1" should appear and "5" shouldn't sneak through.
      expect(high).toMatch(/opacity:\s*1[^0-9]/);
    });
  });

  describe("Embed", () => {
    it("inlines raw HTML so artist-pasted iframes render", () => {
      const html = render("Embed", { html: '<iframe src="x" data-hook></iframe>' });
      expect(html).toContain('<iframe src="x" data-hook>');
    });

    it("is layout-transparent (no max-width or horizontal centering on the wrapper)", () => {
      // Same contract as Image/Quote/RichText — the enclosing Section
      // owns horizontal layout. Without this, an Embed dropped inside
      // a Section gets the double-padding regression the slot conversion
      // exposed for the other blocks.
      const html = render("Embed", { html: "<iframe></iframe>" });
      expect(html).not.toMatch(/max-width/);
      expect(html).not.toMatch(/margin:\s*[^;]*auto/);
    });
  });

  describe("EmbedResponsive", () => {
    const BANDCAMP = '<iframe src="https://bandcamp.com/EmbeddedPlayer/x/size=large" width="350" height="470"></iframe>';
    const SPOTIFY = '<iframe src="https://open.spotify.com/embed/track/x" width="100%" height="352"></iframe>';

    it("wraps the iframe with `aspect-ratio` when an explicit ratio is picked", () => {
      const html = render("EmbedResponsive", {
        html: BANDCAMP,
        aspectRatio: "16/9",
      });
      expect(html).toContain('class="stagecraft-embed-responsive"');
      expect(html).toMatch(/aspect-ratio:\s*16\s*\/\s*9/);
      expect(html).toContain('<iframe src="https://bandcamp.com');
    });

    it("derives the ratio from the iframe's intrinsic dimensions in auto mode", () => {
      // Bandcamp ships `width="350" height="470"` — auto mode reads
      // those and emits `aspect-ratio: 350 / 470`. The wrapper then
      // scales while preserving the ratio.
      const html = render("EmbedResponsive", {
        html: BANDCAMP,
        aspectRatio: "auto",
      });
      expect(html).toMatch(/aspect-ratio:\s*350\s*\/\s*470/);
    });

    it("falls back to passthrough when auto can't derive a ratio (no wrapper)", () => {
      // Spotify's `width="100%"` has no pixel value — wrapper would
      // collapse to zero height. Passthrough renders the iframe at
      // its declared size instead.
      const html = render("EmbedResponsive", {
        html: SPOTIFY,
        aspectRatio: "auto",
      });
      expect(html).not.toContain("stagecraft-embed-responsive");
      expect(html).not.toMatch(/aspect-ratio:/);
      expect(html).toContain('<iframe src="https://open.spotify.com');
    });

    it("explicit ratio wins over auto-derivable intrinsic dimensions", () => {
      // Artist explicitly picked 16/9 even though the iframe ships
      // 350x470 — honour the explicit choice.
      const html = render("EmbedResponsive", {
        html: BANDCAMP,
        aspectRatio: "1/1",
      });
      expect(html).toMatch(/aspect-ratio:\s*1\s*\/\s*1/);
      expect(html).not.toMatch(/aspect-ratio:\s*350/);
    });

    it("explicit ratio still wraps even when intrinsic dimensions are absent", () => {
      // Spotify-style snippet with explicit `aspectRatio: 16/9` —
      // wrap normally; the CSS rule will stretch the iframe to fill.
      const html = render("EmbedResponsive", {
        html: SPOTIFY,
        aspectRatio: "16/9",
      });
      expect(html).toContain("stagecraft-embed-responsive");
      expect(html).toMatch(/aspect-ratio:\s*16\s*\/\s*9/);
    });

    it("strips iframe width / height attributes when wrapped (so the wrapper sizes win)", () => {
      // Without stripping, the iframe's `width="350"` would still
      // be present in the emitted HTML — for inline-style cases the
      // class-based wrapper CSS can lose specificity, leaving the
      // iframe at its declared size inside a correctly-sized
      // wrapper.
      const html = render("EmbedResponsive", {
        html: BANDCAMP,
        aspectRatio: "auto",
      });
      // Wrapper got the aspect ratio.
      expect(html).toMatch(/aspect-ratio:\s*350\s*\/\s*470/);
      // But the inner iframe no longer carries the dimension attrs.
      const iframeMatch = html.match(/<iframe[^>]*>/);
      expect(iframeMatch).toBeTruthy();
      expect(iframeMatch?.[0]).not.toMatch(/\bwidth=/);
      expect(iframeMatch?.[0]).not.toMatch(/\bheight=/);
    });

    it("keeps iframe attributes intact in passthrough mode (no wrapper to defer to)", () => {
      // Spotify falls through to passthrough; the iframe needs its
      // own sizing in that case — don't strip.
      const html = render("EmbedResponsive", {
        html: SPOTIFY,
        aspectRatio: "auto",
      });
      const iframeMatch = html.match(/<iframe[^>]*>/);
      expect(iframeMatch?.[0]).toMatch(/width="100%"/);
    });

    it("select options match EMBED_ASPECT_RATIOS", () => {
      const field = puckConfig.components.EmbedResponsive.fields?.aspectRatio;
      expect(field?.type).toBe("select");
      if (field?.type === "select") {
        expect(field.options.map((o) => o.value)).toEqual(["auto", "16/9", "4/3", "1/1"]);
      }
    });
  });

  describe("CenteredBlock", () => {
    function renderCentered(maxWidth: "narrow" | "regular") {
      const slot = () => "<<children-rendered>>" as unknown as React.ReactElement;
      return render("CenteredBlock", { maxWidth, children: slot });
    }

    it("uses --max-width-narrow for `narrow` preset", () => {
      const html = renderCentered("narrow");
      expect(html).toMatch(/max-width:\s*var\(--max-width-narrow\)/);
      expect(html).toContain("&lt;&lt;children-rendered&gt;&gt;");
    });

    it("uses --max-width-content for `regular` preset", () => {
      const html = renderCentered("regular");
      expect(html).toMatch(/max-width:\s*var\(--max-width-content\)/);
    });

    it("centers horizontally and applies `text-align: center`", () => {
      const html = renderCentered("narrow");
      // `margin-inline: auto` centers in any writing-mode (legacy
      // template used `margin-inline` for the same reason).
      expect(html).toMatch(/margin-inline:\s*auto/);
      expect(html).toMatch(/text-align:\s*center/);
    });

    it("declares `children` as a slot so any block can nest", () => {
      const fields = (puckConfig.components.CenteredBlock.fields ?? {}) as Record<
        string,
        { type?: string }
      >;
      expect(fields.children?.type).toBe("slot");
      // No textarea body — the slot replaces any single-string
      // content field, just like Section.
      expect(fields.body).toBeUndefined();
    });

    it("select options match CENTERED_BLOCK_MAX_WIDTHS", () => {
      const field = puckConfig.components.CenteredBlock.fields?.maxWidth;
      expect(field?.type).toBe("select");
      if (field?.type === "select") {
        expect(field.options.map((o) => o.value)).toEqual(["narrow", "regular"]);
      }
    });
  });

  describe("Card", () => {
    const IMAGE_FIXTURE = {
      id: "abc1234567890def",
      alt: "Album cover",
      width: 1600,
      height: 1600,
      placeholderDataUri: "data:image/webp;base64,AAAA",
      contentSlug: "home",
      originalExt: "jpg" as const,
    };

    /**
     * Default Card props — fills in v2's new fields with neutral
     * values so tests can override only what they care about.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function cardProps(overrides: Record<string, any> = {}) {
      return {
        image: null,
        eyebrow: "",
        title: "Card title",
        description: "",
        href: "",
        isExternal: false,
        orientation: "vertical" as const,
        variant: "filled" as const,
        size: "md" as const,
        fileUrl: "",
        sizeLabel: "",
        isHoverable: false,
        ...overrides,
      };
    }

    it("renders title + description", () => {
      const html = render(
        "Card",
        cardProps({ image: IMAGE_FIXTURE, title: "Album Title", description: "A summary" }),
      );
      expect(html).toContain("Album Title");
      expect(html).toContain("A summary");
      expect(html).toContain("<picture>");
    });

    it("renders the title as a styled non-heading (no <h3>)", () => {
      // A grid of 6 cards would otherwise emit 6 <h3>s into the
      // accessibility outline; screen-reader users navigating by
      // heading would have to skip past every one. Visual emphasis
      // still reads via the styled <div>. Same trade the legacy
      // template made.
      const html = render("Card", cardProps({ title: "Title here" }));
      expect(html).not.toMatch(/<h[1-6]/);
      expect(html).toContain("Title here");
    });

    it("wraps the whole card in an <a> when href is set", () => {
      const html = render("Card", cardProps({ title: "Read more", href: "/posts/x" }));
      // Whole card is the link; no inner-only anchor.
      expect(html).toMatch(/^<a[^>]+href="\/posts\/x"/);
      // Link styling: explicit `text-decoration: none` so the title
      // doesn't underline (the title carries visual emphasis on its
      // own), and `color: inherit` so the heading colour wins over
      // the browser default link blue.
      expect(html).toMatch(/text-decoration:\s*none/);
      expect(html).toMatch(/color:\s*inherit/);
      // Class hook for the :hover affordance (lift + border + shadow)
      // — inline styles can't carry pseudoclasses so the styling lives
      // in globals.css, gated by this class.
      expect(html).toContain('class="stagecraft-card-link"');
    });

    it("opens external links in a new tab", () => {
      const html = render(
        "Card",
        cardProps({ title: "Buy", href: "https://store.example.com/x", isExternal: true }),
      );
      expect(html).toContain('target="_blank"');
      expect(html).toContain('rel="noopener noreferrer"');
    });

    it("renders an <article> (no link) when href is empty", () => {
      const html = render("Card", cardProps({ title: "Bio" }));
      expect(html).toMatch(/^<article/);
      expect(html).not.toMatch(/<a\s/);
    });

    it("uses a 2-column grid for horizontal orientation", () => {
      const html = render(
        "Card",
        cardProps({
          image: IMAGE_FIXTURE,
          title: "x",
          description: "y",
          orientation: "horizontal",
        }),
      );
      // CSS grid layout switches at the container level.
      expect(html).toMatch(/grid-template-columns:\s*1fr\s+2fr/);
      // And the media cell carries a fixed aspect so rows line up.
      expect(html).toMatch(/aspect-ratio:\s*4\s*\/\s*3/);
    });

    it("vertical orientation is column-flex with no aspect-ratio on media", () => {
      const html = render(
        "Card",
        cardProps({ image: IMAGE_FIXTURE, title: "x", description: "y" }),
      );
      expect(html).toMatch(/flex-direction:\s*column/);
      expect(html).not.toMatch(/aspect-ratio:\s*4/);
    });

    it("omits the media wrapper entirely when no image is picked", () => {
      const html = render("Card", cardProps({ title: "x" }));
      expect(html).not.toContain("stagecraft-card-media");
      expect(html).not.toContain("<picture>");
    });

    it("omits the description <p> when empty", () => {
      const html = render("Card", cardProps({ title: "x" }));
      expect(html).not.toMatch(/<p[^>]*>\s*<\/p>/);
    });

    it("select options match CARD_ORIENTATIONS", () => {
      const field = puckConfig.components.Card.fields?.orientation;
      expect(field?.type).toBe("select");
      if (field?.type === "select") {
        expect(field.options.map((o) => o.value)).toEqual(["vertical", "horizontal"]);
      }
    });

    // ---------------------------------------------------------------------
    // v2 additions: eyebrow, variant, download
    // ---------------------------------------------------------------------

    it("renders the eyebrow (small uppercase label above title) when set", () => {
      const html = render("Card", cardProps({ eyebrow: "NEW RELEASE", title: "Album" }));
      expect(html).toContain("NEW RELEASE");
      expect(html).toMatch(/text-transform:\s*uppercase/);
    });

    it("omits the eyebrow entirely when empty", () => {
      const html = render("Card", cardProps({ title: "Album" }));
      // No uppercase-styled element rendered when eyebrow is blank.
      expect(html).not.toMatch(/text-transform:\s*uppercase/);
    });

    it("variant=filled (default) uses the surface background", () => {
      const html = render("Card", cardProps({ title: "x", variant: "filled" }));
      expect(html).toMatch(/background:\s*var\(--color-surface\)/);
    });

    it("variant=outlined drops the surface background (transparent)", () => {
      // On busy / image-heavy page backgrounds, the solid surface
      // fights the imagery; the outlined variant keeps the border +
      // radius but drops the fill so the page background shows
      // through.
      const html = render("Card", cardProps({ title: "x", variant: "outlined" }));
      expect(html).toMatch(/background:\s*transparent/);
    });

    it("select options match CARD_VARIANTS", () => {
      const field = puckConfig.components.Card.fields?.variant;
      expect(field?.type).toBe("select");
      if (field?.type === "select") {
        expect(field.options.map((o) => o.value)).toEqual(["filled", "outlined", "minimal"]);
      }
    });

    // ---------------------------------------------------------------------
    // v3 additions: minimal variant + size axis
    // ---------------------------------------------------------------------

    it("variant=minimal drops the border + background + padding (flush list-item)", () => {
      const html = render("Card", cardProps({ title: "x", variant: "minimal" }));
      // No border declaration and no surface fill — the card reads as
      // bare content. (filled/outlined both carry a 1px border.)
      expect(html).not.toMatch(/border:\s*1px solid/);
      expect(html).toMatch(/background:\s*transparent/);
      // Padding collapses to 0 so adjacent prose sits flush.
      expect(html).toMatch(/padding:\s*0(?:px|;|")/);
    });

    it("variant=minimal still applies the size gap (media ↔ body breathing room)", () => {
      // Minimal drops chrome but is not gap-less — md gap is --space-3.
      const html = render("Card", cardProps({ title: "x", variant: "minimal", size: "md" }));
      expect(html).toMatch(/gap:\s*var\(--space-3\)/);
    });

    it("size axis scales the chromed padding (sm < md < lg)", () => {
      const sm = render("Card", cardProps({ title: "x", size: "sm" }));
      const md = render("Card", cardProps({ title: "x", size: "md" }));
      const lg = render("Card", cardProps({ title: "x", size: "lg" }));
      expect(sm).toMatch(/padding:\s*var\(--space-3\)/);
      expect(md).toMatch(/padding:\s*var\(--space-4\)/);
      expect(lg).toMatch(/padding:\s*var\(--space-5\)/);
    });

    it("size axis scales the title type (sm=base, md=lg, lg=xl)", () => {
      const sm = render("Card", cardProps({ title: "Title", size: "sm" }));
      const md = render("Card", cardProps({ title: "Title", size: "md" }));
      const lg = render("Card", cardProps({ title: "Title", size: "lg" }));
      expect(sm).toMatch(/font-size:\s*var\(--font-size-base\)/);
      expect(md).toMatch(/font-size:\s*var\(--font-size-lg\)/);
      expect(lg).toMatch(/font-size:\s*var\(--font-size-xl\)/);
    });

    it("coerces a MISSING size key to md (old on-disk cards, no defaultProps backfill)", () => {
      // Card JSON saved before the size axis landed has no `size`
      // key. Puck's public <Render> passes raw props through without
      // backfilling defaultProps, so `size` arrives undefined. Without
      // the normaliseCardSize guard, every size-driven token collapses
      // to `undefined` and the card loses padding + gap + title font.
      // Simulate the old shape by deleting the key entirely.
      const oldProps = cardProps({ title: "x" }) as Record<string, unknown>;
      delete oldProps.size;
      const html = render("Card", oldProps);
      // Falls back to md: padding --space-4, title font --font-size-lg.
      expect(html).toMatch(/padding:\s*var\(--space-4\)/);
      expect(html).toMatch(/font-size:\s*var\(--font-size-lg\)/);
      // And the gap is present (md gap is --space-3), not stripped.
      expect(html).toMatch(/gap:\s*var\(--space-3\)/);
    });

    it("coerces an UNKNOWN size value to md (defensive against bad data)", () => {
      const html = render("Card", cardProps({ title: "x", size: "gigantic" }));
      expect(html).toMatch(/padding:\s*var\(--space-4\)/);
    });

    it("size select options match CARD_SIZES", () => {
      const field = puckConfig.components.Card.fields?.size;
      expect(field?.type).toBe("select");
      if (field?.type === "select") {
        expect(field.options.map((o) => o.value)).toEqual(["sm", "md", "lg"]);
      }
    });

    it("minimal variant works as a link card too (chrome-free clickable tile)", () => {
      const html = render(
        "Card",
        cardProps({ title: "x", variant: "minimal", href: "/somewhere" }),
      );
      expect(html).toContain('href="/somewhere"');
      expect(html).not.toMatch(/border:\s*1px solid/);
    });

    it("renders a download anchor when fileUrl is set", () => {
      const html = render(
        "Card",
        cardProps({ title: "EPK", fileUrl: "/uploads/epk.pdf" }),
      );
      expect(html).toContain('href="/uploads/epk.pdf"');
      // The `download` attribute on the anchor triggers save-as in
      // same-origin browsers. React serialises it as `download=""`.
      expect(html).toMatch(/download(?:=""|\s)/);
      expect(html).toContain("Download");
    });

    it("omits the download anchor when fileUrl is empty", () => {
      const html = render("Card", cardProps({ title: "Bio" }));
      // No "Download" button rendered.
      expect(html).not.toContain(">Download<");
    });

    it("renders the sizeLabel beside the download button when both are set", () => {
      const html = render(
        "Card",
        cardProps({ title: "EPK", fileUrl: "/uploads/epk.pdf", sizeLabel: "2.3 MB" }),
      );
      expect(html).toContain("2.3 MB");
    });

    it("omits the sizeLabel when fileUrl is set but sizeLabel is empty", () => {
      const html = render(
        "Card",
        cardProps({ title: "EPK", fileUrl: "/uploads/epk.pdf" }),
      );
      // Download present but no size text node.
      expect(html).toContain('href="/uploads/epk.pdf"');
      expect(html).not.toMatch(/aria-label="File size:/);
    });

    it("omits the sizeLabel entirely when fileUrl is empty (no orphan label)", () => {
      const html = render(
        "Card",
        cardProps({ title: "Bio", sizeLabel: "2.3 MB" }),
      );
      // SizeLabel is only meaningful next to a download button —
      // without one, it would be a dangling chunk of meta text.
      expect(html).not.toContain("2.3 MB");
    });

    it("download anchor opens in a new tab + carries rel=noopener (cross-origin safety)", () => {
      const html = render(
        "Card",
        cardProps({ title: "EPK", fileUrl: "/uploads/epk.pdf" }),
      );
      // `target="_blank"` is the fallback for cross-origin downloads
      // where the `download` attribute is ignored — the file opens
      // in a new tab instead of replacing the artist's page.
      expect(html).toContain('target="_blank"');
      expect(html).toContain('rel="noopener noreferrer"');
    });

    it("suppresses the download anchor when href is also set (no nested <a>)", () => {
      // Whole-card links wrap the card body in `<a href>`. Nesting an
      // `<a download>` inside would be invalid HTML — the browser
      // closes the outer anchor when it encounters the inner one,
      // breaking layout and hydration. The artist's authoring
      // contract is "pick href OR fileUrl, not both." When both
      // are set, href wins.
      const html = render(
        "Card",
        cardProps({
          title: "Card with both",
          href: "/posts/x",
          fileUrl: "/uploads/file.pdf",
        }),
      );
      // Exactly one anchor in the output — the outer whole-card link.
      const anchorMatches = html.match(/<a\b/g) ?? [];
      expect(anchorMatches).toHaveLength(1);
      expect(html).toContain('href="/posts/x"');
      expect(html).not.toContain('href="/uploads/file.pdf"');
      expect(html).not.toContain(">Download<");
    });

    // ---------------------------------------------------------------------
    // isHoverable — opt-in hover affordance for the <article> variant
    // ---------------------------------------------------------------------

    it("non-link cards stay static by default (no hover class)", () => {
      // A grid of 6+ static cards with no isHoverable opt-in
      // shouldn't all animate on mouseover — that's busy. The
      // resting state is the conservative default.
      const html = render("Card", cardProps({ title: "Bio" }));
      expect(html).toMatch(/^<article/);
      expect(html).not.toContain("stagecraft-card-hoverable");
      expect(html).not.toContain("stagecraft-card-link");
    });

    it("non-link cards opt into hover via isHoverable=true (class hook)", () => {
      // The class wires the same lift-on-hover affordance link-cards
      // get, via the shared globals.css selector. Visual-only — no
      // link semantics introduced; the element remains <article>.
      const html = render(
        "Card",
        cardProps({ title: "Bio", isHoverable: true }),
      );
      expect(html).toMatch(/^<article/);
      expect(html).toContain('class="stagecraft-card-hoverable"');
    });

    it("link cards ignore isHoverable (always get .stagecraft-card-link, never the article class)", () => {
      // The hover affordance is part of the link semantics — there's
      // no static / non-hover link variant. Setting isHoverable on a
      // link card shouldn't add the article class (which would
      // duplicate the styling).
      const html = render(
        "Card",
        cardProps({
          title: "Read more",
          href: "/posts/x",
          isHoverable: true,
        }),
      );
      expect(html).toContain('class="stagecraft-card-link"');
      expect(html).not.toContain("stagecraft-card-hoverable");
    });

    it("Puck field is a radio (off / on)", () => {
      const field = puckConfig.components.Card.fields?.isHoverable;
      expect(field?.type).toBe("radio");
      if (field?.type === "radio") {
        expect(field.options.map((o) => o.value)).toEqual([false, true]);
      }
    });

    // -------------------------------------------------------------------
    // v3.1: icon-mode media for non-image files. When a Card has no
    // image but a fileUrl, the media slot shows a file-type tile
    // (press-kit / download-list parity).
    // -------------------------------------------------------------------

    it("renders a file tile in the media slot when fileUrl is set and there's no image", () => {
      const html = render(
        "Card",
        cardProps({ title: "EPK", image: null, fileUrl: "/uploads/press-kit.pdf" }),
      );
      expect(html).toContain('data-testid="card-file-tile"');
      expect(html).toMatch(/data-media-kind="pdf"/);
      // The filename is surfaced as the tile caption.
      expect(html).toContain("press-kit.pdf");
    });

    it("infers the tile kind from the fileUrl extension (audio / video / file)", () => {
      expect(
        render("Card", cardProps({ title: "x", image: null, fileUrl: "/a/track.mp3" })),
      ).toMatch(/data-media-kind="audio"/);
      expect(
        render("Card", cardProps({ title: "x", image: null, fileUrl: "/a/promo.mp4" })),
      ).toMatch(/data-media-kind="video"/);
      expect(
        render("Card", cardProps({ title: "x", image: null, fileUrl: "/a/stems.zip" })),
      ).toMatch(/data-media-kind="file"/);
    });

    it("prefers the image over the file tile when both are present", () => {
      const html = render(
        "Card",
        cardProps({
          title: "x",
          image: IMAGE_FIXTURE,
          fileUrl: "/uploads/press-kit.pdf",
        }),
      );
      // Image wins the media slot; no file tile.
      expect(html).not.toContain('data-testid="card-file-tile"');
      // Download button still renders in the body (fileUrl + no href).
      expect(html).toContain("Download");
    });

    it("omits the file tile when neither image nor fileUrl is set", () => {
      const html = render("Card", cardProps({ title: "Just text" }));
      expect(html).not.toContain('data-testid="card-file-tile"');
    });

    it("suppresses the file tile when the card is a link (file would be unreachable)", () => {
      // When href is set, the card navigates on click and the download
      // button is suppressed (no nested anchors). A file tile captioned
      // with the filename would advertise a download the card can't
      // deliver — so the tile is gated on `!href`, same as the
      // download button. The link card just has no media slot here.
      const html = render(
        "Card",
        cardProps({
          title: "EPK",
          image: null,
          fileUrl: "/uploads/epk.pdf",
          href: "/press",
        }),
      );
      expect(html).not.toContain('data-testid="card-file-tile"');
      // Exactly one anchor — the card link. No tile, no download anchor.
      expect((html.match(/<a /g) ?? [])).toHaveLength(1);
      expect(html).toContain('href="/press"');
    });

    it("renders the file tile + download together for a non-link card (coherent pair)", () => {
      // The honest case: no href, so the tile previews the file AND
      // the download button delivers it.
      const html = render(
        "Card",
        cardProps({ title: "EPK", image: null, fileUrl: "/uploads/epk.pdf" }),
      );
      expect(html).toContain('data-testid="card-file-tile"');
      expect(html).toContain("Download");
    });
  });

  describe("root pageBackground", () => {
    it("declares pageBackground as a custom root field with a null default", () => {
      // The on-disk shape (`pageRootPropsSchema`) carries `pageBackground:
      // ImageMetadata | null`; the Puck root field surfaces it through
      // the same ImagePickerField the Image block uses.
      const field = puckConfig.root?.fields?.pageBackground;
      expect(field?.type).toBe("custom");
      expect(puckConfig.root?.defaultProps?.pageBackground).toBeNull();
    });

    it("declares pageBackgroundOverlay as a custom field with a null default (inherit)", () => {
      // Custom (not number) so the editor can express null=inherit vs
      // 0..1=explicit override unambiguously — see PageOverlayField.
      const field = puckConfig.root?.fields?.pageBackgroundOverlay;
      expect(field?.type).toBe("custom");
      // Default null = inherit the site-wide overlay.
      expect(puckConfig.root?.defaultProps?.pageBackgroundOverlay).toBeNull();
    });
  });

  describe("NewsletterSignup — optional name field", () => {
    it("exposes hasNameField + nameLabel as inspector fields", () => {
      const fields = (puckConfig.components.NewsletterSignup.fields ?? {}) as Record<
        string,
        { type?: string }
      >;
      expect(fields.hasNameField?.type).toBe("radio");
      expect(fields.nameLabel?.type).toBe("text");
    });

    it("defaults hasNameField to false (email-only) and nameLabel to 'First name'", () => {
      const defaults = puckConfig.components.NewsletterSignup.defaultProps as Record<
        string,
        unknown
      >;
      expect(defaults.hasNameField).toBe(false);
      expect(defaults.nameLabel).toBe("First name");
    });
  });

  describe("NewsletterSignup — additional fields array", () => {
    it("exposes additionalFields as an array field with label / name / type sub-fields", () => {
      const fields = (puckConfig.components.NewsletterSignup.fields ?? {}) as Record<
        string,
        { type?: string; arrayFields?: Record<string, { type?: string }> }
      >;
      const af = fields.additionalFields;
      expect(af?.type).toBe("array");
      expect(af?.arrayFields?.label?.type).toBe("text");
      expect(af?.arrayFields?.name?.type).toBe("text");
      expect(af?.arrayFields?.type?.type).toBe("select");
    });

    it("the type sub-field options match NEWSLETTER_FIELD_TYPES", () => {
      const fields = (puckConfig.components.NewsletterSignup.fields ?? {}) as Record<
        string,
        {
          arrayFields?: Record<
            string,
            { type?: string; options?: Array<{ value: string }> }
          >;
        }
      >;
      const typeField = fields.additionalFields?.arrayFields?.type;
      expect(typeField?.options?.map((o) => o.value)).toEqual([
        "text",
        "email",
        "tel",
        "url",
      ]);
    });

    it("defaults additionalFields to an empty array (no extra fields out of the box)", () => {
      const defaults = puckConfig.components.NewsletterSignup.defaultProps as Record<
        string,
        unknown
      >;
      expect(defaults.additionalFields).toEqual([]);
    });

    it("renders configured additional fields into the public form markup", () => {
      // End-to-end through the Puck render fn → component: a phone
      // field should appear with its raw provider name + tel type.
      const html = render(
        "NewsletterSignup",
        {
          service: "mailchimp" as const,
          actionUrl: "https://example.us1.list-manage.com/subscribe/post?u=a&id=b",
          title: "",
          emailLabel: "Email",
          submitLabel: "Subscribe",
          successMessage: "ok",
          hasNameField: false,
          nameLabel: "First name",
          additionalFields: [{ label: "Phone", name: "PHONE", type: "tel" as const }],
        },
      );
      expect(html).toMatch(/name="PHONE"/);
      expect(html).toMatch(/type="tel"/);
    });

    it("tolerates missing additionalFields on old content (renders without crashing)", () => {
      // Card lesson: Puck's public <Render> doesn't backfill
      // defaultProps. A NewsletterSignup saved before this field
      // landed has no `additionalFields` key; the component's default
      // param coerces undefined → [] so the form still renders.
      const props = {
        service: "generic" as const,
        actionUrl: "https://artist.example/subscribe",
        title: "",
        emailLabel: "Email",
        submitLabel: "Subscribe",
        successMessage: "ok",
        hasNameField: false,
        nameLabel: "First name",
        // additionalFields intentionally omitted
      } as Record<string, unknown>;
      const html = render("NewsletterSignup", props);
      expect(html).toMatch(/<form/);
      expect(html).toMatch(/name="email"/);
    });

    // resolveFields surfaces a reserved-name collision in the array
    // field's label (Puck arrays have no description slot). The
    // renderer silently drops the colliding row, so without this the
    // artist would just see their field vanish.
    function resolveNewsletterFields(props: Record<string, unknown>) {
      const config = puckConfig.components.NewsletterSignup as unknown as {
        resolveFields: (
          data: { props: Record<string, unknown> },
          params: { fields: Record<string, { label?: string }> },
        ) => Record<string, { label?: string }>;
        fields: Record<string, { label?: string }>;
      };
      return config.resolveFields({ props }, { fields: config.fields });
    }

    it("keeps the plain additionalFields label when no field name collides", () => {
      const resolved = resolveNewsletterFields({
        service: "mailchimp",
        actionUrl: "",
        hasNameField: false,
        additionalFields: [{ label: "Phone", name: "PHONE", type: "tel" }],
      });
      expect(resolved.additionalFields?.label).toBe("Additional fields (advanced)");
    });

    it("appends a reserved-name warning to the label when a field collides", () => {
      // "EMAIL" is Mailchimp's email field name — a collision.
      const resolved = resolveNewsletterFields({
        service: "mailchimp",
        actionUrl: "",
        hasNameField: false,
        additionalFields: [{ label: "Email again", name: "EMAIL", type: "email" }],
      });
      expect(resolved.additionalFields?.label).toContain("Additional fields (advanced)");
      expect(resolved.additionalFields?.label).toContain("EMAIL");
      expect(resolved.additionalFields?.label).toMatch(/reserved/);
    });

    it("still warns when `service` is absent from props (defaults to mailchimp, matching render)", () => {
      // Puck doesn't merge defaultProps into resolveFields' props, so
      // an old/hand-edited block can arrive without `service`. The
      // render path defaults it to mailchimp and drops an "EMAIL"
      // field; the warning must default the same way so it doesn't
      // under-fire exactly when the drop still happens.
      const resolved = resolveNewsletterFields({
        // service intentionally omitted
        actionUrl: "",
        hasNameField: false,
        additionalFields: [{ label: "Email again", name: "EMAIL", type: "email" }],
      });
      expect(resolved.additionalFields?.label).toContain("EMAIL");
      expect(resolved.additionalFields?.label).toMatch(/reserved/);
    });

    it("preserves the array sub-field config when resolveFields rebuilds the label", () => {
      // Spreading the static field must keep arrayFields intact, not
      // replace the array with a bare labelled field.
      const resolved = resolveNewsletterFields({
        service: "mailchimp",
        actionUrl: "",
        hasNameField: false,
        additionalFields: [{ label: "x", name: "EMAIL", type: "text" }],
      }) as Record<string, { type?: string; arrayFields?: Record<string, unknown> }>;
      expect(resolved.additionalFields?.type).toBe("array");
      expect(resolved.additionalFields?.arrayFields).toBeTruthy();
    });
  });

  describe("newsletterUrlDescription (inspector helper text)", () => {
    it("Mailchimp + empty URL → paste-hint pointing at the embed code", () => {
      const hint = newsletterUrlDescription("mailchimp", "");
      expect(hint.kind).toBe("info");
      expect(hint.text).toMatch(/audience embed code/i);
    });

    it("Mailchimp + valid audience URL → ok hint confirming the honeypot will fire", () => {
      const hint = newsletterUrlDescription(
        "mailchimp",
        "https://example.us21.list-manage.com/subscribe/post?u=abc123&id=def456",
      );
      expect(hint.kind).toBe("ok");
      expect(hint.text).toMatch(/looks like a mailchimp/i);
      expect(hint.text).toMatch(/honeypot/i);
    });

    it("Mailchimp + malformed URL → warn hint about reduced spam protection", () => {
      const hint = newsletterUrlDescription(
        "mailchimp",
        "https://example.com/oops",
      );
      expect(hint.kind).toBe("warn");
      expect(hint.text).toMatch(/doesn't look like/i);
      // The hint must spell out the expected query params so the
      // artist can correct the paste without leaving the inspector.
      expect(hint.text).toContain("?u=USER_ID&id=LIST_ID");
      // Must clarify that the signup still works — we don't want
      // artists thinking their form is broken.
      expect(hint.text).toMatch(/still submits/i);
    });

    it("non-Mailchimp services get a generic paste hint regardless of URL state", () => {
      expect(newsletterUrlDescription("buttondown", "").text).toMatch(
        /POST URL from your provider/i,
      );
      expect(
        newsletterUrlDescription("convertkit", "https://example.com/subscribe").text,
      ).toMatch(/POST URL from your provider/i);
    });

    it("`resolveFields` rebuilds actionUrl as a custom field carrying the current hint", () => {
      // Spot-check the production hook: call resolveFields with a
      // small data shape and confirm the returned actionUrl is a
      // custom field — render is the only public surface of the
      // hint, so we render it and assert the warning text appears.
      const config = puckConfig.components.NewsletterSignup as unknown as {
        resolveFields: (
          data: { props: { service: string; actionUrl: string } },
          params: { fields: Record<string, { type?: string }> },
        ) => Record<string, { type?: string; render?: (p: { value: string; onChange: (n: string) => void }) => React.ReactElement }>;
        fields: Record<string, { type?: string }>;
      };
      const out = config.resolveFields(
        { props: { service: "mailchimp", actionUrl: "https://nope.example/" } },
        { fields: config.fields },
      );
      expect(out.actionUrl?.type).toBe("custom");
      // The render function should produce JSX that includes the
      // warning text — render it to a static string and grep.
      const html = renderToStaticMarkup(
        out.actionUrl!.render!({ value: "https://nope.example/", onChange: () => {} }),
      );
      // `renderToStaticMarkup` HTML-escapes the apostrophe in
      // "doesn't" to `&#x27;` — grep for a substring that doesn't
      // span the apostrophe.
      expect(html).toMatch(/look like a Mailchimp/i);
      expect(html).toContain("?u=USER_ID");
    });
  });

  describe("text alignment shared enum", () => {
    it("Heading exposes start/center/end via a select", () => {
      const field = puckConfig.components.Heading.fields?.textAlign;
      expect(field?.type).toBe("select");
      if (field?.type === "select") {
        expect(field.options.map((o) => o.value)).toEqual([...TEXT_ALIGNMENTS]);
      }
    });

    it("Heading inline-styles its alignment", () => {
      const html = render("Heading", { text: "Hi", level: "h1", textAlign: "center" });
      expect(html).toMatch(/text-align:\s*center/);
    });
  });

  describe("Button", () => {
    it("opens in a new tab when isExternal is true", () => {
      const internal = render("Button", { text: "x", href: "/y", variant: "primary", isExternal: false });
      const external = render("Button", { text: "x", href: "https://x", variant: "primary", isExternal: true });
      expect(internal).not.toContain("_blank");
      expect(external).toContain('target="_blank"');
      expect(external).toContain('rel="noopener noreferrer"');
    });
  });

  describe("Divider", () => {
    it("renders an <hr> with the default-margin token (no horizontal inset) when inset=false", () => {
      const html = render("Divider", { inset: false });
      expect(html).toContain("<hr");
      expect(html).toMatch(/margin:\s*var\(--space-[0-9]+\) 0/);
    });

    it("renders the inset-margin token pair (vertical + horizontal) when inset=true", () => {
      const html = render("Divider", { inset: true });
      expect(html).toMatch(/margin:\s*var\(--space-[0-9]+\) var\(--space-[0-9]+\)/);
    });
  });

  describe("ContactForm", () => {
    it("exposes no artist-editable fields", () => {
      // The form is intentionally fixed — the only configurable bit is
      // the delivery address in site.json#contactEmail.
      const fields = puckConfig.components.ContactForm.fields ?? {};
      expect(Object.keys(fields)).toHaveLength(0);
    });

    it("renders a <form> with name / email / message inputs", () => {
      const html = render("ContactForm", {});
      expect(html).toContain("<form");
      expect(html).toContain('name="name"');
      expect(html).toContain('name="email"');
      expect(html).toContain('name="message"');
    });
  });
});
