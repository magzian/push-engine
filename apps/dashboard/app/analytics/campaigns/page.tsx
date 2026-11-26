import Link from "next/link";

import { DashboardShell } from "../../_components/dashboard-shell";
import { FilterSelect } from "../../_components/list-controls";
import { MetricInfo } from "../../_components/metric-info";
import { getCampaignList } from "../../_data/campaigns";
import { getCampaignPerformancePage, getGa4CampaignLandingPerformancePage, resolveAnalyticsRange } from "../../_data/analytics";
import { getSiteChoices } from "../../_data/sites";
import { AnalyticsComparisonCard } from "../analytics-comparison-card";
import { AnalyticsRangePicker } from "../analytics-range-picker";

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatPercent(value: number): string {
  return `${value}%`;
}

export default async function CampaignPerformancePage({
  searchParams,
}: {
  searchParams: Promise<{
    siteId?: string;
    campaignId?: string;
    days?: string;
    preset?: string;
    startDate?: string;
    endDate?: string;
    compareMode?: string;
    compareStartDate?: string;
    compareEndDate?: string;
  }>;
}) {
  const query = await searchParams;
  const { selectedPreset, range, compareMode, comparisonRange } = resolveAnalyticsRange(query);

  // Campaigns list is scoped to the selected site so the picker only shows
  // campaigns that actually belong to the current filter context.
  const [stats, comparisonStats, sites, campaignsPayload, ga4Landing] = await Promise.all([
    getCampaignPerformancePage(range, query.siteId, query.campaignId),
    comparisonRange ? getCampaignPerformancePage(comparisonRange, query.siteId, query.campaignId) : Promise.resolve(null),
    getSiteChoices(),
    getCampaignList({ siteId: query.siteId }),
    getGa4CampaignLandingPerformancePage(range, query.siteId, query.campaignId),
  ]);

  const realSites = sites.filter((site) => site.id !== "site-3");
  const selectedCampaign = campaignsPayload.items.find((c) => c.id === query.campaignId);

  // "Sent" in the UI means successfully handed off to the push service --
  // the raw `sent` bucket means acknowledged but not yet delivery-confirmed,
  // so sent+delivered together represents the total dispatched count.
  const dispatchedCount = stats ? stats.sent + stats.delivered : 0;
  const comparisonDispatchedCount = comparisonStats ? comparisonStats.sent + comparisonStats.delivered : 0;

  const scopeLabel = selectedCampaign
    ? selectedCampaign.name
    : query.siteId
      ? (realSites.find((s) => s.id === query.siteId)?.name ?? "Selected site")
      : "All sites";

  return (
    <DashboardShell
      eyebrow="Analytics"
      title="Campaign performance"
      description="Sent, delivered, clicks and CTR across your campaigns — filter by site, campaign, or date range."
      actions={
        <Link className="button secondary" href="/analytics">
          Back to analytics
        </Link>
      }
    >
      <section className="card analytics-panel" style={{ marginBottom: 18 }}>
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Reporting window</p>
            <h3>{range.label}</h3>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <FilterSelect
              basePath="/analytics/campaigns"
              currentParams={{ days: String(range.days), siteId: query.siteId, campaignId: query.campaignId, preset: query.preset, startDate: query.startDate, endDate: query.endDate, compareMode: query.compareMode }}
              paramKey="siteId"
              allLabel="All sites"
              options={realSites.map((site) => ({ value: site.id, label: site.name }))}
            />
            <FilterSelect
              basePath="/analytics/campaigns"
              currentParams={{ days: String(range.days), siteId: query.siteId, campaignId: query.campaignId, preset: query.preset, startDate: query.startDate, endDate: query.endDate, compareMode: query.compareMode }}
              paramKey="campaignId"
              allLabel="All campaigns"
              options={campaignsPayload.items.map((c) => ({ value: c.id, label: c.name }))}
            />
          </div>
        </div>
        <AnalyticsRangePicker
          selectedPreset={selectedPreset}
          compareMode={compareMode}
          range={range}
          comparisonRange={comparisonRange}
          siteId={query.siteId ?? ""}
          campaignId={query.campaignId ?? null}
          compact
        />
      </section>

      {comparisonStats && comparisonRange ? (
        <div style={{ marginBottom: 18 }}>
          <AnalyticsComparisonCard
            currentLabel={range.label}
            comparisonLabel={comparisonRange.label}
            metrics={[
              { label: "Sent", current: formatNumber(dispatchedCount), comparison: formatNumber(comparisonDispatchedCount) },
              { label: "Delivered", current: formatNumber(stats?.delivered ?? 0), comparison: formatNumber(comparisonStats.delivered) },
              { label: "Clicks", current: formatNumber(stats?.clicked ?? 0), comparison: formatNumber(comparisonStats.clicked) },
              { label: "CTR", current: formatPercent(stats?.clickThroughRate ?? 0), comparison: formatPercent(comparisonStats.clickThroughRate) },
            ]}
          />
        </div>
      ) : null}

      <section className="card analytics-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Campaign performance</p>
            <h3>{scopeLabel}</h3>
          </div>
        </div>

        {stats && stats.total > 0 ? (
          <div className="analytics-mini-summary">
            <article className="analytics-mini-card">
              <span>Sent</span>
              <strong>{formatNumber(dispatchedCount)}</strong>
            </article>
            <article className="analytics-mini-card">
              <span>Delivered</span>
              <strong>{formatNumber(stats.delivered)}</strong>
            </article>
            <article className="analytics-mini-card">
              <span>Delivery rate</span>
              <strong>{formatPercent(stats.deliveryRate)}</strong>
            </article>
            <article className="analytics-mini-card">
              <span>Clicks</span>
              <strong>{formatNumber(stats.clicked)}</strong>
            </article>
            <article className="analytics-mini-card">
              <span>CTR</span>
              <strong>{formatPercent(stats.clickThroughRate)}</strong>
            </article>
            <article className="analytics-mini-card">
              <span>Failed / expired</span>
              <strong>{formatNumber(stats.failed + stats.expired)}</strong>
            </article>
          </div>
        ) : (
          <p className="subtle" style={{ padding: "20px 0" }}>
            No push deliveries found for this filter in the selected period.
          </p>
        )}
      </section>

      <section className="card analytics-panel" style={{ marginTop: 18 }}>
        <div className="panel-heading">
          <div>
            <p className="eyebrow">GA4 landing performance</p>
            <h3>{selectedCampaign ? "Visitors who reached the campaign URL" : "Visitors who reached any Push Engine campaign URL"}</h3>
          </div>
          <span className={`badge ${ga4Landing.status === "available" ? "active" : "muted"}`}>
            {ga4Landing.status === "available" ? "GA4 connected" : "GA4 unavailable"}
          </span>
        </div>
        {ga4Landing.status === "available" ? (
          <>
            <div className="analytics-mini-summary">
              <article className="analytics-mini-card analytics-mini-card--with-info">
                <div className="analytics-mini-card-heading"><span>Tracked landing visitors</span><MetricInfo label="Tracked landing visitors" description="Unique people GA4 recorded after they landed through a Push Engine URL in this reporting period." /></div>
                <strong>{formatNumber(ga4Landing.totalUsers)}</strong>
              </article>
              <article className="analytics-mini-card analytics-mini-card--with-info">
                <div className="analytics-mini-card-heading"><span>New visitors</span><MetricInfo label="New visitors" description="Visitors GA4 classified as new during a push-attributed session in this reporting period." /></div>
                <strong>{formatNumber(ga4Landing.newUsers)}</strong>
              </article>
              <article className="analytics-mini-card analytics-mini-card--with-info">
                <div className="analytics-mini-card-heading"><span>Returning visitors</span><MetricInfo label="Returning visitors" description="Visitors GA4 classified as returning during a push-attributed session in this reporting period." /></div>
                <strong>{formatNumber(ga4Landing.returningUsers)}</strong>
              </article>
              <article className="analytics-mini-card analytics-mini-card--with-info">
                <div className="analytics-mini-card-heading"><span>Sessions</span><MetricInfo label="Sessions" description="Visits to the site that began from a Push Engine campaign URL. One visitor can create more than one session." /></div>
                <strong>{formatNumber(ga4Landing.sessions)}</strong>
              </article>
              <article className="analytics-mini-card analytics-mini-card--with-info">
                <div className="analytics-mini-card-heading"><span>Engaged sessions</span><MetricInfo label="Engaged sessions" description="Push-attributed sessions that met GA4’s engagement threshold, such as lasting longer than 10 seconds, viewing multiple pages, or triggering a key event." /></div>
                <strong>{formatNumber(ga4Landing.engagedSessions)}</strong>
              </article>
              <article className="analytics-mini-card analytics-mini-card--with-info">
                <div className="analytics-mini-card-heading"><span>Key events</span><MetricInfo label="Key events" description="Events GA4 has been configured to treat as important actions, recorded during push-attributed sessions. One session can contain several key events." /></div>
                <strong>{formatNumber(ga4Landing.keyEvents)}</strong>
              </article>
            </div>
            <p className="subtle" style={{ marginTop: 12 }}>GA4 classifies new and returning visitors by session; those figures are not necessarily additive.</p>
          </>
        ) : (
          <p className="subtle" style={{ padding: "8px 0 0" }}>{ga4Landing.message}</p>
        )}
        <p className="subtle" style={{ marginTop: 14 }}>
          Matched in GA4 by session source / medium <strong>push_engine / push</strong>{selectedCampaign ? <> and this campaign&apos;s <strong>utm_id</strong></> : " across all Push Engine campaigns"}. GA4 may lag behind delivery and click data.
        </p>
      </section>
    </DashboardShell>
  );
}
