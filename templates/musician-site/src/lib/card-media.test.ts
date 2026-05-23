import { describe, expect, it } from "vitest";

import { cardMediaFilename, inferCardMediaKind } from "./card-media";

describe("inferCardMediaKind", () => {
  it("classifies common audio extensions", () => {
    for (const url of ["track.mp3", "song.wav", "loop.ogg", "voice.m4a", "master.flac", "clip.aac"]) {
      expect(inferCardMediaKind(url), url).toBe("audio");
    }
  });

  it("classifies common video extensions", () => {
    for (const url of ["promo.mp4", "teaser.webm", "raw.mov", "archive.mkv", "phone.m4v"]) {
      expect(inferCardMediaKind(url), url).toBe("video");
    }
  });

  it("classifies pdf", () => {
    expect(inferCardMediaKind("press-kit.pdf")).toBe("pdf");
  });

  it("maps unknown / archive / document extensions to the generic file tile", () => {
    for (const url of ["assets.zip", "stems.stem", "rider.docx", "data.json"]) {
      expect(inferCardMediaKind(url), url).toBe("file");
    }
  });

  it("maps image extensions to file (proper images go through the picker, not fileUrl)", () => {
    // A fileUrl pointing at an image shouldn't render a raw <img>;
    // it falls through to the generic tile so the artist is nudged
    // to use the image picker for optimised previews.
    for (const url of ["cover.jpg", "logo.png", "art.webp", "icon.svg"]) {
      expect(inferCardMediaKind(url), url).toBe("file");
    }
  });

  it("is case-insensitive on the extension", () => {
    expect(inferCardMediaKind("TRACK.MP3")).toBe("audio");
    expect(inferCardMediaKind("Deck.PDF")).toBe("pdf");
  });

  it("strips query strings and fragments before reading the extension", () => {
    expect(inferCardMediaKind("https://cdn.example.com/track.mp3?v=3")).toBe("audio");
    expect(inferCardMediaKind("https://cdn.example.com/deck.pdf#page=2")).toBe("pdf");
    expect(inferCardMediaKind("/files/promo.mp4?token=abc#t=10")).toBe("video");
  });

  it("returns file for an extensionless URL", () => {
    expect(inferCardMediaKind("https://example.com/download")).toBe("file");
    expect(inferCardMediaKind("/files/epk")).toBe("file");
  });

  it("handles a full path + query without misreading a dot in the path", () => {
    // A dot in a directory segment shouldn't be mistaken for an
    // extension — `pop()` reads the last segment's extension.
    expect(inferCardMediaKind("https://cdn.v2.example.com/a.b.c/track.mp3")).toBe("audio");
  });
});

describe("cardMediaFilename", () => {
  it("extracts the last path segment", () => {
    expect(cardMediaFilename("https://cdn.example.com/files/press-kit.pdf")).toBe(
      "press-kit.pdf",
    );
    expect(cardMediaFilename("/uploads/track.mp3")).toBe("track.mp3");
  });

  it("strips query + fragment", () => {
    expect(cardMediaFilename("https://x.com/deck.pdf?v=3#page=2")).toBe("deck.pdf");
  });

  it("percent-decodes spaces and unicode", () => {
    expect(cardMediaFilename("/files/Press%20Kit%202026.pdf")).toBe("Press Kit 2026.pdf");
  });

  it("falls back to the raw segment on a malformed escape sequence", () => {
    // decodeURIComponent throws on a lone `%`; the helper catches it.
    expect(cardMediaFilename("/files/weird%file.pdf")).toBe("weird%file.pdf");
  });

  it("returns the whole string when there's no slash", () => {
    expect(cardMediaFilename("track.mp3")).toBe("track.mp3");
  });
});
