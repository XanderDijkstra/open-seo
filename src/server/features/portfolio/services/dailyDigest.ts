import { sortBy } from "remeda";
import { GscConnectionRepository } from "@/server/features/gsc/repositories/GscConnectionRepository";
import {
  PortfolioService,
  type PortfolioSite,
} from "@/server/features/portfolio/services/PortfolioService";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";

// A site is flagged when its clicks fell by at least this share against the
// 7 days before, and it had enough clicks for the change to mean something.
const DROP_THRESHOLD = 0.25;
const MIN_PREVIOUS_CLICKS = 20;

type ConnectedSite = PortfolioSite & {
  current: NonNullable<PortfolioSite["current"]>;
  previous: NonNullable<PortfolioSite["previous"]>;
};

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const formatChange = (site: ConnectedSite) => {
  const delta = site.current.clicks - site.previous.clicks;
  const sign = delta > 0 ? "+" : "";
  const percent =
    site.previous.clicks > 0
      ? ` (${sign}${Math.round((delta / site.previous.clicks) * 100)}%)`
      : "";
  return `${sign}${delta}${percent}`;
};

const siteLine = (site: ConnectedSite) =>
  `${site.name}: ${site.current.clicks} clicks, ${formatChange(site)}, position ${site.current.position.toFixed(1)} (was ${site.previous.position.toFixed(1)})`;

/**
 * Emails one Search Console summary a day: the sites whose clicks dropped,
 * then every other connected site. Self-hosted only, and off until the
 * deployment sets ALERT_EMAIL_TO and ALERT_EMAIL_FROM.
 */
export async function sendDailyPortfolioDigest(env: Cloudflare.Env) {
  const to = await getOptionalEnvValue("ALERT_EMAIL_TO");
  const from = await getOptionalEnvValue("ALERT_EMAIL_FROM");
  if (!env.ALERT_EMAIL || !to || !from) return;
  const baseUrl = await getOptionalEnvValue("BETTER_AUTH_URL");

  for (const organizationId of await GscConnectionRepository.listOrganizationIds()) {
    const report = await PortfolioService.listSitePerformance(
      organizationId,
      "last_7_days",
    );
    const connected = report.sites.filter(
      (site): site is ConnectedSite =>
        site.status === "connected" &&
        site.current !== null &&
        site.previous !== null,
    );
    if (connected.length === 0) continue;

    const byChange = sortBy(
      connected,
      (site) => site.current.clicks - site.previous.clicks,
    );
    const drops = byChange.filter(
      (site) =>
        site.previous.clicks >= MIN_PREVIOUS_CLICKS &&
        site.current.clicks <= site.previous.clicks * (1 - DROP_THRESHOLD),
    );
    const others = byChange.filter((site) => !drops.includes(site));
    const failed = report.sites.filter(
      (site) => site.status === "reconnect" || site.status === "error",
    );

    const sections: { title: string; lines: string[] }[] = [
      {
        title: `${drops.length > 0 ? "Dropped" : "No site dropped"} ${Math.round(DROP_THRESHOLD * 100)}% or more`,
        lines: drops.map(siteLine),
      },
      { title: "All other sites", lines: others.map(siteLine) },
      {
        title: "Could not read from Search Console",
        lines: failed.map((site) => site.name),
      },
    ].filter((section, index) => index === 0 || section.lines.length > 0);

    const period = `${report.startDate} to ${report.endDate}, against ${report.previousStartDate} to ${report.previousEndDate}`;
    const link = baseUrl ? `${baseUrl}/sites` : null;
    const text = [
      `Google Search clicks, ${period}.`,
      ...sections.map((s) => [`\n${s.title}`, ...s.lines].join("\n")),
      ...(link ? [`\n${link}`] : []),
    ].join("\n");
    const html = [
      `<p>Google Search clicks, ${period}.</p>`,
      ...sections.map(
        (s) =>
          `<h3>${escapeHtml(s.title)}</h3>` +
          (s.lines.length > 0
            ? `<ul>${s.lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`
            : ""),
      ),
      ...(link ? [`<p><a href="${link}">Open All sites</a></p>`] : []),
    ].join("");

    await env.ALERT_EMAIL.send({
      to,
      from,
      subject:
        drops.length > 0
          ? `SEO: ${drops.length} site${drops.length === 1 ? "" : "s"} dropped this week`
          : "SEO: no drops this week",
      text,
      html,
    });
  }
}
