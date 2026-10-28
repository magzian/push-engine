import { Controller, Get, NotFoundException, Param, Query, Inject } from "@nestjs/common";
import type { Pool } from "pg";

import { withPushAnalyticsAttribution } from "../browser-push/push-analytics-url";
import { DATABASE_POOL } from "../database/database.constants";
import type { SitePublicConfigRecord } from "./sites.types";
import { SitesService } from "./sites.service";

@Controller("sites/public")
export class PublicSitesController {
  constructor(
    private readonly sitesService: SitesService,
    @Inject(DATABASE_POOL) private readonly pool: Pool,
  ) {}

  @Get(":id")
  async getPublicConfig(@Param("id") id: string): Promise<{ success: true; data: SitePublicConfigRecord }> {
    const site = await this.sitesService.getSite(id);

    if (site.status !== "active") {
      throw new NotFoundException("Site not found");
    }

    await this.sitesService.recordConnection(site.id);

    return {
      success: true,
      data: {
        id: site.id,
        appName: site.appName,
        iconUrl: site.iconUrl,
        themeColor: site.themeColor,
        vapidPublicKey: site.vapidPublicKey,
        status: site.status,
        optInPromptType: site.optInPromptType,
        optInPromptAnimation: site.optInPromptAnimation,
        optInPromptBackgroundColor: site.optInPromptBackgroundColor,
        optInPromptHeadline: site.optInPromptHeadline,
        optInPromptHeadlineTextColor: site.optInPromptHeadlineTextColor,
        optInPromptText: site.optInPromptText,
        optInPromptTextColor: site.optInPromptTextColor,
        optInPromptIconUrl: site.optInPromptIconUrl,
        optInPromptCancelButtonLabel: site.optInPromptCancelButtonLabel,
        optInPromptCancelButtonTextColor: site.optInPromptCancelButtonTextColor,
        optInPromptCancelButtonBackgroundColor: site.optInPromptCancelButtonBackgroundColor,
        optInPromptApproveButtonLabel: site.optInPromptApproveButtonLabel,
        optInPromptApproveButtonTextColor: site.optInPromptApproveButtonTextColor,
        optInPromptApproveButtonBackgroundColor: site.optInPromptApproveButtonBackgroundColor,
        optInPromptRepromptDelayDays: site.optInPromptRepromptDelayDays,
        optInPromptRecentNotificationsLimit: site.optInPromptRecentNotificationsLimit,
        optInPromptDisplayMode: site.optInPromptDisplayMode,
        optInPromptScrollPercent: site.optInPromptScrollPercent,
        optInPromptPageViewCount: site.optInPromptPageViewCount,
      },
    };
  }

  @Get(":id/notifications")
  async getRecentNotifications(
    @Param("id") id: string,
    @Query("limit") limit?: string,
  ): Promise<{
    success: true;
    data: Array<{
      id: string;
      title: string;
      message: string;
      url: string;
      iconUrl: string | null;
      sentAt: string | null;
    }>;
  }> {
    const site = await this.sitesService.getSite(id);
    if (site.status !== "active") {
      throw new NotFoundException("Site not found");
    }

    const count = Math.min(
      Math.max(Number(limit ?? site.optInPromptRecentNotificationsLimit ?? 3) || 3, 1),
      10,
    );
    const { rows } = await this.pool.query<{
      id: string;
      title: string;
      message: string;
      url: string;
      icon_url: string | null;
      sent_at: string | null;
    }>(
      `
      SELECT id, title, message, url, icon_url, sent_at
      FROM campaigns
      WHERE site_id = $1
        AND sent_at IS NOT NULL
      ORDER BY sent_at DESC
      LIMIT $2
      `,
      [site.id, count],
    );

    return {
      success: true,
      data: rows.map((campaign) => ({
        id: campaign.id,
        title: campaign.title,
        message: campaign.message,
        // The bell tray is another push entry point. Return the same tracked
        // destination as the browser notification so clicks remain attributable
        // in GA4 regardless of where the subscriber opens the campaign.
        url: withPushAnalyticsAttribution(campaign.url, { campaignId: campaign.id }),
        iconUrl: campaign.icon_url,
        sentAt: campaign.sent_at,
      })),
    };
  }
}
