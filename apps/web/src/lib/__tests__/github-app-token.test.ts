import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, it, expect, vi } from "vitest";

import { mintInstallationToken, normalizePrivateKey } from "../github-app-token";

function generateRsaKey() {
  return generateKeyPairSync("rsa", { modulusLength: 2048 });
}

describe("normalizePrivateKey", () => {
  it("re-emits a PKCS#1 (`BEGIN RSA PRIVATE KEY`) input as PKCS#8", () => {
    const { privateKey } = generateRsaKey();
    const pkcs1 = privateKey.export({ type: "pkcs1", format: "pem" }) as string;
    expect(pkcs1).toMatch(/^-----BEGIN RSA PRIVATE KEY-----/);

    const out = normalizePrivateKey(pkcs1);
    expect(out).toMatch(/^-----BEGIN PRIVATE KEY-----/);
    expect(out).toMatch(/-----END PRIVATE KEY-----\n?$/);
  });

  it("re-emits a PKCS#8 (`BEGIN PRIVATE KEY`) input as PKCS#8 (idempotent)", () => {
    const { privateKey } = generateRsaKey();
    const pkcs8 = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
    expect(pkcs8).toMatch(/^-----BEGIN PRIVATE KEY-----/);

    const out = normalizePrivateKey(pkcs8);
    expect(out).toMatch(/^-----BEGIN PRIVATE KEY-----/);
    // Round-trip preserves the key material
    expect(out.replace(/\s/g, "")).toBe(pkcs8.replace(/\s/g, ""));
  });

  it("handles env vars where newlines were escaped as literal \\n", () => {
    const { privateKey } = generateRsaKey();
    const pkcs1 = privateKey.export({ type: "pkcs1", format: "pem" }) as string;
    const escaped = pkcs1.replace(/\n/g, "\\n");
    expect(escaped).toContain("\\n");
    expect(escaped).not.toContain("\n");

    const out = normalizePrivateKey(escaped);
    expect(out).toMatch(/^-----BEGIN PRIVATE KEY-----/);
  });

  it("reconstructs a space-mangled PKCS#1 PEM (Netlify env-var flattening)", () => {
    // Netlify's dashboard fields and `netlify env:set` both replace each
    // newline with a single space when storing multi-line values. The
    // resulting single-line PEM has spaces between header, base64 body
    // chunks, and footer — `createPrivateKey` chokes on that without
    // reconstruction.
    const { privateKey } = generateRsaKey();
    const pkcs1 = privateKey.export({ type: "pkcs1", format: "pem" }) as string;
    const mangled = pkcs1.replace(/\n/g, " ").trim();
    expect(mangled).not.toContain("\n");
    expect(mangled).toContain("-----BEGIN RSA PRIVATE KEY----- ");

    const out = normalizePrivateKey(mangled);
    expect(out).toMatch(/^-----BEGIN PRIVATE KEY-----/);
    expect(out).toContain("\n");
  });

  it("reconstructs a space-mangled PKCS#8 PEM", () => {
    const { privateKey } = generateRsaKey();
    const pkcs8 = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
    const mangled = pkcs8.replace(/\n/g, " ").trim();
    expect(mangled).not.toContain("\n");

    const out = normalizePrivateKey(mangled);
    expect(out).toMatch(/^-----BEGIN PRIVATE KEY-----/);
    // Reconstructed body should be byte-equivalent to the original
    expect(out.replace(/\s/g, "")).toBe(pkcs8.replace(/\s/g, ""));
  });

  it("throws on garbage input", () => {
    expect(() => normalizePrivateKey("not a pem")).toThrow();
  });

  it("throws on a single-line input without BEGIN/END markers", () => {
    // Reconstruction should not fire if there are no PEM markers — fall
    // through to createPrivateKey which gives a real error message.
    expect(() => normalizePrivateKey("just some base64 abc def")).toThrow();
  });
});

describe("mintInstallationToken", () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.unstubAllGlobals();
  });

  function stubGitHub() {
    const { privateKey } = generateRsaKey();
    process.env.GITHUB_APP_ID = "1234";
    process.env.GITHUB_APP_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          token: "ghs_minted",
          expires_at: "2099-01-01T00:00:00Z",
          permissions: { contents: "write", metadata: "read" },
          repository_selection: "selected",
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  function mintRequest(fetchMock: ReturnType<typeof stubGitHub>) {
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    return { url, method: init.method, body: JSON.parse(String(init.body ?? "{}")) };
  }

  it("sends the repo scope and permissions in GitHub's access_tokens request", async () => {
    const fetchMock = stubGitHub();

    const token = await mintInstallationToken(42, {
      repositoryNames: ["artist-site"],
      permissions: { contents: "write", metadata: "read" },
    });

    expect(token).toEqual({ token: "ghs_minted", expiresAt: "2099-01-01T00:00:00Z" });
    const req = mintRequest(fetchMock);
    expect(req.method).toBe("POST");
    expect(req.url).toBe("https://api.github.com/app/installations/42/access_tokens");
    expect(req.body).toEqual({
      repositories: ["artist-site"],
      permissions: { contents: "write", metadata: "read" },
    });
  });

  it("requests an installation-wide token when no scope is given", async () => {
    const fetchMock = stubGitHub();

    await mintInstallationToken(42);

    const req = mintRequest(fetchMock);
    expect(req.body.repositories).toBeUndefined();
    expect(req.body.permissions).toBeUndefined();
  });

  it("throws GitHubAppMisconfiguredError when the App credentials are unset", async () => {
    delete process.env.GITHUB_APP_ID;
    delete process.env.GITHUB_APP_PRIVATE_KEY;
    await expect(mintInstallationToken(42)).rejects.toThrow("GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY not set");
  });
});
