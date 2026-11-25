import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module";
import { AnalyticsController } from "./analytics.controller";
import { AnalyticsRepository } from "./analytics.repository";
import { AnalyticsService } from "./analytics.service";
import { GoogleSheetsClient } from "./google-sheets.client";
import { Ga4DataClient } from "./ga4-data.client";
import { Ga4ConnectionsService } from "./ga4-connections.service";

@Module({
  imports: [DatabaseModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, AnalyticsRepository, GoogleSheetsClient, Ga4DataClient, Ga4ConnectionsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
