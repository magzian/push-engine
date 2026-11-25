import { IsOptional, IsString, Matches } from "class-validator";

export class UpsertGa4ConnectionDto {
  @IsString()
  siteId!: string;

  @Matches(/^\d+$/, { message: "propertyId must be a numeric GA4 Property ID" })
  propertyId!: string;

  @IsOptional()
  @Matches(/^G-[A-Z0-9]+$/i, { message: "measurementId must be a GA4 Measurement ID such as G-ABC123" })
  measurementId?: string;
}
