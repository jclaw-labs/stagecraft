import { type FileToCommit } from "./git-commit";
import { generateImageVariants, variantFilename, type ProcessImageInput } from "./image";
import { type ImageMetadata } from "./image-types";
import {
  commitThroughDraft,
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
 * artist's repo through the platform's GitHub App broker. Mirrors the
 * publishPage flow in publish.ts: token broker → octokit Git Data API →
 * single commit.
 *
 * Returns the same `ImageMetadata` shape the local-disk path returns, so
 * callers can hand it back to the editor unchanged.
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

  // Route through the draft branch (ADR-010). Images upload as one
  // commit on draft + immediate squash to main, matching the rest of
  // the save flow. The draft commit carries `[skip ci]` so the
  // deploy only fires for the squash commit on main.
  //
  // `commitThroughDraft` already wraps each step in a labelled
  // PublishError — don't double-wrap or the step name is lost.
  const commitSha = await commitThroughDraft({
    token,
    owner,
    repo,
    mainBranch: env.branch,
    message: `Upload image ${generated.metadata.contentSlug}/${generated.metadata.id}`,
    files,
    author: { name: args.authorName ?? "Artist", email: args.authorEmail },
  });

  return { metadata: generated.metadata, commitSha };
}
