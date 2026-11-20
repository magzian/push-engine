import { getCampaignById, getCampaignList, type CampaignDetail, type CampaignSummary } from "./campaigns";
import { getDashboardOverview, type DashboardOverview } from "./overview";
import { ALL_SITES_FETCH_LIMIT, getSiteById, getSiteList, type SiteSummary } from "../sites/sites.utils";
import { getSiteAnalytics, type SiteAnalyticsSummary } from "../../lib/site-analytics";
import { apiJson } from "../../lib/server-api";

export type AnalyticsDays = 1 | 7 | 30 | 90 | 365;
export type AnalyticsPreset = "today" | "7d" | "30d" | "90d" | "1y" | "custom";
export type AnalyticsCompareMode = "off" | "previous" | "custom";

export interface AnalyticsDateRange {
  startDate: string;
  endDate: string;
  days: number;
  label: string;
}

export interface CountryPerformanceSummary {
  country: string;
  totalSubscribers: number;
  totalDelivered: number;
  totalSent: number;
  totalFailed: number;
  totalExpired: number;
  totalClicked: number;
  deliveryRate: number;
  clickThroughRate: number;
}

export interface SitePerformanceSummary {
  siteId: string;
  siteName: string;
  totalSubscribers: number;
  totalDelivered: number;
  totalSent: number;
  totalFailed: number;
  totalExpired: number;
  totalClicked: number;
  deliveryRate: number;
  clickThroughRate: number;
}

export interface TimePerformanceSummary {
  // ISO timestamp marking the start of this bucket -- hourly when the
  // selected range is a single day, daily otherwise.
  bucket: string;
  totalDelivered: number;
  totalSent: number;
  totalFailed: number;
  totalClicked: number;
  deliveryRate: number;
  clickThroughRate: number;
}

// Hour-of-day (0-23, UTC+3) aggregated across the whole selected range --
// the same hour on every day in range is collapsed into one bucket, so this
// answers "what time of day" rather than "which day."
export interface PeakHourSummary {
  hour: number;
  newSubscribers: number;
  totalDelivered: number;
  totalSent: number;
  totalClicked: number;
  clickThroughRate: number;
}

export function formatHourOfDayLabel(hour: number): string {
  const start = String(hour).padStart(2, "0");
  const end = String((hour + 1) % 24).padStart(2, "0");
  return `${start}:00-${end}:00`;
}

// `hour` is a 0-23 hour-of-day already expressed in UTC+3 (how getPeakHours
// buckets everything server-side). To show the same instant in a site's own
// timezone, anchor it to an arbitrary reference date, convert to the UTC
// instant that hour represents, then re-render that instant in the site's
// zone. Hour-of-day granularity makes the specific reference date and DST
// edge cases immaterial -- this is for "roughly when," not exact scheduling.
export function formatHourOfDayLabelInZone(hour: number, timeZone: string | null | undefined): string {
  if (!timeZone) return formatHourOfDayLabel(hour);

  const utcInstant = new Date(Date.UTC(2024, 0, 1, hour - 3, 0, 0));
  // Some ICU implementations render midnight as "24" rather than "00" under
  // hour12: false -- normalize so the label never reads "24:00-01:00".
  const zoneHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hour12: false }).format(utcInstant)) % 24;
  const start = String(zoneHour).padStart(2, "0");
  const end = String((zoneHour + 1) % 24).padStart(2, "0");
  return `${start}:00-${end}:00`;
}

// Hourly buckets (single-day range) -> "HH:00". Within a week -> weekday
// name. Longer ranges -> day-of-month with month, matching how far apart
// the buckets actually are.
export function formatTimeBucketLabel(bucket: string, days: number): string {
  const date = new Date(bucket);
  if (days <= 1) {
    return `${String(date.getUTCHours()).padStart(2, "0")}:00`;
  }
  if (days <= 7) {
    return new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(date);
  }
  return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", timeZone: "UTC" }).format(date);
}

export interface CampaignPerformanceStats {
  pending: number;
  sent: number;
  delivered: number;
  failed: number;
  expired: number;
  clicked: number;
  total: number;
  deliveryRate: number;
  clickThroughRate: number;
}

export interface Ga4CampaignLandingPerformance {
  status: "available" | "not_configured" | "unavailable";
  totalUsers: number;
  newUsers: number;
  returningUsers: number;
  sessions: number;
  engagedSessions: number;
  keyEvents: number;
  message?: string;
}

export interface ContentPerformanceSummary {
  contentType: string;
  totalCampaigns: number;
  totalDelivered: number;
  totalSent: number;
  totalFailed: number;
  totalExpired: number;
  totalClicked: number;
  deliveryRate: number;
  clickThroughRate: number;
}

export interface AnalyticsDashboardData {
  days: number;
  selectedPreset: AnalyticsPreset;
  compareMode: AnalyticsCompareMode;
  rangeLabel: string;
  range: AnalyticsDateRange;
  comparisonRange: AnalyticsDateRange | null;
  overview: DashboardOverview;
  comparisonOverview: DashboardOverview | null;
  sites: SiteSummary[];
  selectedSite: SiteSummary;
  siteAnalytics: SiteAnalyticsSummary;
  campaigns: CampaignSummary[];
  selectedCampaign: CampaignDetail | null;
  countryPerformance: CountryPerformanceSummary[];
  sitePerformance: SitePerformanceSummary[];
  timePerformance: TimePerformanceSummary[];
  contentPerformance: ContentPerformanceSummary[];
}

const rangeLabels: Record<AnalyticsDays, string> = {
  1: "Today",
  7: "Last 7 days",
  30: "Last 30 days",
  90: "Last 90 days",
  365: "Last 1 year",
};

export function normalizeDays(value?: string): AnalyticsDays {
  const parsed = Number.parseInt(value ?? "30", 10);
  if (parsed === 1 || parsed === 7 || parsed === 30 || parsed === 90 || parsed === 365) {
    return parsed;
  }

  return 30;
}

function resolvePreset(input: { preset?: string; days: AnalyticsDays; startDate?: string; endDate?: string }): AnalyticsPreset {
  if (input.preset === "today" || input.preset === "7d" || input.preset === "30d" || input.preset === "90d" || input.preset === "1y" || input.preset === "custom") {
    return input.preset;
  }

  if (input.startDate || input.endDate) {
    return "custom";
  }

  switch (input.days) {
    case 1:
      return "today";
    case 7:
      return "7d";
    case 30:
      return "30d";
    case 90:
      return "90d";
    case 365:
      return "1y";
    default:
      return "30d";
  }
}

function parseDateInput(value?: string): Date | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(value);
}

function buildPreviousRange(range: AnalyticsDateRange): AnalyticsDateRange {
  const currentStart = parseDateInput(range.startDate) ?? new Date();
  const previousEnd = new Date(currentStart);
  previousEnd.setUTCDate(previousEnd.getUTCDate() - 1);
  const previousStart = new Date(previousEnd);
  previousStart.setUTCDate(previousStart.getUTCDate() - (range.days - 1));
  const label = range.days === 1 ? formatDate(previousStart) : `${formatDate(previousStart)} - ${formatDate(previousEnd)}`;

  return {
    startDate: previousStart.toISOString().slice(0, 10),
    endDate: previousEnd.toISOString().slice(0, 10),
    days: range.days,
    label,
  };
}

function buildDateRange(input: { startDate?: string; endDate?: string; days?: AnalyticsDays }, fallbackLabel: string): AnalyticsDateRange {
  if (!input.startDate && !input.endDate) {
    const normalizedDays = input.days ?? 30;
    const fallbackEnd = new Date();
    const fallbackStart = new Date(fallbackEnd);
    fallbackStart.setUTCDate(fallbackStart.getUTCDate() - (normalizedDays - 1));
    return {
      startDate: fallbackStart.toISOString().slice(0, 10),
      endDate: fallbackEnd.toISOString().slice(0, 10),
      days: normalizedDays,
      label: fallbackLabel,
    };
  }

  const start = parseDateInput(input.startDate) ?? parseDateInput(input.endDate) ?? new Date();
  const end = parseDateInput(input.endDate) ?? parseDateInput(input.startDate) ?? new Date(start);

  if (start > end) {
    const swapped = new Date(start);
    start.setTime(end.getTime());
    end.setTime(swapped.getTime());
  }

  const dayCount = Math.max(Math.round((end.getTime() - start.getTime()) / 86400000) + 1, 1);
  const label = dayCount === 1 ? formatDate(start) : `${formatDate(start)} - ${formatDate(end)}`;
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    days: dayCount,
    label,
  };
}

function createAllSitesFallback(): SiteSummary {
  return {
    id: "site-3",
    name: "All Sites",
    url: "",
    country: "Global",
    timezone: "UTC",
    createdAt: "2026-01-01T00:00:00.000Z",
    language: "en",
    platform: "Other",
    status: "active",
    subscribers: 0,
    vapidPublicKey: null,
    appName: "Exotic Push Engine",
    iconUrl: "",
    themeColor: "#1c1917",
    optInPromptType: "bell-icon",
    optInPromptAnimation: "pop",
    optInPromptBackgroundColor: "#ffffff",
    optInPromptHeadline: "Get browser notifications",
    optInPromptHeadlineTextColor: "#111111",
    optInPromptText: "Choose a custom prompt for each site.",
    optInPromptTextColor: "#52525b",
    optInPromptIconUrl: "",
    optInPromptCancelButtonLabel: "Dismiss",
    optInPromptCancelButtonTextColor: "#ffffff",
    optInPromptCancelButtonBackgroundColor: "#27272a",
    optInPromptApproveButtonLabel: "Allow",
    optInPromptApproveButtonTextColor: "#ffffff",
    optInPromptApproveButtonBackgroundColor: "#ea580c",
    optInPromptRepromptDelayDays: 30,
    optInPromptRecentNotificationsLimit: 3,
    optInPromptDisplayMode: "immediate",
    optInPromptScrollPercent: 50,
    optInPromptPageViewCount: 3,
    restApiKeyId: null,
    restApiAuthTokenLast4: null,
    restApiCredentialsGeneratedAt: null,
    lastConnectedAt: null,
  };
}

// Shared by every analytics page that uses AnalyticsRangePicker -- resolves
// the raw query-string params into a concrete current range and (if
// requested) comparison range, the same way the overview page always has.
export interface ResolvedAnalyticsRange {
  days: AnalyticsDays;
  selectedPreset: AnalyticsPreset;
  range: AnalyticsDateRange;
  compareMode: AnalyticsCompareMode;
  comparisonRange: AnalyticsDateRange | null;
}

export function resolveAnalyticsRange(input: {
  days?: string;
  preset?: string;
  startDate?: string;
  endDate?: string;
  compareMode?: string;
  compareStartDate?: string;
  compareEndDate?: string;
}): ResolvedAnalyticsRange {
  const days = normalizeDays(input.days);
  const selectedPreset = resolvePreset({
    days,
    ...(input.preset ? { preset: input.preset } : {}),
    ...(input.startDate ? { startDate: input.startDate } : {}),
    ...(input.endDate ? { endDate: input.endDate } : {}),
  });
  const rangeInput = {
    ...(input.startDate ? { startDate: input.startDate } : {}),
    ...(input.endDate ? { endDate: input.endDate } : {}),
    days,
  };
  const range = buildDateRange(rangeInput, rangeLabels[days]);
  const compareMode: AnalyticsCompareMode =
    input.compareMode === "previous" || input.compareMode === "custom" ? input.compareMode : "off";
  const comparisonRange =
    compareMode === "previous"
      ? buildPreviousRange(range)
      : compareMode === "custom" && (input.compareStartDate || input.compareEndDate)
        ? buildDateRange(
            {
              ...(input.compareStartDate ? { startDate: input.compareStartDate } : {}),
              ...(input.compareEndDate ? { endDate: input.compareEndDate } : {}),
              days,
            },
            "Comparison period",
          )
        : null;

  return { days, selectedPreset, range, compareMode, comparisonRange };
}

export async function getAnalyticsDashboardData(input: {
  days?: string;
  preset?: string;
  startDate?: string;
  endDate?: string;
  compareMode?: string;
  compareStartDate?: string;
  compareEndDate?: string;
  siteId?: string;
  campaignId?: string;
}): Promise<AnalyticsDashboardData> {
  const { days, selectedPreset, range, compareMode, comparisonRange } = resolveAnalyticsRange(input);
  const [sitesPayload, campaignsPayload] = await Promise.all([
    getSiteList({ limit: ALL_SITES_FETCH_LIMIT, offset: 0 }),
    getCampaignList(),
  ]);

  const sites = sitesPayload.items.length > 0 ? sitesPayload.items : [createAllSitesFallback()];
  // "site-3" is the All Sites sentinel -- it isn't a real site, so it must
  // never be looked up via getSiteById (that would 404 and silently fall
  // through to `sites[0]`, the most recently created site, defeating the
  // whole point of requesting the cross-site aggregate).
  const selectedSite =
    input.siteId === "site-3"
      ? createAllSitesFallback()
      : (input.siteId ? await getSiteById(input.siteId) : null) ?? sites[0] ?? createAllSitesFallback();
  const siteScopeId = selectedSite.id === "site-3" ? undefined : selectedSite.id;

  // Overview (the home/analytics "Failures," "Subscribers," etc. summary
  // cards) must be fetched after siteScopeId is known -- otherwise it
  // always returns the cross-site aggregate regardless of which site is
  // selected, which is exactly the bug this fixes.
  const [overview, comparisonOverview] = await Promise.all([
    getDashboardOverview(range.days, siteScopeId),
    comparisonRange ? getDashboardOverview(comparisonRange.days, siteScopeId) : Promise.resolve(null),
  ]);

  const selectedCampaign =
    (input.campaignId ? await getCampaignById(input.campaignId) : null) ??
    (campaignsPayload.items[0] ? await getCampaignById(campaignsPayload.items[0].id) : null);

  const siteAnalytics = await getSiteAnalytics(selectedSite);
  const [countryPerformance, sitePerformance, timePerformance] = await Promise.all([
    getAnalyticsApiList<CountryPerformanceSummary>(
      `/analytics/countries?days=${days}${siteScopeId ? `&siteId=${encodeURIComponent(siteScopeId)}` : ""}`,
    ),
    getAnalyticsApiList<SitePerformanceSummary>(
      `/analytics/sites-performance?days=${days}${siteScopeId ? `&siteId=${encodeURIComponent(siteScopeId)}` : ""}`,
    ),
    getAnalyticsApiList<TimePerformanceSummary>(
      `/analytics/time-performance?days=${days}${siteScopeId ? `&siteId=${encodeURIComponent(siteScopeId)}` : ""}`,
    ),
  ]);
  const contentPerformance = await getAnalyticsApiList<ContentPerformanceSummary>(
    `/analytics/content-performance?days=${days}${siteScopeId ? `&siteId=${encodeURIComponent(siteScopeId)}` : ""}`,
  );

  return {
    days: range.days,
    selectedPreset,
    compareMode,
    rangeLabel: range.label,
    range,
    comparisonRange,
    overview,
    comparisonOverview,
    sites,
    selectedSite,
    siteAnalytics,
    campaigns: campaignsPayload.items,
    selectedCampaign,
    countryPerformance,
    sitePerformance,
    timePerformance,
    contentPerformance,
  };
}

// Returns an empty list (never invented data) when the API call fails --
// a prior version silently substituted realistic-looking hardcoded numbers
// here, which made a real backend outage indistinguishable from genuine
// analytics on every report page.
async function getAnalyticsApiList<T>(path: string): Promise<T[]> {
  const response = await apiJson<{ success: true; data: T[] }>(path);
  if (!response?.data) {
    console.error(`[analytics] failed to load ${path}`);
    return [];
  }

  return response.data;
}

// Single-report fetchers for the dedicated /analytics/* pages -- each pulls
// only what that page needs instead of the full getAnalyticsDashboardData
// bundle (sites, campaigns, overview, every performance breakdown at once).
// Each takes the *resolved* range (always concrete startDate/endDate, even
// for presets) rather than just a day count, so a custom range actually
// filters by the calendar dates the admin picked instead of "the last N
// days from right now."

function rangeQueryParams(range: AnalyticsDateRange, siteId?: string): string {
  const search = new URLSearchParams();
  search.set("days", String(range.days));
  search.set("startDate", range.startDate);
  search.set("endDate", range.endDate);
  if (siteId) {
    search.set("siteId", siteId);
  }
  return search.toString();
}

export async function getSitePerformancePage(range: AnalyticsDateRange, siteId?: string): Promise<SitePerformanceSummary[]> {
  return getAnalyticsApiList<SitePerformanceSummary>(`/analytics/sites-performance?${rangeQueryParams(range, siteId)}`);
}

export async function getCountryPerformancePage(range: AnalyticsDateRange, siteId?: string): Promise<CountryPerformanceSummary[]> {
  return getAnalyticsApiList<CountryPerformanceSummary>(`/analytics/countries?${rangeQueryParams(range, siteId)}`);
}

export async function getContentPerformancePage(range: AnalyticsDateRange, siteId?: string): Promise<ContentPerformanceSummary[]> {
  return getAnalyticsApiList<ContentPerformanceSummary>(`/analytics/content-performance?${rangeQueryParams(range, siteId)}`);
}

export async function getTimePerformancePage(range: AnalyticsDateRange, siteId?: string): Promise<TimePerformanceSummary[]> {
  return getAnalyticsApiList<TimePerformanceSummary>(`/analytics/time-performance?${rangeQueryParams(range, siteId)}`);
}

export async function getPeakHoursPage(range: AnalyticsDateRange, siteId?: string): Promise<PeakHourSummary[]> {
  return getAnalyticsApiList<PeakHourSummary>(`/analytics/peak-hours?${rangeQueryParams(range, siteId)}`);
}

export async function getCampaignPerformancePage(
  range: AnalyticsDateRange,
  siteId?: string,
  campaignId?: string,
): Promise<CampaignPerformanceStats | null> {
  const search = new URLSearchParams();
  search.set("days", String(range.days));
  search.set("startDate", range.startDate);
  search.set("endDate", range.endDate);
  if (siteId) search.set("siteId", siteId);
  if (campaignId) search.set("campaignId", campaignId);

  const response = await apiJson<{ success: true; data: CampaignPerformanceStats }>(`/analytics/campaign-performance?${search.toString()}`);
  return response?.data ?? null;
}

export async function getGa4CampaignLandingPerformancePage(
  range: AnalyticsDateRange,
  siteId?: string,
  campaignId?: string,
): Promise<Ga4CampaignLandingPerformance> {
  const search = new URLSearchParams({ startDate: range.startDate, endDate: range.endDate });
  if (siteId) search.set("siteId", siteId);
  if (campaignId) search.set("campaignId", campaignId);
  const response = await apiJson<{ success: true; data: Ga4CampaignLandingPerformance }>(`/analytics/ga4-campaign-performance?${search.toString()}`);
  return response?.data ?? { status: "unavailable", totalUsers: 0, newUsers: 0, returningUsers: 0, sessions: 0, engagedSessions: 0, keyEvents: 0, message: "GA4 landing data is temporarily unavailable." };
}
