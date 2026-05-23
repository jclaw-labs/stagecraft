"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Compact account chip with a popover menu — shows the signed-in email and
 * a sign-out button. Lives in the admin sidebar and on the Puck editor
 * header (where it's wrapped with the publish status pill).
 */
export function AdminAccountButton({ email }: { email: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    function handle(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [isOpen]);

  const initial = (email[0] ?? "?").toUpperCase();

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-label={`Account menu (signed in as ${email || "unknown"})`}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--space-2)",
          width: "100%",
          padding: "var(--space-2) var(--space-3)",
          border: "1px solid var(--color-border)",
          background: "var(--color-surface)",
          color: "var(--color-text)",
          fontSize: "var(--font-size-sm)",
          fontWeight: "var(--font-weight-semibold)" as unknown as number,
          cursor: "pointer",
          borderRadius: "var(--radius-sm)",
          fontFamily: "var(--font-body)",
        }}
      >
        <span
          aria-hidden
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "1.5rem",
            height: "1.5rem",
            borderRadius: "50%",
            background: "var(--color-surface-raised)",
            fontSize: "var(--font-size-xs)",
          }}
        >
          {initial}
        </span>
        <span
          style={{
            flex: 1,
            textAlign: "left",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontWeight: "var(--font-weight-normal)" as unknown as number,
          }}
        >
          {email || "Account"}
        </span>
      </button>
      {isOpen ? (
        <div
          role="menu"
          style={{
            position: "absolute",
            bottom: "calc(100% + var(--space-1))",
            left: 0,
            right: 0,
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius)",
            padding: "var(--space-2)",
            boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
            zIndex: 1000,
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-2)",
          }}
        >
          <div
            style={{
              fontSize: "var(--font-size-xs)",
              color: "var(--color-text-muted)",
            }}
          >
            Signed in as
          </div>
          <div
            style={{
              fontSize: "var(--font-size-sm)",
              fontWeight: "var(--font-weight-semibold)" as unknown as number,
              color: "var(--color-text)",
              wordBreak: "break-all",
            }}
          >
            {email || "(unknown)"}
          </div>
          <form
            action="/api/auth/logout"
            method="POST"
            style={{ margin: 0 }}
            onSubmit={() => setIsOpen(false)}
          >
            <button
              type="submit"
              style={{
                width: "100%",
                padding: "var(--space-1) var(--space-3)",
                fontSize: "var(--font-size-sm)",
                border: "1px solid var(--color-border)",
                background: "var(--color-surface)",
                color: "var(--color-text)",
                cursor: "pointer",
                borderRadius: "var(--radius-sm)",
              }}
            >
              Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
