import { type FileToCommit } from "./git-commit";
import {
  generateImageVariants,
  variantFilename,
  type ProcessImageInput,
  type SanitisedInfo,
} from "./image";
import { type ImageMetadata } from "./image-types";
import {
  _commitToDraft as commitToDraft,
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
}): Promise<{ metadata: ImageMetadata; commitSha: string; sanitised?: SanitisedInfo }> {
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
  const commitSha = await commitToDraft({
    token,
    owner,
    repo,
    mainBranch: env.branch,
    message: `Upload image ${generated.metadata.contentSlug}/${generated.metadata.id}`,
    files,
    author: { name: args.authorName ?? "Artist", email: args.authorEmail },
  });

  return {
    metadata: generated.metadata,
    commitSha,
    ...(generated.sanitised ? { sanitised: generated.sanitised } : {}),
  };
}
