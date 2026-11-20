import crypto from "node:crypto";

import { Injectable } from "@nestjs/common";

import { findGa4PropertyId, loadGa4ServiceAccountConfig } from "./ga4-data.config";

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

const empty = (status: Ga4CampaignLandingPerformance["status"], message?: string): Ga4CampaignLandingPerformance => ({
  status,
  totalUsers: 0,
  newUsers: 0,
  returningUsers: 0,
  sessions: 0,
  engagedSessions: 0,
  keyEvents: 0,
  ...(message ? { message } : {}),
});

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

@Injectable()
export class Ga4DataClient {
  async getCampaignLandingPerformance(input: { siteUrl: string; campaignId: string; startDate: string; endDate: string }): Promise<Ga4CampaignLandingPerformance> {
    const config = loadGa4ServiceAccountConfig();
    const propertyId = findGa4PropertyId(input.siteUrl, config);
    if (!config || !propertyId) return empty("not_configured", "GA4 reporting is not configured for this site.");

    try {
      const accessToken = await this.getAccessToken(config.clientEmail, config.privateKey);
      const filter = {
        andGroup: {
          expressions: [
            { filter: { fieldName: "sessionSourceMedium", stringFilter: { matchType: "EXACT", value: "push_engine / push" } } },
            { filter: { fieldName: "sessionCampaignId", stringFilter: { matchType: "EXACT", value: input.campaignId } } },
          ],
        },
      };
      const [overallResponse, visitorTypeResponse] = await Promise.all([
        this.runReport(accessToken, propertyId, {
          dateRanges: [{ startDate: input.startDate, endDate: input.endDate }],
          metrics: ["totalUsers", "sessions", "engagedSessions", "keyEvents"].map((name) => ({ name })),
          dimensionFilter: filter,
        }),
        this.runReport(accessToken, propertyId, {
          dateRanges: [{ startDate: input.startDate, endDate: input.endDate }],
          dimensions: [{ name: "newVsReturning" }],
          metrics: [{ name: "totalUsers" }],
          dimensionFilter: filter,
        }),
      ]);
      if (!overallResponse.ok || !visitorTypeResponse.ok) return empty("unavailable", "GA4 could not return this campaign's landing data yet.");

      const overall = await overallResponse.json() as { rows?: Array<{ metricValues?: Array<{ value?: string }> }> };
      const visitorTypes = await visitorTypeResponse.json() as { rows?: Array<{ dimensionValues?: Array<{ value?: string }>; metricValues?: Array<{ value?: string }> }> };
      const values = overall.rows?.[0]?.metricValues?.map((value) => Number(value.value ?? 0)) ?? [];
      const classifiedUsers = new Map(visitorTypes.rows?.map((row) => [row.dimensionValues?.[0]?.value, Number(row.metricValues?.[0]?.value ?? 0)]) ?? []);
      return {
        status: "available",
        totalUsers: values[0] ?? 0,
        newUsers: classifiedUsers.get("new") ?? 0,
        returningUsers: classifiedUsers.get("returning") ?? 0,
        sessions: values[1] ?? 0,
        engagedSessions: values[2] ?? 0,
        keyEvents: values[3] ?? 0,
      };
    } catch {
      return empty("unavailable", "GA4 could not return this campaign's landing data yet.");
    }
  }

  private async runReport(accessToken: string, propertyId: string, body: unknown): Promise<Response> {
    return fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  private async getAccessToken(clientEmail: string, privateKey: string): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const unsignedToken = `${base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64Url(JSON.stringify({ iss: clientEmail, scope: "https://www.googleapis.com/auth/analytics.readonly", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }))}`;
    const signature = crypto.createSign("RSA-SHA256").update(unsignedToken).end().sign(privateKey);
    const assertion = `${unsignedToken}.${base64Url(signature)}`;
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    });
    if (!response.ok) throw new Error("Could not authenticate to GA4 Data API");
    const payload = await response.json() as { access_token?: string };
    if (!payload.access_token) throw new Error("GA4 Data API did not return an access token");
    return payload.access_token;
  }
}
