import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ReleasesList, ReleasesPlaceholder, type ResolvedRelease } from "./ReleasesView";

function release(over: Partial<ResolvedRelease> = {}): ResolvedRelease {
  return {
    title: "The Long Way Home",
    coverImage: null,
    releaseType: "album",
    releaseDate: "2026-03-01T00:00:00.000Z",
    description: "Ten songs cut live to tape.",
    ...over,
  };
}

describe("<ReleasesList>", () => {
  it("renders the title, a type · year meta line, and the description", () => {
    const html = renderToStaticMarkup(<ReleasesList items={[release()]} />);
    expect(html).toContain("The Long Way Home");
    expect(html).toContain("Album");
    expect(html).toContain("2026");
    expect(html).toContain("Ten songs cut live to tape.");
  });

  it("shows a themed gradient placeholder (no <img>) when there's no cover art", () => {
    const html = renderToStaticMarkup(<ReleasesList items={[release({ coverImage: null })]} />);
    expect(html).toContain("data-release-cover");
    expect(html).toContain("linear-gradient");
    expect(html).not.toContain("<img");
  });

  it("renders just the type when undated, and nothing when type+date are both absent", () => {
    const dated = renderToStaticMarkup(
      <ReleasesList items={[release({ releaseType: "single", releaseDate: "" })]} />,
    );
    expect(dated).toContain("Single");

    const bare = renderToStaticMarkup(
      <ReleasesList items={[release({ releaseType: "", releaseDate: "", description: "" })]} />,
    );
    expect(bare).toContain("The Long Way Home");
    expect(bare).not.toContain("Album");
  });

  it("shows an empty state when there are no releases", () => {
    const html = renderToStaticMarkup(<ReleasesList items={[]} />);
    expect(html).toMatch(/No releases yet/i);
  });
});

describe("<ReleasesPlaceholder>", () => {
  it("renders the editor stand-in copy", () => {
    expect(renderToStaticMarkup(<ReleasesPlaceholder />)).toMatch(/Your releases appear here/i);
  });
});
