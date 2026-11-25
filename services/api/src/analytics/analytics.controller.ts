import crypto from "node:crypto";

import { BadRequestException, Body, Controller, Get, Param, Post, Query, Res, UseGuards } from "@nestjs/common";

import { Roles } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { AnalyticsService } from "./analytics.service";
import { Ga4ConnectionsService } from "./ga4-connections.service";
import { UpsertGa4ConnectionDto } from "./dto/upsert-ga4-connection.dto";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { ListFailedDeliveriesQueryDto } from "./dto/list-failed-deliveries-query.dto";
import { GoogleSheetsClient } from "./google-sheets.client";
import { isGoogleSheetsExportConfigured } from "./google-sheets.config";

interface CsvResponseLike {
  setHeader(name: string, value: string): void;
}

type ExportReportKey = "overview" | "countries" | "sites-performance" | "time-performance" | "content-performance";

interface GoogleSheetsExportStatePayload {
  report: ExportReportKey;
  days: number;
}

function encodeState(nonce: string, payload: GoogleSheetsExportStatePayload): string {
  return `${nonce}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
}

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Both query params are user-suppliable free text -- validate the shape here,
// at the boundary, rather than letting a malformed value reach the
// repository's `new Date(...)` calls (an invalid date there throws a
// RangeError on .toISOString(), a 500 instead of a clear 400).
function parseDateRangeQuery(startDate?: string, endDate?: string): { startDate?: string; endDate?: string } | undefined {
  if (!startDate && !endDate) {
    return undefined;
  }

  if (startDate && !DATE_ONLY_PATTERN.test(startDate)) {
    throw new BadRequestException("startDate must be in YYYY-MM-DD format");
  }

  if (endDate && !DATE_ONLY_PATTERN.test(endDate)) {
    throw new BadRequestException("endDate must be in YYYY-MM-DD format");
  }

  return {
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
  };
}

function decodeState(state: string): { nonce: string; payload: GoogleSheetsExportStatePayload } {
  const separatorIndex = state.indexOf(".");
  if (separatorIndex === -1) {
    throw new BadRequestException("Malformed OAuth state");
  }

  const nonce = state.slice(0, separatorIndex);
  try {
    const payload = JSON.parse(Buffer.from(state.slice(separatorIndex + 1), "base64url").toString("utf8")) as GoogleSheetsExportStatePayload;
    return { nonce, payload };
  } catch {
    throw new BadRequestException("Malformed OAuth state");
  }
}

@Controller("analytics")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("super-admin", "admin", "sub-admin")
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly googleSheetsClient: GoogleSheetsClient,
    private readonly ga4ConnectionsService?: Ga4ConnectionsService,
  ) {}

  @Get("ga4-connections")
  @Roles("super-admin")
  async listGa4Connections(): Promise<{ success: true; data: unknown }> {
    return { success: true, data: await this.ga4ConnectionsService?.list() ?? [] };
  }

  @Post("ga4-connections")
  @Roles("super-admin")
  async saveGa4Connection(@Body() dto: UpsertGa4ConnectionDto, @CurrentUser() user: AuthenticatedUser): Promise<{ success: true; data: unknown }> {
    if (!this.ga4ConnectionsService) {
      throw new BadRequestException("GA4 connections are unavailable");
    }
    return { success: true, data: await this.ga4ConnectionsService.upsert(dto, user.id) };
  }

  @Get("overview")
  async getOverview(
    @Query("days") days?: string,
    @Query("siteId") siteId?: string,
    @Query("startDate") startDate?: string,
    @Query("endDate") endDate?: string,
  ): Promise<{ success: true; data: unknown }> {
    const overview = await this.analyticsService.getOverview(days ? parseInt(days, 10) : 30, siteId, parseDateRangeQuery(startDate, endDate));
    return { success: true, data: overview };
  }

  @Get("campaign-performance")
  async getAggregatedCampaignStats(
    @Query("days") days?: string,
    @Query("siteId") siteId?: string,
    @Query("campaignId") campaignId?: string,
    @Query("startDate") startDate?: string,
    @Query("endDate") endDate?: string,
  ): Promise<{ success: true; data: unknown }> {
    const stats = await this.analyticsService.getAggregatedCampaignStats(
      days ? parseInt(days, 10) : 30,
      siteId,
      campaignId,
      parseDateRangeQuery(startDate, endDate),
    );
    return { success: true, data: stats };
  }

  @Get("ga4-campaign-performance")
  async getGa4CampaignLandingPerformance(
    @Query("siteId") siteId?: string,
    @Query("campaignId") campaignId?: string,
    @Query("startDate") startDate?: string,
    @Query("endDate") endDate?: string,
  ): Promise<{ success: true; data: unknown }> {
    const range = parseDateRangeQuery(startDate, endDate);
    const end = range?.endDate ?? new Date().toISOString().slice(0, 10);
    const start = range?.startDate ?? end;
    return {
      success: true,
      data: await this.analyticsService.getGa4CampaignLandingPerformance({
        ...(siteId ? { siteId } : {}),
        ...(campaignId ? { campaignId } : {}),
        startDate: start,
        endDate: end,
      }),
    };
  }

  // Bulk variant of campaigns/:campaignId so list pages can hydrate a whole
  // page of rows with one request. `ids` is a comma-separated list.
  @Get("campaigns")
  async getCampaignStatsBulk(@Query("ids") ids?: string): Promise<{ success: true; data: unknown }> {
    // campaign_id is a uuid column; anything else would abort the whole
    // query with a cast error, so drop malformed ids instead.
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const campaignIds = (ids ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter((id) => uuidPattern.test(id));
    const stats = await this.analyticsService.getCampaignStatsBulk(campaignIds);
    return { success: true, data: stats };
  }

  @Get("campaigns/:campaignId")
  async getCampaignStats(
    @Param("campaignId") campaignId: string,
  ): Promise<{ success: true; data: unknown }> {
    const stats = await this.analyticsService.getCampaignStats(campaignId);
    return { success: true, data: stats };
  }

  @Get("campaigns/:campaignId/variants")
  async getCampaignVariantStats(@Param("campaignId") campaignId: string): Promise<{ success: true; data: unknown }> {
    return { success: true, data: await this.analyticsService.getCampaignVariantStats(campaignId) };
  }

  @Get("sites/:siteId")
  async getSiteOverview(
    @Param("siteId") siteId: string,
    @Query("days") days?: string,
  ): Promise<{ success: true; data: unknown }> {
    const overview = await this.analyticsService.getSiteOverview(siteId, days ? parseInt(days, 10) : 30);
    return { success: true, data: overview };
  }

  @Get("sites/:siteId/subscriber-growth")
  async getSubscriberGrowth(
    @Param("siteId") siteId: string,
    @Query("days") days?: string,
  ): Promise<{ success: true; data: unknown }> {
    const growth = await this.analyticsService.getSubscriberGrowth(siteId, days ? parseInt(days, 10) : 30);
    return { success: true, data: growth };
  }

  @Get("countries")
  async getCountryPerformance(
    @Query("days") days?: string,
    @Query("siteId") siteId?: string,
    @Query("startDate") startDate?: string,
    @Query("endDate") endDate?: string,
  ): Promise<{ success: true; data: unknown }> {
    const performance = await this.analyticsService.getCountryPerformance(days ? parseInt(days, 10) : 30, siteId, parseDateRangeQuery(startDate, endDate));
    return { success: true, data: performance };
  }

  @Get("sites-performance")
  async getSitePerformance(
    @Query("days") days?: string,
    @Query("siteId") siteId?: string,
    @Query("startDate") startDate?: string,
    @Query("endDate") endDate?: string,
  ): Promise<{ success: true; data: unknown }> {
    const performance = await this.analyticsService.getSitePerformance(days ? parseInt(days, 10) : 30, siteId, parseDateRangeQuery(startDate, endDate));
    return { success: true, data: performance };
  }

  @Get("time-performance")
  async getTimePerformance(
    @Query("days") days?: string,
    @Query("siteId") siteId?: string,
    @Query("startDate") startDate?: string,
    @Query("endDate") endDate?: string,
  ): Promise<{ success: true; data: unknown }> {
    const performance = await this.analyticsService.getTimePerformance(days ? parseInt(days, 10) : 30, siteId, parseDateRangeQuery(startDate, endDate));
    return { success: true, data: performance };
  }

  @Get("peak-hours")
  async getPeakHours(
    @Query("days") days?: string,
    @Query("siteId") siteId?: string,
    @Query("startDate") startDate?: string,
    @Query("endDate") endDate?: string,
  ): Promise<{ success: true; data: unknown }> {
    const performance = await this.analyticsService.getPeakHours(days ? parseInt(days, 10) : 30, siteId, parseDateRangeQuery(startDate, endDate));
    return { success: true, data: performance };
  }

  @Get("content-performance")
  async getContentPerformance(
    @Query("days") days?: string,
    @Query("siteId") siteId?: string,
    @Query("startDate") startDate?: string,
    @Query("endDate") endDate?: string,
  ): Promise<{ success: true; data: unknown }> {
    const performance = await this.analyticsService.getContentPerformance(days ? parseInt(days, 10) : 30, siteId, parseDateRangeQuery(startDate, endDate));
    return { success: true, data: performance };
  }

  @Get("failed-deliveries")
  async listFailedDeliveries(@Query() query: ListFailedDeliveriesQueryDto): Promise<{ success: true; data: unknown }> {
    const result = await this.analyticsService.listFailedDeliveries({
      ...(query.siteId ? { siteId: query.siteId } : {}),
      ...(query.pushType ? { pushType: query.pushType } : {}),
      ...(query.reason ? { reason: query.reason } : {}),
      limit: query.limit ?? 25,
      offset: query.offset ?? 0,
    });
    return { success: true, data: result };
  }

  @Get("failed-deliveries/reasons")
  async listFailureReasons(): Promise<{ success: true; data: unknown }> {
    return { success: true, data: await this.analyticsService.listFailureReasons() };
  }

  @Get("delivery-incidents")
  async listDeliveryIncidents(@Query("limit") limit?: string): Promise<{ success: true; data: unknown }> {
    return { success: true, data: await this.analyticsService.listDeliveryIncidents(limit ? parseInt(limit, 10) : 50) };
  }

  @Get("export")
  async exportReport(
    @Res({ passthrough: true }) response: CsvResponseLike,
    @Query("days") days?: string,
    @Query("report") report?: "overview" | "countries" | "sites-performance" | "time-performance" | "content-performance",
    @Query("format") format?: "csv" | "xlsx" | "pdf",
  ): Promise<string | Buffer> {
    const result = await this.analyticsService.exportReport({
      days: days ? parseInt(days, 10) : 30,
      report: report ?? "overview",
      ...(format ? { format } : {}),
    });

    response.setHeader("content-type", result.contentType);
    response.setHeader("content-disposition", `attachment; filename="${result.filename}"`);
    return result.body;
  }

  @Get("export/google-sheets/status")
  getGoogleSheetsExportStatus(): { success: true; data: { configured: boolean } } {
    return { success: true, data: { configured: isGoogleSheetsExportConfigured() } };
  }

  @Get("export/google-sheets/authorize-url")
  getGoogleSheetsAuthorizeUrl(
    @Query("report") report: ExportReportKey = "overview",
    @Query("days") days?: string,
  ): { success: true; data: { authorizeUrl: string; state: string } } {
    const nonce = crypto.randomBytes(24).toString("hex");
    const state = encodeState(nonce, { report, days: days ? parseInt(days, 10) : 30 });

    return { success: true, data: { authorizeUrl: this.googleSheetsClient.buildAuthorizeUrl(state), state } };
  }

  @Post("export/google-sheets/exchange")
  async exchangeGoogleSheetsCode(
    @Body("code") code: string,
    @Body("state") state: string,
  ): Promise<{ success: true; data: { spreadsheetUrl: string } }> {
    if (!code || !state) {
      throw new BadRequestException("Missing code or state");
    }

    const { payload } = decodeState(state);
    const accessToken = await this.googleSheetsClient.exchangeCode(code);
    const rows = await this.analyticsService.getReportRows(payload);
    const title = `Exotic Push Engine — ${payload.report} (${payload.days}d) — ${new Date().toISOString().slice(0, 10)}`;
    const spreadsheetUrl = await this.googleSheetsClient.createSpreadsheet(accessToken, title, rows.headers, rows.rows);

    return { success: true, data: { spreadsheetUrl } };
  }
}
