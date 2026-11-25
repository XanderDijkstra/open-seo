import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { DigestSettings } from "@/server/features/portfolio/services/digestSettings";
import { PortfolioService } from "@/server/features/portfolio/services/PortfolioService";
import { requireAuthenticatedContext } from "@/serverFunctions/middleware";

export const PORTFOLIO_DATE_RANGES = [
  "last_7_days",
  "last_28_days",
  "last_3_months",
] as const;

const portfolioInputSchema = z.object({
  dateRange: z.enum(PORTFOLIO_DATE_RANGES),
});

/** Search Console totals for every project in the workspace, this period
 *  against the one before. First-party Google data, free. */
export const getPortfolioPerformance = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(portfolioInputSchema)
  .handler(async ({ data, context }) =>
    PortfolioService.listSitePerformance(
      context.organizationId,
      data.dateRange,
    ),
  );

/** Every project, with whether the daily digest email includes it. */
export const getDigestProjects = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .handler(async ({ context }) =>
    DigestSettings.listProjects(context.organizationId),
  );

const digestInclusionSchema = z.object({
  projectIds: z.array(z.string().min(1)).min(1).max(500),
  included: z.boolean(),
});

export const setDigestProjectsIncluded = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(digestInclusionSchema)
  .handler(async ({ data, context }) => {
    await DigestSettings.setIncluded(
      context.organizationId,
      data.projectIds,
      data.included,
    );
  });
