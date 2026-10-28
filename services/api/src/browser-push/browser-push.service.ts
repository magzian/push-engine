import { Inject, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { Queue } from "bullmq";

import { AuditService } from "../audit/audit.service";
import { SitesService } from "../sites/sites.service";
import { BrowserPushRepository } from "./browser-push.repository";
import { BROWSER_PUSH_JOB_NAME, BROWSER_PUSH_QUEUE_NAME } from "./browser-push.constants";
import type { BrowserPushJobPayload } from "./browser-push.types";
import { CreateBrowserPushDispatchDto } from "./dto/create-browser-push-dispatch.dto";
import { withPushAnalyticsAttribution } from "./push-analytics-url";

export const BROWSER_PUSH_QUEUE = Symbol("BROWSER_PUSH_QUEUE");

export interface BrowserPushDispatchInput {
  jobId?: string;
  siteId: string;
  title: string;
  body: string;
  url: string;
  icon?: string | null;
  image?: string | null;
  campaignId?: string | null;
  automationId?: string | null;
  segmentId?: string | null;
  subscriberId?: string | null;
  variants?: Array<{ id: string; title: string; body: string; url: string; weight: number }>;
}

@Injectable()
export class BrowserPushService {
  constructor(
    private readonly sitesService: SitesService,
    private readonly browserPushRepository: BrowserPushRepository,
    private readonly auditService: AuditService,
    @Inject(BROWSER_PUSH_QUEUE) private readonly queue: Queue,
  ) {}

  async dispatch(dto: BrowserPushDispatchInput | CreateBrowserPushDispatchDto): Promise<{ jobId: string | undefined; queued: true }> {
    const site = await this.sitesService.getSite(dto.siteId);
    if (!site) {
      throw new NotFoundException("Site not found");
    }
    if (!site.vapidPublicKey || !site.vapidPrivateKey || !site.vapidSubject) {
      throw new ServiceUnavailableException("Browser push credentials are not configured for this site");
    }

    const payload: BrowserPushJobPayload = {
      siteId: site.id,
      campaignId: dto.campaignId ?? null,
      automationId: dto.automationId ?? null,
      segmentId: dto.segmentId ?? null,
      subscriberId: dto.subscriberId ?? null,
      variants: "variants" in dto ? dto.variants ?? [] : [],
      notification: {
        title: dto.title,
        body: dto.body,
        url: withPushAnalyticsAttribution(dto.url, dto),
        // The icon slot is the notification's visual identity in every
        // browser (the large `image` only renders on some platforms), and
        // senders -- campaigns, automations, the REST API -- often provide
        // only an image. Fall back to it so the subscriber sees the push's
        // own artwork; the service worker falls back to the site icon when
        // both are absent.
        icon: dto.icon ?? dto.image ?? null,
        image: dto.image ?? null,
      },
      enqueuedAt: new Date().toISOString(),
    };

    if (payload.variants) {
      payload.variants = payload.variants.map((variant) => ({
        ...variant,
        url: withPushAnalyticsAttribution(variant.url, dto),
      }));
    }

    const job = await this.queue.add(
      BROWSER_PUSH_JOB_NAME,
      payload,
      "jobId" in dto && dto.jobId ? { jobId: dto.jobId } : undefined,
    );

    return {
      jobId: job.id,
      queued: true,
    };
  }

  async clearFailedDeliveries(actorUserId?: string): Promise<number> {
    const cleared = await this.browserPushRepository.clearFailedDeliveries();

    await this.auditService.log({
      actorUserId: actorUserId ?? null,
      action: "platform.failed_deliveries_cleared",
      targetType: "platform",
      targetId: "push_delivery_events",
      metadata: { cleared },
    });

    return cleared;
  }

  async retryTransientFailures(input: { siteId?: string; limit?: number }, actorUserId?: string): Promise<{ queued: number }> {
    const limit = Math.min(Math.max(input.limit ?? 1_000, 1), 5_000);
    const deliveries = await this.browserPushRepository.claimRetryableTransientDeliveries({
      ...(input.siteId ? { siteId: input.siteId } : {}),
      limit,
    });

    if (deliveries.length === 0) {
      return { queued: 0 };
    }

    let jobs: Array<{ id?: string }>;
    try {
      jobs = await this.queue.addBulk(deliveries.map((delivery) => ({
        name: BROWSER_PUSH_JOB_NAME,
        data: {
          siteId: delivery.siteId,
          campaignId: delivery.campaignId,
          automationId: delivery.automationId,
          subscriberId: delivery.subscriberId,
          retrySourceEventId: delivery.id,
          notification: {
            title: delivery.notification.title,
            body: delivery.notification.body,
            url: delivery.notification.url,
            icon: delivery.notification.icon ?? null,
            image: delivery.notification.image ?? null,
          },
          enqueuedAt: new Date().toISOString(),
        } satisfies BrowserPushJobPayload,
      })));
    } catch (error) {
      await this.browserPushRepository.releaseRetryClaims(deliveries.map((delivery) => delivery.id));
      throw error;
    }

    await this.browserPushRepository.markDeliveriesRetried(
      deliveries.flatMap((delivery, index) => jobs[index]?.id ? [{ deliveryId: delivery.id, jobId: jobs[index]!.id! }] : []),
    );

    await this.auditService.log({
      actorUserId: actorUserId ?? null,
      action: "platform.transient_deliveries_retried",
      targetType: "platform",
      targetId: "push_delivery_events",
      metadata: { queued: jobs.length, siteId: input.siteId ?? null },
    });

    return { queued: jobs.length };
  }

  async clearAllDeliveryHistory(actorUserId?: string): Promise<number> {
    const cleared = await this.browserPushRepository.clearAllDeliveryHistory();

    await this.auditService.log({
      actorUserId: actorUserId ?? null,
      action: "platform.all_delivery_history_cleared",
      targetType: "platform",
      targetId: "push_delivery_events",
      metadata: { cleared },
    });

    return cleared;
  }
}
