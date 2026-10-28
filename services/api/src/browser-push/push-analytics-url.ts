export interface PushAnalyticsAttribution {
  campaignId?: string | null;
  automationId?: string | null;
}

/**
 * Produces the destination URL that a subscriber opens from a browser push.
 * These are deliberately applied by EPE, rather than by a site integration,
 * so CRM, dashboard, scheduled, and WordPress sends share one GA4 convention.
 */ 
export function withPushAnalyticsAttribution(
  rawUrl: string,
  attribution: PushAnalyticsAttribution,
): string {
  const url = new URL(rawUrl);
  url.searchParams.set("utm_source", "push_engine");
  url.searchParams.set("utm_medium", "push");

  const campaign = attribution.campaignId
    ?? (attribution.automationId ? `automation-${attribution.automationId}` : null);
  if (campaign) {
    url.searchParams.set("utm_campaign", campaign);
  }

  return url.toString();
}
