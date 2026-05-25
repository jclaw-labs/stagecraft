import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { PostsList, PostsPlaceholder, type ResolvedPost } from "./PostsView";

function post(over: Partial<ResolvedPost> = {}): ResolvedPost {
  return {
    title: "On the Road This Summer",
    coverImage: null,
    category: "announcement",
    publishedAt: "2026-05-10T00:00:00.000Z",
    summary: "Dates, cities, and a few surprises.",
    ...over,
  };
}

describe("<PostsList>", () => {
  it("renders the title, a category · date meta line, and the summary", () => {
    const html = renderToStaticMarkup(<PostsList items={[post()]} />);
    expect(html).toContain("On the Road This Summer");
    expect(html).toContain("Announcement");
    expect(html).toContain("May 10, 2026");
    expect(html).toContain("Dates, cities, and a few surprises.");
  });

  it("shows a themed gradient placeholder (no <img>) when there's no cover image", () => {
    const html = renderToStaticMarkup(<PostsList items={[post({ coverImage: null })]} />);
    expect(html).toContain("data-post-cover");
    expect(html).toContain("linear-gradient");
    expect(html).not.toContain("<img");
  });

  it("drops the category label when unset but always keeps the published date", () => {
    const html = renderToStaticMarkup(<PostsList items={[post({ category: "" })]} />);
    expect(html).toContain("May 10, 2026");
    expect(html).not.toContain("Announcement");
  });

  it("shows an empty state when there are no posts", () => {
    const html = renderToStaticMarkup(<PostsList items={[]} />);
    expect(html).toMatch(/No posts yet/i);
  });
});

describe("<PostsPlaceholder>", () => {
  it("renders the editor stand-in copy", () => {
    expect(renderToStaticMarkup(<PostsPlaceholder />)).toMatch(/Your posts appear here/i);
  });
});
