export interface PushAnalyticsAttribution {
  campaignId?: string | null;
  automationId?: string | null;
}

/**
 * Produces the destination URL that a subscriber opens from a browser push.
 * These are deliberately applied by EPE, rather than by a site integration,
 * so CRM, dashboard, scheduled, and WordPress sends share one GA4 convention.
 * Existing UTM values are caller-owned and intentionally take precedence.
 */
export function withPushAnalyticsAttribution(
  rawUrl: string,
  attribution: PushAnalyticsAttribution,
): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return rawUrl;
  }

  if (!url.searchParams.has("utm_source")) {
    url.searchParams.set("utm_source", "push_engine");
  }
  if (!url.searchParams.has("utm_medium")) {
    url.searchParams.set("utm_medium", "push");
  }

  const campaign = attribution.campaignId
    ?? (attribution.automationId ? `automation-${attribution.automationId}` : null);
  if (campaign && !url.searchParams.has("utm_id")) {
    url.searchParams.set("utm_id", campaign);
  }

  return url.toString();
}
