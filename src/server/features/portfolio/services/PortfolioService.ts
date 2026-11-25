import {
  GscNotConnectedError,
  GscService,
  isExpectedGrantFailure,
} from "@/server/features/gsc/services/GscService";
import {
  resolveDateRange,
  type GscDateRange,
} from "@/server/features/gsc/searchAnalytics";
import {
  previousPeriod,
  sumSearchTotals,
} from "@/server/features/gsc/searchPerformanceReport";
import { ProjectService } from "@/server/features/projects/services/ProjectService";

type SiteTotals = ReturnType<typeof sumSearchTotals>;

export type PortfolioSite = {
  projectId: string;
  name: string;
  domain: string | null;
  /** connected: totals are present. not_connected: no Search Console property
   *  picked. reconnect: the Google grant is dead. error: Google failed. */
  status: "connected" | "not_connected" | "reconnect" | "error";
  current: SiteTotals | null;
  previous: SiteTotals | null;
};

// A Worker opens at most 6 outbound connections at once.
const SITE_CONCURRENCY = 5;
// One row per day across both periods; the longest range is two 3-month spans.
const DAILY_ROW_LIMIT = 200;

/**
 * Search Console totals for every project in the organization, for a period
 * and the same-length period before it. One Google call per project: both
 * periods come back as daily rows and are split here.
 */
async function listSitePerformance(
  organizationId: string,
  dateRange: GscDateRange,
  excludeProjectIds: string[] = [],
): Promise<{
  startDate: string;
  endDate: string;
  previousStartDate: string;
  previousEndDate: string;
  sites: PortfolioSite[];
}> {
  const { startDate, endDate } = resolveDateRange({ dateRange });
  const previous = previousPeriod(startDate, endDate);
  const projects = (await ProjectService.listProjects(organizationId)).filter(
    (project) => !excludeProjectIds.includes(project.id),
  );

  const sites: PortfolioSite[] = [];
  let next = 0;
  const worker = async () => {
    while (next < projects.length) {
      const index = next++;
      const project = projects[index];
      const base = {
        projectId: project.id,
        name: project.name,
        domain: project.domain,
      };
      try {
        const { rows } = await GscService.getPerformance({
          projectId: project.id,
          startDate: previous.startDate,
          endDate,
          dimensions: ["date"],
          rowLimit: DAILY_ROW_LIMIT,
        });
        sites[index] = {
          ...base,
          status: "connected",
          current: sumSearchTotals(
            rows.filter((row) => (row.keys?.[0] ?? "") >= startDate),
          ),
          previous: sumSearchTotals(
            rows.filter((row) => (row.keys?.[0] ?? "") < startDate),
          ),
        };
      } catch (error) {
        let status: PortfolioSite["status"] = "error";
        if (error instanceof GscNotConnectedError) status = "not_connected";
        else if (isExpectedGrantFailure(error)) status = "reconnect";
        else
          console.error("Portfolio: Search Console failed", project.id, error);
        sites[index] = { ...base, status, current: null, previous: null };
      }
    }
  };
  await Promise.all(Array.from({ length: SITE_CONCURRENCY }, worker));

  return {
    startDate,
    endDate,
    previousStartDate: previous.startDate,
    previousEndDate: previous.endDate,
    sites,
  };
}

export const PortfolioService = { listSitePerformance };
