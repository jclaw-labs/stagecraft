import type { FailureCategory } from "./types";

export interface FailureSummary {
  title: string;
  description: string;
  suggestedAction: string;
}

const summaries: Record<FailureCategory, FailureSummary> = {
  github_api_error: {
    title: "GitHub connection problem",
    description:
      "We couldn't communicate with GitHub. This is usually a temporary issue or a permissions problem with your connected account.",
    suggestedAction:
      "Check that your GitHub account is still connected in Settings, then retry. If the problem persists, reconnect GitHub.",
  },
  netlify_deploy_error: {
    title: "Deployment failed",
    description:
      "Your site built successfully but couldn't be deployed to Netlify. This may be a configuration issue or a temporary Netlify outage.",
    suggestedAction:
      "Check that your Netlify account is still connected in Settings, then retry. If the problem continues, review your Netlify project settings.",
  },
  vercel_github_app_missing: {
    title: "Vercel GitHub App not installed",
    description:
      "Vercel requires its GitHub App installed on your account before it can link a repository for auto-deploy.",
    suggestedAction:
      "Install Vercel's GitHub App at Settings → Vercel, then try creating your site again.",
  },
  validation_error: {
    title: "Content validation failed",
    description:
      "The changes produced content that doesn't match the expected format. This can happen when an edit creates conflicting or incomplete data.",
    suggestedAction:
      "Retry to let the system attempt an automatic fix. If it keeps failing, try rephrasing your request with more specific instructions.",
  },
  ai_error: {
    title: "AI generation failed",
    description:
      "The AI model couldn't complete your request. This is usually a temporary service issue.",
    suggestedAction:
      "Wait a moment and retry. If the problem persists, try simplifying your request.",
  },
  timeout: {
    title: "Request timed out",
    description:
      "The operation took too long to complete. This can happen during periods of high demand.",
    suggestedAction:
      "Retry your request. If timeouts keep occurring, try again during off-peak hours.",
  },
  unknown: {
    title: "Something went wrong",
    description:
      "An unexpected error occurred while processing your request.",
    suggestedAction:
      "Retry your request. If the problem continues, please contact support with the job ID.",
  },
};

export function getFailureSummary(category: FailureCategory | null | undefined): FailureSummary {
  if (!category) return summaries.unknown;
  return summaries[category] ?? summaries.unknown;
}
