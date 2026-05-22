import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import {
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
