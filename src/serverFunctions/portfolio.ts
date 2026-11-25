import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
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
