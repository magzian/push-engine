import assert from "node:assert/strict";
import test from "node:test";

import { NotFoundException } from "@nestjs/common";

import { PublicSitesController } from "./public-sites.controller";

test("public sites controller returns branding config for active sites", async () => {
  const controller = new PublicSitesController({
    async getSite() {
      return {
        id: "site-1",
        appName: "Exotic News",
        iconUrl: "https://example.com/icon.png",
        themeColor: "#111111",
        vapidPublicKey: "public-key",
        status: "active",
        optInPromptType: "lightbox-1",
        optInPromptAnimation: "slide-in",
        optInPromptBackgroundColor: "#ffffff",
        optInPromptHeadline: "Stay in the loop",
        optInPromptHeadlineTextColor: "#111111",
        optInPromptText: "Get important updates delivered to your browser.",
        optInPromptTextColor: "#444444",
        optInPromptIconUrl: "https://example.com/icon.png",
        optInPromptCancelButtonLabel: "Not now",
        optInPromptCancelButtonTextColor: "#ffffff",
        optInPromptCancelButtonBackgroundColor: "#111111",
        optInPromptApproveButtonLabel: "Enable",
        optInPromptApproveButtonTextColor: "#ffffff",
        optInPromptApproveButtonBackgroundColor: "#ea580c",
        optInPromptRepromptDelayDays: 30,
        optInPromptRecentNotificationsLimit: 3,
        optInPromptDisplayMode: "scroll",
        optInPromptScrollPercent: 60,
        optInPromptPageViewCount: 4,
      };
    },
    async recordConnection() {
      return undefined;
    },
    async query() {
      return { rows: [] };
    },
  } as never, { query: async () => ({ rows: [] }) } as never);

  const response = await controller.getPublicConfig("site-1");

  assert.equal(response.success, true);
  assert.equal(response.data.appName, "Exotic News");
  assert.equal(response.data.vapidPublicKey, "public-key");
  assert.equal(response.data.optInPromptDisplayMode, "scroll");
  assert.equal(response.data.optInPromptScrollPercent, 60);
  assert.equal(response.data.optInPromptPageViewCount, 4);
});

test("public sites controller hides inactive sites", async () => {
  const controller = new PublicSitesController({
    async getSite() {
      return {
        id: "site-1",
        appName: "Exotic News",
        iconUrl: null,
        themeColor: null,
        vapidPublicKey: null,
        status: "inactive",
        optInPromptType: "lightbox-1",
        optInPromptAnimation: "slide-in",
        optInPromptBackgroundColor: "#ffffff",
        optInPromptHeadline: "Stay in the loop",
        optInPromptHeadlineTextColor: "#111111",
        optInPromptText: "Get important updates delivered to your browser.",
        optInPromptTextColor: "#444444",
        optInPromptIconUrl: null,
        optInPromptCancelButtonLabel: "Not now",
        optInPromptCancelButtonTextColor: "#ffffff",
        optInPromptCancelButtonBackgroundColor: "#111111",
        optInPromptApproveButtonLabel: "Enable",
        optInPromptApproveButtonTextColor: "#ffffff",
        optInPromptApproveButtonBackgroundColor: "#ea580c",
        optInPromptRepromptDelayDays: 30,
        optInPromptRecentNotificationsLimit: 3,
      };
    },
    async query() {
      return { rows: [] };
    },
  } as never, { query: async () => ({ rows: [] }) } as never);

  await assert.rejects(() => controller.getPublicConfig("site-1"), NotFoundException);
});

test("public sites controller returns recent notifications for active sites", async () => {
  const pool = {
    async query() {
      return {
        rows: [
          {
            id: "campaign-1",
            title: "Weekend update",
            message: "Fresh arrivals this weekend.",
            url: "https://example.com/weekend",
            icon_url: "https://example.com/icon.png",
            sent_at: "2026-06-22T10:00:00.000Z",
          },
        ],
      };
    },
  };

  const controller = new PublicSitesController({
    async getSite() {
      return {
        id: "site-1",
        appName: "Exotic News",
        iconUrl: null,
        themeColor: null,
        vapidPublicKey: null,
        status: "active",
        optInPromptType: "lightbox-1",
        optInPromptAnimation: "slide-in",
        optInPromptBackgroundColor: "#ffffff",
        optInPromptHeadline: "Stay in the loop",
        optInPromptHeadlineTextColor: "#111111",
        optInPromptText: "Get important updates delivered to your browser.",
        optInPromptTextColor: "#444444",
        optInPromptIconUrl: null,
        optInPromptCancelButtonLabel: "Not now",
        optInPromptCancelButtonTextColor: "#ffffff",
        optInPromptCancelButtonBackgroundColor: "#111111",
        optInPromptApproveButtonLabel: "Enable",
        optInPromptApproveButtonTextColor: "#ffffff",
        optInPromptApproveButtonBackgroundColor: "#ea580c",
        optInPromptRepromptDelayDays: 30,
        optInPromptRecentNotificationsLimit: 3,
      };
    },
  } as never, pool as never);

  const response = await controller.getRecentNotifications("site-1");

  assert.equal(response.success, true);
  assert.equal(response.data.length, 1);
  assert.equal(response.data[0]?.title, "Weekend update");
  const destination = new URL(response.data[0]!.url);
  assert.equal(destination.searchParams.get("utm_source"), "push_engine");
  assert.equal(destination.searchParams.get("utm_medium"), "push");
  assert.equal(destination.searchParams.get("utm_campaign"), "campaign-1");
});
