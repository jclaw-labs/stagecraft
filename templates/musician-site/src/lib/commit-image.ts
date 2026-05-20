import {
  commitFiles,
  ensureBranchExists,
  mergeBranchInto,
  type FileToCommit,
} from "./git-commit";
import { generateImageVariants, variantFilename, type ProcessImageInput } from "./image";
import { type ImageMetadata } from "./image-types";
import {
  DRAFT_BRANCH,
  fetchPublishToken,
  isPlatformConfigured,
  PublishError,
  readEnv,
} from "./publish";

/**
 * Layout under `public/images/` that both the local-disk and broker paths
 * must agree on; the public-site renderer reads variants from these
 * exact filenames (see components/Image.tsx → variantPath).
 */
function imageRepoPaths(metadata: ImageMetadata): {
  originalPath: string;
  variantPath: (filename: string) => string;
} {
  const dir = `public/images/${metadata.contentSlug}/${metadata.id}`;
  return {
    originalPath: `${dir}/original.${metadata.originalExt}`,
    variantPath: (filename) => `${dir}/${filename}`,
  };
}

/**
 * Commit one uploaded image (original + all generated variants) to the
 * artist's `draft` branch through the platform's GitHub App broker.
 *
 * Per ADR-010, image uploads land on `draft` like every other save;
 * they don't deploy until the artist hits Publish. The draft commit
 * carries `[skip ci]` so the host doesn't trigger a build for it.
 *
 * Auto-rebase fires first so the image lands on top of any direct-to-
 * main pushes since the artist's previous save.
 *
 * Returns the same `ImageMetadata` shape the local-disk path returns,
 * so callers can hand it back to the editor unchanged. `commitSha` is
 * the draft commit; the eventual publish commit's SHA is reported
 * separately when the artist hits Publish.
 *
 * Dedup note: this function does NOT short-circuit when the same image
 * was uploaded before. Re-uploading the same buffer produces deterministic
 * blob SHAs (sharp output is stable for stable inputs), so git treats the
 * tree as unchanged for those paths — the resulting commit is harmless
 * but creates a no-op entry in `git log`. A getContent-based dedup pass
 * is a follow-up; tracked in templates/musician-site/CLAUDE.md.
 */
export async function commitUploadedImage(args: {
  input: ProcessImageInput;
  authorEmail: string;
  authorName?: string;
}): Promise<{ metadata: ImageMetadata; commitSha: string }> {
  const env = readEnv();
  if (!isPlatformConfigured(env)) {
    throw new PublishError(
      "no-platform-configured",
      "STAGECRAFT_PLATFORM_URL / STAGECRAFT_SITE_ID / STAGECRAFT_BROKER_SECRET must all be set to commit images via the broker",
    );
  }

  const generated = await generateImageVariants(args.input);
  const { originalPath, variantPath } = imageRepoPaths(generated.metadata);

  const files: FileToCommit[] = [
    {
      path: originalPath,
      content: generated.originalBuffer.toString("base64"),
      encoding: "base64",
    },
    ...generated.variants.map((v) => ({
      path: variantPath(variantFilename(v.width, v.format)),
      content: v.buffer.toString("base64"),
      encoding: "base64" as const,
    })),
  ];

  const { token, owner, repo } = await fetchPublishToken(env);
  const author = { name: args.authorName ?? "Artist", email: args.authorEmail };
  const message = `Upload image ${generated.metadata.contentSlug}/${generated.metadata.id}`;

  try {
    await ensureBranchExists({
      token,
      owner,
      repo,
      branch: DRAFT_BRANCH,
      fromBranch: env.branch,
    });
  } catch (cause) {
    throw new PublishError("github-failed", `ensure draft branch: ${String(cause)}`);
  }

  try {
    const merge = await mergeBranchInto({
      token,
      owner,
      repo,
      from: env.branch,
      into: DRAFT_BRANCH,
    });
    if (merge.kind === "conflict") {
      throw new PublishError(
        "github-failed",
        `auto-rebase: draft can't merge cleanly with ${env.branch}. Discard pending changes or contact support.`,
      );
    }
  } catch (cause) {
    if (cause instanceof PublishError) throw cause;
    throw new PublishError("github-failed", `auto-rebase: ${String(cause)}`);
  }

  let commitSha: string;
  try {
    commitSha = await commitFiles({
      token,
      owner,
      repo,
      branch: DRAFT_BRANCH,
      message: `${message}\n\n[skip ci]`,
      files,
      author,
    });
  } catch (cause) {
    throw new PublishError("github-failed", `commit to draft: ${String(cause)}`);
  }

  return { metadata: generated.metadata, commitSha };
}
