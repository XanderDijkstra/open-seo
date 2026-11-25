import * as React from "react";
import { sort } from "remeda";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  getPortfolioPerformance,
  PORTFOLIO_DATE_RANGES,
} from "@/serverFunctions/portfolio";
import { PageHeader } from "@/client/components/PageHeader";
import { QueryState } from "@/client/components/QueryState";
import { Button } from "@/client/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import {
  changeClass,
  formatClickChange,
  formatCount,
  formatPosition,
} from "@/client/features/search-performance/SearchPerformanceColumns";
import { pageHead } from "@/client/lib/pageHead";

type DateRange = (typeof PORTFOLIO_DATE_RANGES)[number];
type Portfolio = Awaited<ReturnType<typeof getPortfolioPerformance>>;
type Site = Portfolio["sites"][number];

const RANGE_LABELS: Record<DateRange, string> = {
  last_7_days: "7 days",
  last_28_days: "28 days",
  last_3_months: "3 months",
};

const STATUS_LABELS: Record<Exclude<Site["status"], "connected">, string> = {
  not_connected: "Search Console not connected",
  reconnect: "Reconnect Google",
  error: "Google didn't answer",
};

export const Route = createFileRoute("/_app/sites")({
  head: () => pageHead("All sites"),
  component: SitesPage,
});

function clickChange(site: Site): number {
  return (site.current?.clicks ?? 0) - (site.previous?.clicks ?? 0);
}

/** Connected sites first, biggest loss of clicks at the top. */
function sortSites(sites: Site[]): Site[] {
  return sort(sites, (a, b) => {
    const aConnected = a.status === "connected";
    const bConnected = b.status === "connected";
    if (aConnected !== bConnected) return aConnected ? -1 : 1;
    return clickChange(a) - clickChange(b);
  });
}

function percentChange(current: number, previous: number): string {
  if (previous === 0) return current === 0 ? "" : "new";
  const percent = ((current - previous) / previous) * 100;
  return `${percent >= 0 ? "+" : "−"}${Math.abs(percent).toFixed(0)}%`;
}

function SitesPage() {
  const [dateRange, setDateRange] = React.useState<DateRange>("last_28_days");
  const portfolioQuery = useQuery({
    queryKey: ["portfolio", dateRange],
    queryFn: () => getPortfolioPerformance({ data: { dateRange } }),
  });

  return (
    <div className="h-full overflow-auto px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <PageHeader
          title="All sites"
          description="Google Search clicks for every project, against the period before. The biggest drops come first."
          actions={PORTFOLIO_DATE_RANGES.map((range) => (
            <Button
              key={range}
              size="sm"
              variant={range === dateRange ? "secondary" : "ghost"}
              aria-pressed={range === dateRange}
              onClick={() => setDateRange(range)}
            >
              {RANGE_LABELS[range]}
            </Button>
          ))}
        />

        <QueryState query={portfolioQuery} errorFallback="Failed to load sites">
          {(data) => <SitesTable data={data} />}
        </QueryState>
      </div>
    </div>
  );
}

function SitesTable({ data }: { data: Portfolio }) {
  const sites = sortSites(data.sites);
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {data.startDate} to {data.endDate}, against {data.previousStartDate} to{" "}
        {data.previousEndDate}
      </p>
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Site</TableHead>
              <TableHead className="text-right">Clicks</TableHead>
              <TableHead className="text-right">Change</TableHead>
              <TableHead className="text-right">Impressions</TableHead>
              <TableHead className="text-right">Change</TableHead>
              <TableHead className="text-right">Position</TableHead>
              <TableHead className="text-right">Was</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sites.map((site) => (
              <SiteRow key={site.projectId} site={site} />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function SiteRow({ site }: { site: Site }) {
  const name = (
    <span className="flex min-w-0 flex-col">
      <span className="truncate font-medium">{site.name}</span>
      <span className="truncate text-xs text-muted-foreground">
        {site.domain ?? "No domain set"}
      </span>
    </span>
  );

  if (site.status !== "connected" || !site.current || !site.previous) {
    return (
      <TableRow>
        <TableCell>
          <Link
            to="/p/$projectId/settings/integrations"
            params={{ projectId: site.projectId }}
          >
            {name}
          </Link>
        </TableCell>
        <TableCell colSpan={6} className="text-right text-muted-foreground">
          {STATUS_LABELS[site.status === "connected" ? "error" : site.status]}
        </TableCell>
      </TableRow>
    );
  }

  const { current, previous } = site;
  const clicks = current.clicks - previous.clicks;
  const impressions = current.impressions - previous.impressions;
  return (
    <TableRow>
      <TableCell>
        <Link
          to="/p/$projectId/search-performance"
          params={{ projectId: site.projectId }}
        >
          {name}
        </Link>
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {formatCount(current.clicks)}
      </TableCell>
      <TableCell
        className={`text-right tabular-nums ${clicks === 0 ? "" : changeClass(clicks > 0)}`}
      >
        {formatClickChange(clicks)}{" "}
        <span className="text-xs">
          {percentChange(current.clicks, previous.clicks)}
        </span>
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {formatCount(current.impressions)}
      </TableCell>
      <TableCell
        className={`text-right tabular-nums ${impressions === 0 ? "" : changeClass(impressions > 0)}`}
      >
        {percentChange(current.impressions, previous.impressions)}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {current.impressions > 0 ? formatPosition(current.position) : "–"}
      </TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">
        {previous.impressions > 0 ? formatPosition(previous.position) : "–"}
      </TableCell>
    </TableRow>
  );
}
