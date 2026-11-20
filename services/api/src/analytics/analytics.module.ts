import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module";
import { AnalyticsController } from "./analytics.controller";
import { AnalyticsRepository } from "./analytics.repository";
import { AnalyticsService } from "./analytics.service";
import { GoogleSheetsClient } from "./google-sheets.client";
import { Ga4DataClient } from "./ga4-data.client";

@Module({
  imports: [DatabaseModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, AnalyticsRepository, GoogleSheetsClient, Ga4DataClient],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
