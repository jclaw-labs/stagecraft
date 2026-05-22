import { describe, expect, it } from "vitest";

import { sanitiseSvg } from "./svg-sanitise";

function sanitise(svg: string): string {
  return sanitiseSvg(Buffer.from(svg, "utf-8")).toString("utf-8");
}

describe("sanitiseSvg — script injection", () => {
  it("strips <script> tags entirely", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><script>alert("xss")</script><circle r="1"/></svg>`;
    const out = sanitise(svg);
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toContain("alert");
    // Legitimate content survives.
    expect(out).toMatch(/<circle/);
  });

  it("strips embedded JS inside CDATA", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><script><![CDATA[window.x=1]]></script></svg>`;
    const out = sanitise(svg);
    expect(out).not.toContain("window");
    expect(out).not.toContain("CDATA");
  });
});

describe("sanitiseSvg — event handlers", () => {
  it.each([
    "onload",
    "onerror",
    "onclick",
    "onmouseover",
    "onfocus",
  ])("strips %s event handlers", (attr) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" ${attr}="alert(1)"><circle r="1"/></svg>`;
    const out = sanitise(svg);
    expect(out).not.toContain(attr);
    expect(out).not.toContain("alert");
  });

  it("strips event handlers on inner elements too", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><circle r="1" onclick="alert(1)"/></svg>`;
    const out = sanitise(svg);
    expect(out).not.toContain("onclick");
    expect(out).not.toContain("alert");
  });
});

describe("sanitiseSvg — javascript: URLs", () => {
  it("strips javascript: in href attributes", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><circle r="1"/></a></svg>`;
    const out = sanitise(svg);
    expect(out.toLowerCase()).not.toContain("javascript:");
  });

  it("strips javascript: in xlink:href attributes", () => {
    // SVG legacy linking attribute. DOMPurify's SVG profile handles
    // both `href` and `xlink:href`.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><a xlink:href="javascript:alert(1)"><circle r="1"/></a></svg>`;
    const out = sanitise(svg);
    expect(out.toLowerCase()).not.toContain("javascript:");
  });
});

describe("sanitiseSvg — foreignObject + dangerous embedded content", () => {
  it("strips <foreignObject> elements (HTML-in-SVG escape hatch)", () => {
    // `foreignObject` lets an SVG embed arbitrary HTML, including
    // `<iframe>` or `<script>` that wouldn't otherwise survive the
    // SVG profile. The cleanest defense is to strip the tag itself.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>x</div></foreignObject></svg>`;
    const out = sanitise(svg);
    expect(out).not.toMatch(/<foreignobject/i);
  });

  it("rejects <iframe> tucked inside foreignObject", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><iframe src="https://evil.example"/></foreignObject></svg>`;
    const out = sanitise(svg);
    expect(out).not.toMatch(/<iframe/i);
    expect(out).not.toContain("evil.example");
  });
});

describe("sanitiseSvg — legitimate content preserved", () => {
  it("keeps standard SVG primitives", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#abc"/><path d="M0 0 L100 100"/></svg>`;
    const out = sanitise(svg);
    expect(out).toMatch(/<circle/);
    expect(out).toMatch(/<path/);
    expect(out).toContain("#abc");
    expect(out).toMatch(/viewBox="0 0 100 100"/);
  });

  it("keeps SVG filter primitives (svgFilters profile)", () => {
    // Common in artist-produced SVGs (drop shadows, blurs).
    // `USE_PROFILES.svgFilters: true` retains them.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><defs><filter id="b"><feGaussianBlur stdDeviation="2"/></filter></defs><circle r="1" filter="url(#b)"/></svg>`;
    const out = sanitise(svg);
    expect(out).toMatch(/<feGaussianBlur/i);
    expect(out).toMatch(/<filter/);
  });

  it("keeps inline style attributes", () => {
    // SVG-bearing styling. Style attribute on its own is safe (no
    // js execution from CSS); DOMPurify SVG profile retains it.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><circle r="1" style="fill: red"/></svg>`;
    const out = sanitise(svg);
    expect(out).toMatch(/style=/);
    expect(out).toContain("red");
  });

  it("idempotent — sanitising an already-clean SVG produces the same content", () => {
    // Whitespace / quote normalisation aside, the second pass should
    // not strip more.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><circle r="1" fill="#abc"/></svg>`;
    const once = sanitise(svg);
    const twice = sanitise(once);
    expect(twice).toBe(once);
  });
});

describe("sanitiseSvg — buffer / encoding round-trip", () => {
  it("returns a Buffer, not a string", () => {
    const out = sanitiseSvg(Buffer.from("<svg/>", "utf-8"));
    expect(Buffer.isBuffer(out)).toBe(true);
  });

  it("preserves UTF-8 content for non-ASCII characters", () => {
    // SVG titles sometimes carry accented characters; the round-trip
    // through utf-8 string should not corrupt them.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><title>Café résumé — 日本</title></svg>`;
    const out = sanitise(svg);
    expect(out).toContain("Café");
    expect(out).toContain("résumé");
    expect(out).toContain("日本");
  });
});

describe("sanitiseSvg — defensive input guards", () => {
  it("throws on an empty buffer (likely-caller-bug signal)", () => {
    expect(() => sanitiseSvg(Buffer.alloc(0))).toThrow(/empty buffer/);
  });

  it("throws on whitespace-only buffer", () => {
    expect(() => sanitiseSvg(Buffer.from("   \n\t  ", "utf-8"))).toThrow(/empty buffer/);
  });

  it("throws when the buffer doesn't look like XML/SVG (e.g. binary mis-routed here)", () => {
    // Pipeline only calls this when originalExt === "svg"; this guard
    // surfaces a misconfigured caller (a PNG mis-routed through the
    // sanitiser) as a thrown error rather than silent ASCII-stripped
    // garbage out of DOMPurify.
    expect(() => sanitiseSvg(Buffer.from("not xml", "utf-8"))).toThrow(/XML\/SVG/);
    // PNG magic bytes — clearly binary, definitely not XML.
    expect(() =>
      sanitiseSvg(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    ).toThrow(/XML\/SVG/);
  });

  it("accepts SVG with leading whitespace / XML prologue", () => {
    // Many editors prepend an XML declaration; the input check
    // strips whitespace before the tag-open look.
    const svg = `\n  <?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>`;
    expect(() => sanitiseSvg(Buffer.from(svg, "utf-8"))).not.toThrow();
  });
});
