import { Injectable } from "@nestjs/common";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";

import { AnalyticsRepository, type FailedDeliveryFilters } from "./analytics.repository";
import { Ga4DataClient } from "./ga4-data.client";

@Injectable()
export class AnalyticsService {
  constructor(private readonly analyticsRepository: AnalyticsRepository, private readonly ga4DataClient?: Ga4DataClient) {}

  async getGa4CampaignLandingPerformance(input: { siteId?: string; campaignId?: string; startDate: string; endDate: string }) {
    if (!input.siteId || !input.campaignId) {
      return { status: "not_configured" as const, totalUsers: 0, newUsers: 0, returningUsers: 0, sessions: 0, engagedSessions: 0, keyEvents: 0, message: "Choose one site and one campaign to view GA4 landing data." };
    }
    const siteUrl = await this.analyticsRepository.getSiteUrl(input.siteId);
    if (!siteUrl) {
      return { status: "unavailable" as const, totalUsers: 0, newUsers: 0, returningUsers: 0, sessions: 0, engagedSessions: 0, keyEvents: 0, message: "The selected site could not be found." };
    }
    if (!this.ga4DataClient) {
      return { status: "not_configured" as const, totalUsers: 0, newUsers: 0, returningUsers: 0, sessions: 0, engagedSessions: 0, keyEvents: 0, message: "GA4 reporting is not configured for this site." };
    }
    return this.ga4DataClient.getCampaignLandingPerformance({ siteUrl, campaignId: input.campaignId, startDate: input.startDate, endDate: input.endDate });
  }

  async getCampaignStats(campaignId: string) {
    return this.analyticsRepository.getCampaignStats(campaignId);
  }

  async getCampaignVariantStats(campaignId: string) {
    return this.analyticsRepository.getCampaignVariantStats(campaignId);
  }

  async getCampaignStatsBulk(campaignIds: string[]) {
    return this.analyticsRepository.getCampaignStatsBulk(campaignIds);
  }

  async getSiteOverview(siteId: string, days = 30) {
    const [overview, delivery, growth] = await Promise.all([
      this.analyticsRepository.getSiteOverview(siteId),
      this.analyticsRepository.getSiteDeliveryStats(siteId, days),
      this.analyticsRepository.getSubscriberGrowth(siteId, days),
    ]);

    return {
      ...overview,
      last30Days: {
        ...delivery,
        subscriberGrowth: growth,
      },
    };
  }

  async getSubscriberGrowth(siteId: string, days = 30) {
    return this.analyticsRepository.getSubscriberGrowth(siteId, days);
  }

  async getOverview(days = 30, siteId?: string, dateRange?: { startDate?: string; endDate?: string }) {
    return this.analyticsRepository.getOverview(days, siteId, dateRange);
  }

  async getAggregatedCampaignStats(days = 30, siteId?: string, campaignId?: string, dateRange?: { startDate?: string; endDate?: string }) {
    return this.analyticsRepository.getAggregatedCampaignStats(days, siteId, campaignId, dateRange);
  }

  async getCountryPerformance(days = 30, siteId?: string, dateRange?: { startDate?: string; endDate?: string }) {
    return this.analyticsRepository.getCountryPerformance(days, siteId, dateRange);
  }

  async getSitePerformance(days = 30, siteId?: string, dateRange?: { startDate?: string; endDate?: string }) {
    return this.analyticsRepository.getSitePerformance(days, siteId, dateRange);
  }

  async getTimePerformance(days = 30, siteId?: string, dateRange?: { startDate?: string; endDate?: string }) {
    return this.analyticsRepository.getTimePerformance(days, siteId, dateRange);
  }

  async getPeakHours(days = 30, siteId?: string, dateRange?: { startDate?: string; endDate?: string }) {
    return this.analyticsRepository.getPeakHours(days, siteId, dateRange);
  }

  async getContentPerformance(days = 30, siteId?: string, dateRange?: { startDate?: string; endDate?: string }) {
    return this.analyticsRepository.getContentPerformance(days, siteId, dateRange);
  }

  async listFailedDeliveries(filters: FailedDeliveryFilters) {
    return this.analyticsRepository.listFailedDeliveries(filters);
  }

  async listFailureReasons() {
    return this.analyticsRepository.listFailureReasons();
  }

  async listDeliveryIncidents(limit = 50) {
    return this.analyticsRepository.listDeliveryIncidents(limit);
  }

  async exportReport(input: {
    report: "overview" | "countries" | "sites-performance" | "time-performance" | "content-performance";
    days: number;
    format?: "csv" | "xlsx" | "pdf";
  }): Promise<{ filename: string; contentType: string; body: string | Buffer }> {
    const rows = await this.resolveExportRows(input);
    const format = input.format ?? "csv";

    if (format === "xlsx") {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "Exotic Push Engine";
      workbook.created = new Date();

      const worksheet = workbook.addWorksheet(this.buildWorksheetName(input.report));
      worksheet.columns = rows.headers.map((header) => ({ header, key: header, width: Math.max(14, header.length + 4) }));
      for (const row of rows.rows) {
        worksheet.addRow(
          rows.headers.reduce<Record<string, string | number>>((accumulator, header, index) => {
            accumulator[header] = row[index] ?? "";
            return accumulator;
          }, {}),
        );
      }
      worksheet.getRow(1).font = { bold: true };
      worksheet.views = [{ state: "frozen", ySplit: 1 }];
      const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

      return {
        filename: `analytics-${input.report}-${input.days}d.xlsx`,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        body: buffer,
      };
    }

    if (format === "pdf") {
      const buffer = await this.toPdfBuffer(rows.headers, rows.rows, input);
      return {
        filename: `analytics-${input.report}-${input.days}d.pdf`,
        contentType: "application/pdf",
        body: buffer,
      };
    }

    const csv = this.toCsv(rows.headers, rows.rows);
    return {
      filename: `analytics-${input.report}-${input.days}d.csv`,
      contentType: "text/csv; charset=utf-8",
      body: csv,
    };
  }

  async getReportRows(input: {
    report: "overview" | "countries" | "sites-performance" | "time-performance" | "content-performance";
    days: number;
  }): Promise<{ headers: string[]; rows: Array<Array<string | number>> }> {
    return this.resolveExportRows(input);
  }

  private async resolveExportRows(input: {
    report: "overview" | "countries" | "sites-performance" | "time-performance" | "content-performance";
    days: number;
  }): Promise<{ headers: string[]; rows: Array<Array<string | number>> }> {
    switch (input.report) {
      case "countries": {
        const rows = await this.getCountryPerformance(input.days);
        return {
          headers: ["country", "totalSubscribers", "totalDelivered", "totalSent", "totalFailed", "totalExpired", "totalClicked", "deliveryRate", "clickThroughRate"],
          rows: rows.map((row) => [row.country, row.totalSubscribers, row.totalDelivered, row.totalSent, row.totalFailed, row.totalExpired, row.totalClicked, row.deliveryRate, row.clickThroughRate]),
        };
      }
      case "sites-performance": {
        const rows = await this.getSitePerformance(input.days);
        return {
          headers: ["siteName", "siteId", "totalSubscribers", "totalDelivered", "totalSent", "totalFailed", "totalExpired", "totalClicked", "deliveryRate", "clickThroughRate"],
          rows: rows.map((row) => [row.siteName, row.siteId, row.totalSubscribers, row.totalDelivered, row.totalSent, row.totalFailed, row.totalExpired, row.totalClicked, row.deliveryRate, row.clickThroughRate]),
        };
      }
      case "time-performance": {
        const rows = await this.getTimePerformance(input.days);
        return {
          headers: ["bucket", "totalDelivered", "totalSent", "totalFailed", "totalClicked", "deliveryRate", "clickThroughRate"],
          rows: rows.map((row) => [row.bucket, row.totalDelivered, row.totalSent, row.totalFailed, row.totalClicked, row.deliveryRate, row.clickThroughRate]),
        };
      }
      case "content-performance": {
        const rows = await this.getContentPerformance(input.days);
        return {
          headers: ["contentType", "totalCampaigns", "totalDelivered", "totalSent", "totalFailed", "totalExpired", "totalClicked", "deliveryRate", "clickThroughRate"],
          rows: rows.map((row) => [row.contentType, row.totalCampaigns, row.totalDelivered, row.totalSent, row.totalFailed, row.totalExpired, row.totalClicked, row.deliveryRate, row.clickThroughRate]),
        };
      }
      case "overview":
      default: {
        const overview = await this.getOverview(input.days);
        return {
          headers: ["metric", "value"],
          rows: Object.entries(overview).map(([metric, value]) => [metric, value as string | number]),
        };
      }
    }
  }

  private toCsv(headers: string[], rows: Array<Array<string | number>>): string {
    const escape = (value: string | number): string => {
      const raw = String(value);
      if (/[",\n]/.test(raw)) {
        return `"${raw.replaceAll('"', '""')}"`;
      }
      return raw;
    };

    return [headers.map(escape).join(","), ...rows.map((row) => row.map(escape).join(","))].join("\n");
  }

  private buildWorksheetName(report: string): string {
    return report.replaceAll(/[^A-Za-z0-9]/g, " ").slice(0, 31) || "Analytics";
  }

  private async toPdfBuffer(
    headers: string[],
    rows: Array<Array<string | number>>,
    input: { report: string; days: number },
  ): Promise<Buffer> {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ size: "A4", margin: 40, autoFirstPage: true });

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));

    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
    });

    doc.fontSize(18).text(`Analytics ${input.report}`, { underline: false });
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor("#666666").text(`Reporting window: last ${input.days} days`);
    doc.moveDown();
    doc.fillColor("#111111");

    const columnCount = headers.length;
    const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const columnWidth = Math.max(Math.floor(usableWidth / Math.max(columnCount, 1)), 72);

    const drawRow = (values: Array<string | number>, bold = false) => {
      let x = doc.page.margins.left;
      let maxHeight = 0;
      values.forEach((value) => {
        const text = String(value);
        const height = doc.heightOfString(text, { width: columnWidth - 8 });
        maxHeight = Math.max(maxHeight, height);
      });

      if (doc.y + maxHeight + 12 > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
        doc.y = doc.page.margins.top;
        x = doc.page.margins.left;
      }

      values.forEach((value, index) => {
        const text = String(value);
        doc.font(bold ? "Helvetica-Bold" : "Helvetica")
          .fontSize(9)
          .text(text, x, doc.y, { width: columnWidth - 8, align: "left" });
        x += columnWidth;
        if (index < values.length - 1) {
          doc.moveTo(x - 4, doc.y).lineTo(x - 4, doc.y + maxHeight + 6).strokeColor("#E5E7EB").stroke();
        }
      });

      doc.moveDown(Math.max(1, Math.ceil((maxHeight + 10) / 12)));
    };

    drawRow(headers, true);
    rows.forEach((row) => drawRow(row));

    doc.end();
    return done;
  }
}
