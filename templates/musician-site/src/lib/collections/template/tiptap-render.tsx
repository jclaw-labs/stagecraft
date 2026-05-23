/**
 * Render a Tiptap document (the value type of a `richText` field) as
 * React.
 *
 * Tiptap stores rich text as a ProseMirror-shaped JSON document. We
 * support a deliberately small node + mark set — the subset the
 * Tiptap-based field editor in PR 6 will produce by default. Unknown
 * nodes and marks are skipped (rendered as their text content where
 * possible, dropped otherwise) so a future Tiptap extension that
 * lands before this renderer catches up doesn't crash the public site.
 *
 * Supported nodes: doc, paragraph, heading, bulletList, orderedList,
 * listItem, hardBreak, blockquote, codeBlock, text.
 *
 * Supported marks: bold, italic, underline, strike, code, link.
 *
 * Out of scope for v1: tables, images-inside-rich-text (use the Image
 * primitive in the surrounding template instead), embeds-inside-rich-
 * text (same), custom extensions.
 */

import type { ReactNode } from "react";

import type { TiptapJSON } from "../schema";

type TiptapNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  text?: string;
};

/** Render a Tiptap doc as a React fragment of block-level nodes. */
export function renderTiptap(doc: TiptapJSON | null | undefined): ReactNode {
  if (!doc || doc.type !== "doc" || !Array.isArray(doc.content)) return null;
  return renderNodes(doc.content as TiptapNode[]);
}

function renderNodes(nodes: TiptapNode[]): ReactNode {
  return nodes.map((node, i) => renderNode(node, i));
}

function renderNode(node: TiptapNode, key: number): ReactNode {
  switch (node.type) {
    case "paragraph":
      return <p key={key}>{renderInline(node.content ?? [])}</p>;
    case "heading": {
      const level = clampHeadingLevel(node.attrs?.level);
      const Tag = `h${level}` as `h${1 | 2 | 3 | 4 | 5 | 6}`;
      return <Tag key={key}>{renderInline(node.content ?? [])}</Tag>;
    }
    case "bulletList":
      return <ul key={key}>{renderNodes(node.content ?? [])}</ul>;
    case "orderedList":
      return <ol key={key}>{renderNodes(node.content ?? [])}</ol>;
    case "listItem":
      return <li key={key}>{renderNodes(node.content ?? [])}</li>;
    case "blockquote":
      return <blockquote key={key}>{renderNodes(node.content ?? [])}</blockquote>;
    case "codeBlock":
      return (
        <pre key={key}>
          <code>{renderInline(node.content ?? [])}</code>
        </pre>
      );
    case "hardBreak":
      return <br key={key} />;
    case "text":
      // Tiptap shouldn't put a bare text node at block level, but if
      // a custom extension does, render it as a paragraph rather than
      // dropping silently.
      return <p key={key}>{renderInline([node])}</p>;
    default:
      warnUnknownNode(node.type, "node");
      // Unknown block-level node: try to render its content if any,
      // otherwise skip entirely.
      if (node.content) return <div key={key}>{renderNodes(node.content)}</div>;
      return null;
  }
}

function renderInline(nodes: TiptapNode[]): ReactNode {
  return nodes.map((node, i) => renderInlineNode(node, i));
}

function renderInlineNode(node: TiptapNode, key: number): ReactNode {
  if (node.type === "hardBreak") return <br key={key} />;
  if (node.type !== "text") {
    // Unknown inline node — fall back to its text content where possible.
    return node.text ? <span key={key}>{node.text}</span> : null;
  }
  const text = node.text ?? "";
  if (!node.marks || node.marks.length === 0) return text;
  // Wrap the text in marks, outermost-first.
  return node.marks.reduceRight<ReactNode>(
    (inner, mark) => wrapWithMark(mark, inner, key),
    text,
  );
}

function wrapWithMark(
  mark: { type: string; attrs?: Record<string, unknown> },
  inner: ReactNode,
  key: number,
): ReactNode {
  switch (mark.type) {
    case "bold":
      return <strong key={key}>{inner}</strong>;
    case "italic":
      return <em key={key}>{inner}</em>;
    case "underline":
      return <u key={key}>{inner}</u>;
    case "strike":
      return <s key={key}>{inner}</s>;
    case "code":
      return <code key={key}>{inner}</code>;
    case "link": {
      const href = typeof mark.attrs?.href === "string" ? mark.attrs.href : "#";
      const target = typeof mark.attrs?.target === "string" ? mark.attrs.target : undefined;
      const rel = target === "_blank" ? "noopener noreferrer" : undefined;
      return (
        <a key={key} href={href} target={target} rel={rel}>
          {inner}
        </a>
      );
    }
    default:
      warnUnknownNode(mark.type, "mark");
      // Unknown mark — render the inner text without any wrapping.
      return inner;
  }
}

/**
 * Warn once per unique unknown node/mark name. A custom Tiptap
 * extension that the renderer doesn't support shouldn't crash the
 * site, but the artist shouldn't be left wondering why their content
 * is silently disappearing either.
 */
const warnedUnknownNames = new Set<string>();
function warnUnknownNode(name: string, kind: "node" | "mark"): void {
  if (typeof console === "undefined") return;
  const key = `${kind}:${name}`;
  if (warnedUnknownNames.has(key)) return;
  warnedUnknownNames.add(key);
  console.warn(
    `[collections] renderTiptap: unknown ${kind} type "${name}" — content rendered without formatting`,
  );
}

function clampHeadingLevel(raw: unknown): 1 | 2 | 3 | 4 | 5 | 6 {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (n >= 1 && n <= 6 && Number.isInteger(n)) return n as 1 | 2 | 3 | 4 | 5 | 6;
  return 2;
}
