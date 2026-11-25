import { sortBy } from "remeda";
import { GscConnectionRepository } from "@/server/features/gsc/repositories/GscConnectionRepository";
import { DigestSettings } from "@/server/features/portfolio/services/digestSettings";
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

const RED = "#c62828";
const GREEN = "#1b7f3b";
const GREY = "#6b7280";

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const clickDelta = (site: ConnectedSite) =>
  site.current.clicks - site.previous.clicks;

function formatChange(delta: number, previous: number) {
  const sign = delta > 0 ? "+" : "";
  const percent =
    previous > 0 ? ` (${sign}${Math.round((delta / previous) * 100)}%)` : "";
  return `${sign}${delta}${percent}`;
}

const changeColor = (delta: number) =>
  delta > 0 ? GREEN : delta < 0 ? RED : GREY;

const siteLine = (site: ConnectedSite) =>
  `${site.name}: ${site.current.clicks} clicks, ${formatChange(clickDelta(site), site.previous.clicks)}, position ${site.current.position.toFixed(1)} (was ${site.previous.position.toFixed(1)})`;

function statTile(label: string, value: string, note: string, color: string) {
  return `<td width="33%" style="padding:0 6px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;border-radius:10px"><tr><td style="padding:14px 16px"><div style="font-size:12px;color:${GREY};text-transform:uppercase;letter-spacing:.04em">${label}</div><div style="font-size:26px;font-weight:700;color:#111827;line-height:1.3">${value}</div><div style="font-size:13px;color:${color}">${note}</div></td></tr></table></td>`;
}

function siteRows(
  sites: ConnectedSite[],
  maxClicks: number,
  baseUrl: string | undefined,
) {
  return sites
    .map((site) => {
      const delta = clickDelta(site);
      const name = escapeHtml(site.name);
      const title = baseUrl
        ? `<a href="${baseUrl}/p/${site.projectId}/search-performance" style="color:#111827;text-decoration:none">${name}</a>`
        : name;
      // Lower position numbers are better, so a falling number is green.
      const positionDelta = site.current.position - site.previous.position;
      const barWidth = Math.max(
        2,
        Math.round((site.current.clicks / maxClicks) * 100),
      );
      return `<tr><td style="padding:10px 8px 10px 0;border-top:1px solid #eceef1"><div style="font-size:14px;font-weight:600">${title}</div><div style="margin-top:6px;height:6px;width:${barWidth}%;background:${changeColor(delta)};border-radius:3px;font-size:0;line-height:0">&nbsp;</div></td><td align="right" style="padding:10px 8px;border-top:1px solid #eceef1;font-size:14px;white-space:nowrap">${site.current.clicks}</td><td align="right" style="padding:10px 8px;border-top:1px solid #eceef1;font-size:14px;font-weight:600;white-space:nowrap;color:${changeColor(delta)}">${formatChange(delta, site.previous.clicks)}</td><td align="right" style="padding:10px 0 10px 8px;border-top:1px solid #eceef1;font-size:13px;white-space:nowrap;color:${GREY}">${site.current.position.toFixed(1)} <span style="color:${changeColor(-positionDelta)}">${positionDelta < -0.05 ? "&#9650;" : positionDelta > 0.05 ? "&#9660;" : ""}</span></td></tr>`;
    })
    .join("");
}

function siteTable(
  title: string,
  sites: ConnectedSite[],
  maxClicks: number,
  baseUrl: string | undefined,
) {
  if (sites.length === 0) return "";
  const head = (label: string, align: string) =>
    `<th align="${align}" style="padding:0 8px 6px 0;font-size:11px;font-weight:600;color:${GREY};text-transform:uppercase;letter-spacing:.04em">${label}</th>`;
  return `<h2 style="margin:28px 0 10px;font-size:16px;color:#111827">${escapeHtml(title)}</h2><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${head("Site", "left")}${head("Clicks", "right")}${head("Change", "right")}${head("Position", "right")}</tr>${siteRows(sites, maxClicks, baseUrl)}</table>`;
}

/**
 * Emails one Search Console summary a day: the sites whose clicks dropped,
 * then every other connected site with clicks. Projects switched off on the
 * All sites page are left out. Self-hosted only, and off until the deployment
 * sets ALERT_EMAIL_TO and ALERT_EMAIL_FROM.
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
      await DigestSettings.getExcludedProjectIds(organizationId),
    );
    const connected = report.sites.filter(
      (site): site is ConnectedSite =>
        site.status === "connected" &&
        site.current !== null &&
        site.previous !== null,
    );
    if (connected.length === 0) continue;

    const byChange = sortBy(connected, clickDelta);
    const drops = byChange.filter(
      (site) =>
        site.previous.clicks >= MIN_PREVIOUS_CLICKS &&
        site.current.clicks <= site.previous.clicks * (1 - DROP_THRESHOLD),
    );
    const others = byChange.filter(
      (site) =>
        !drops.includes(site) &&
        (site.current.clicks > 0 || site.previous.clicks > 0),
    );
    const quiet = connected.length - drops.length - others.length;
    const failed = report.sites.filter(
      (site) => site.status === "reconnect" || site.status === "error",
    );

    const totalClicks = connected.reduce((n, s) => n + s.current.clicks, 0);
    const previousClicks = connected.reduce((n, s) => n + s.previous.clicks, 0);
    const totalDelta = totalClicks - previousClicks;
    const growing = connected.filter((site) => clickDelta(site) > 0).length;
    const maxClicks = Math.max(1, ...connected.map((s) => s.current.clicks));
    const dropTitle = `Dropped ${Math.round(DROP_THRESHOLD * 100)}% or more`;
    const period = `${report.startDate} to ${report.endDate}, against ${report.previousStartDate} to ${report.previousEndDate}`;
    const quietLine =
      quiet > 0
        ? `${quiet} site${quiet === 1 ? "" : "s"} had no clicks in either week.`
        : "";
    const failedLine =
      failed.length > 0
        ? `Could not read from Search Console: ${failed.map((site) => site.name).join(", ")}.`
        : "";
    const link = baseUrl ? `${baseUrl}/sites` : null;

    const text = [
      `Google Search clicks, ${period}.`,
      `\nTotal: ${totalClicks} clicks, ${formatChange(totalDelta, previousClicks)}`,
      `\n${drops.length > 0 ? dropTitle : `No site ${dropTitle.toLowerCase()}`}`,
      ...drops.map(siteLine),
      ...(others.length > 0 ? ["\nOther sites", ...others.map(siteLine)] : []),
      ...[quietLine, failedLine, link].filter(Boolean).map((l) => `\n${l}`),
    ].join("\n");

    const html = `<div style="background:#eef0f3;padding:24px 12px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:14px"><tr><td style="padding:22px 24px;background:#111827;border-radius:14px 14px 0 0"><div style="font-size:20px;font-weight:700;color:#ffffff">SEO daily digest</div><div style="margin-top:4px;font-size:13px;color:#c7cbd3">${period}</div></td></tr><tr><td style="padding:20px 18px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${statTile("Clicks", totalClicks.toLocaleString("en-US"), formatChange(totalDelta, previousClicks), changeColor(totalDelta))}${statTile("Dropped", String(drops.length), `of ${connected.length} sites`, drops.length > 0 ? RED : GREY)}${statTile("Growing", String(growing), `of ${connected.length} sites`, growing > 0 ? GREEN : GREY)}</tr></table></td></tr><tr><td style="padding:0 24px 24px">${
      drops.length > 0
        ? siteTable(dropTitle, drops, maxClicks, baseUrl)
        : `<p style="margin:24px 0 0;font-size:14px;color:${GREEN}">No site ${dropTitle.toLowerCase()} this week.</p>`
    }${siteTable("Other sites", others, maxClicks, baseUrl)}${[
      quietLine,
      failedLine,
    ]
      .filter(Boolean)
      .map(
        (line) =>
          `<p style="margin:18px 0 0;font-size:13px;color:${GREY}">${escapeHtml(line)}</p>`,
      )
      .join(
        "",
      )}${link ? `<p style="margin:26px 0 0"><a href="${link}" style="display:inline-block;padding:10px 18px;background:#111827;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px">Open All sites</a></p><p style="margin:14px 0 0;font-size:12px;color:${GREY}">Choose which sites this email covers on the Daily email tab there.</p>` : ""}</td></tr></table></div>`;

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
