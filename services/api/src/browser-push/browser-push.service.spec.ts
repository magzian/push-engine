import assert from "node:assert/strict";
import test from "node:test";

import { BrowserPushService } from "./browser-push.service";
import type { BrowserPushJobPayload } from "./browser-push.types";
import { withPushAnalyticsAttribution } from "./push-analytics-url";

test("push analytics attribution uses GA4's canonical mobile-push parameters", () => {
  const tracked = new URL(withPushAnalyticsAttribution(
    "https://www.exotic-tz.net/escort/mbeya-sensual-massage/?locale=sw#gallery",
    { campaignId: "campaign-123" },
  ));

  assert.equal(tracked.searchParams.get("locale"), "sw");
  assert.equal(tracked.searchParams.get("utm_source"), "push_engine");
  assert.equal(tracked.searchParams.get("utm_medium"), "push");
  assert.equal(tracked.searchParams.get("utm_campaign"), "campaign-123");
  assert.equal(tracked.hash, "#gallery");
});

test("push analytics attribution preserves caller-provided UTM values", () => {
  const tracked = new URL(withPushAnalyticsAttribution(
    "https://example.com/profile?utm_source=old&utm_medium=email&utm_campaign=old-campaign",
    { campaignId: "campaign-456" },
  ));

  assert.equal(tracked.searchParams.get("utm_source"), "old");
  assert.equal(tracked.searchParams.get("utm_medium"), "email");
  assert.equal(tracked.searchParams.get("utm_campaign"), "old-campaign");
});

test("push analytics attribution leaves relative and malformed URLs unchanged", () => {
  assert.equal(withPushAnalyticsAttribution("/offers", { campaignId: "campaign-123" }), "/offers");
  assert.equal(withPushAnalyticsAttribution("not a URL", { campaignId: "campaign-123" }), "not a URL");
});

test("browser push service enqueues a dispatch job", async () => {
  const fakeSitesService = {
    async getSite() {
      return {
        id: "site-1",
        vapidSubject: "mailto:push@example.com",
        vapidPublicKey: "public-key",
        vapidPrivateKey: "private-key",
      };
    },
  };

  let queueOptions: { jobId?: string } | undefined;
  const queue = {
    async add(_name: string, payload: BrowserPushJobPayload, options?: { jobId?: string }) {
      queueOptions = options;
      return { id: "job-1", payload };
    },
  };

  const fakeBrowserPushRepository = {};
  const fakeAuditService = { async log() { return undefined; } };

  const service = new BrowserPushService(fakeSitesService as never, fakeBrowserPushRepository as never, fakeAuditService as never, queue as never);

  const result = await service.dispatch({
    siteId: "site-1",
    title: "New article",
    body: "Read the latest update",
    url: "https://example.com/articles/1",
    icon: null,
    image: null,
    jobId: "crm-stable-job",
  });

  assert.equal(result.queued, true);
  assert.equal(result.jobId, "job-1");
  assert.deepEqual(queueOptions, { jobId: "crm-stable-job" });
});

test("browser push service applies GA4 attribution to campaign and variant URLs", async () => {
  const payloads: BrowserPushJobPayload[] = [];
  const queue = {
    async add(_name: string, payload: BrowserPushJobPayload) {
      payloads.push(payload);
      return { id: "job-1" };
    },
  };
  const service = new BrowserPushService({
    async getSite() {
      return { id: "site-1", vapidSubject: "mailto:push@example.com", vapidPublicKey: "public-key", vapidPrivateKey: "private-key" };
    },
  } as never, {} as never, { async log() { return undefined; } } as never, queue as never);

  await service.dispatch({
    siteId: "site-1",
    campaignId: "campaign-789",
    title: "Control",
    body: "Body",
    url: "https://example.com/control?locale=en",
    variants: [{ id: "variant-a", title: "Variant", body: "Variant body", url: "https://example.com/variant", weight: 100 }],
  });

  const payload = payloads[0]!;
  assert.equal(new URL(payload.notification.url).searchParams.get("utm_campaign"), "campaign-789");
  assert.equal(new URL(payload.notification.url).searchParams.get("locale"), "en");
  assert.equal(new URL(payload.variants![0]!.url).searchParams.get("utm_campaign"), "campaign-789");
  assert.equal(new URL(payload.variants![0]!.url).searchParams.get("utm_medium"), "push");
});

test("browser push service fills the icon slot from the image when no icon is given", async () => {
  const fakeSitesService = {
    async getSite() {
      return {
        id: "site-1",
        vapidSubject: "mailto:push@example.com",
        vapidPublicKey: "public-key",
        vapidPrivateKey: "private-key",
      };
    },
  };

  const payloads: BrowserPushJobPayload[] = [];
  const queue = {
    async add(_name: string, payload: BrowserPushJobPayload) {
      payloads.push(payload);
      return { id: "job-1", payload };
    },
  };

  const fakeAuditService = { async log() { return undefined; } };
  const service = new BrowserPushService(fakeSitesService as never, {} as never, fakeAuditService as never, queue as never);

  await service.dispatch({
    siteId: "site-1",
    title: "Image only",
    body: "No explicit icon",
    url: "https://example.com/articles/1",
    image: "https://example.com/hero.png",
  });
  await service.dispatch({
    siteId: "site-1",
    title: "Both set",
    body: "Explicit icon wins",
    url: "https://example.com/articles/2",
    icon: "https://example.com/icon.png",
    image: "https://example.com/hero.png",
  });

  assert.equal(payloads[0]?.notification.icon, "https://example.com/hero.png");
  assert.equal(payloads[0]?.notification.image, "https://example.com/hero.png");
  assert.equal(payloads[1]?.notification.icon, "https://example.com/icon.png");
});

test("browser push service clears failed deliveries and audits the count", async () => {
  const auditCalls: Array<Record<string, unknown>> = [];
  const fakeBrowserPushRepository = {
    async clearFailedDeliveries() {
      return 109;
    },
  };
  const fakeAuditService = {
    async log(entry: Record<string, unknown>) {
      auditCalls.push(entry);
    },
  };

  const service = new BrowserPushService({} as never, fakeBrowserPushRepository as never, fakeAuditService as never, {} as never);
  const cleared = await service.clearFailedDeliveries("user-1");

  assert.equal(cleared, 109);
  assert.equal(auditCalls.length, 1);
  assert.equal(auditCalls[0]?.actorUserId, "user-1");
  assert.equal(auditCalls[0]?.action, "platform.failed_deliveries_cleared");
  assert.deepEqual(auditCalls[0]?.metadata, { cleared: 109 });
});

test("browser push service clears all delivery history and audits the count", async () => {
  const auditCalls: Array<Record<string, unknown>> = [];
  const fakeBrowserPushRepository = {
    async clearAllDeliveryHistory() {
      return 5000;
    },
  };
  const fakeAuditService = {
    async log(entry: Record<string, unknown>) {
      auditCalls.push(entry);
    },
  };

  const service = new BrowserPushService({} as never, fakeBrowserPushRepository as never, fakeAuditService as never, {} as never);
  const cleared = await service.clearAllDeliveryHistory("user-1");

  assert.equal(cleared, 5000);
  assert.equal(auditCalls[0]?.action, "platform.all_delivery_history_cleared");
  assert.deepEqual(auditCalls[0]?.metadata, { cleared: 5000 });
});

test("browser push service requeues claimed transient failures with original attribution", async () => {
  const marked: Array<{ deliveryId: string; jobId: string }> = [];
  const auditCalls: Array<Record<string, unknown>> = [];
  const repository = {
    async claimRetryableTransientDeliveries() {
      return [{
        id: "delivery-1",
        siteId: "site-1",
        campaignId: "campaign-1",
        automationId: "automation-1",
        subscriberId: "subscriber-1",
        notification: { title: "Title", body: "Body", url: "https://example.com", icon: null, image: null },
      }];
    },
    async markDeliveriesRetried(items: Array<{ deliveryId: string; jobId: string }>) {
      marked.push(...items);
    },
  };
  const queued: BrowserPushJobPayload[] = [];
  const queue = {
    async addBulk(jobs: Array<{ data: BrowserPushJobPayload }>) {
      queued.push(...jobs.map((job) => job.data));
      return [{ id: "retry-job-1" }];
    },
  };
  const audit = { async log(entry: Record<string, unknown>) { auditCalls.push(entry); } };
  const service = new BrowserPushService({} as never, repository as never, audit as never, queue as never);

  const result = await service.retryTransientFailures({ siteId: "site-1", limit: 50 }, "user-1");

  assert.deepEqual(result, { queued: 1 });
  assert.equal(queued[0]?.campaignId, "campaign-1");
  assert.equal(queued[0]?.automationId, "automation-1");
  assert.equal(queued[0]?.subscriberId, "subscriber-1");
  assert.deepEqual(marked, [{ deliveryId: "delivery-1", jobId: "retry-job-1" }]);
  assert.equal(auditCalls[0]?.action, "platform.transient_deliveries_retried");
});

test("browser push service releases retry claims if queueing fails", async () => {
  const released: string[][] = [];
  const repository = {
    async claimRetryableTransientDeliveries() {
      return [{
        id: "delivery-1",
        siteId: "site-1",
        campaignId: null,
        automationId: null,
        subscriberId: "subscriber-1",
        notification: { title: "Title", body: "Body", url: "https://example.com", icon: null, image: null },
      }];
    },
    async releaseRetryClaims(ids: string[]) { released.push(ids); },
  };
  const queue = { async addBulk() { throw new Error("Redis unavailable"); } };
  const service = new BrowserPushService({} as never, repository as never, {} as never, queue as never);

  await assert.rejects(() => service.retryTransientFailures({}), /Redis unavailable/);
  assert.deepEqual(released, [["delivery-1"]]);
});
