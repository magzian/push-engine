import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Pool } from "pg";

import { AuditService } from "../audit/audit.service";
import { DATABASE_POOL } from "../database/database.constants";
import { normalizeGa4Origin } from "./ga4-data.config";

const SETTING_KEY = "analytics.ga4_connections";

interface StoredGa4Connection {
  siteId: string;
  propertyId: string;
  measurementId: string | null;
  updatedAt: string;
}

export interface Ga4Connection extends StoredGa4Connection {
  siteName: string;
  siteUrl: string;
}

@Injectable()
export class Ga4ConnectionsService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool, private readonly auditService: AuditService) {}

  async list(): Promise<Ga4Connection[]> {
    const [connections, sites] = await Promise.all([this.read(), this.pool.query<{ id: string; name: string; url: string }>("SELECT id, name, url FROM sites ORDER BY name")]);
    const bySite = new Map(connections.map((connection) => [connection.siteId, connection]));
    return sites.rows.flatMap((site) => {
      const connection = bySite.get(site.id);
      return connection ? [{ ...connection, siteName: site.name, siteUrl: site.url }] : [];
    });
  }

  async findPropertyId(siteUrl: string): Promise<string | null> {
    const origin = normalizeGa4Origin(siteUrl);
    if (!origin) return null;
    const connections = await this.read();
    if (!connections.length) return null;
    const result = await this.pool.query<{ id: string; url: string }>("SELECT id, url FROM sites WHERE id = ANY($1::uuid[])", [connections.map((item) => item.siteId)]);
    const site = result.rows.find((item) => normalizeGa4Origin(item.url) === origin);
    return site ? connections.find((item) => item.siteId === site.id)?.propertyId ?? null : null;
  }

  async upsert(input: { siteId: string; propertyId: string; measurementId?: string }, actorUserId: string): Promise<Ga4Connection> {
    const site = await this.pool.query<{ id: string; name: string; url: string }>("SELECT id, name, url FROM sites WHERE id = $1", [input.siteId]);
    const record = site.rows[0];
    if (!record) throw new NotFoundException("Site not found");
    if (!/^\d+$/.test(input.propertyId)) throw new BadRequestException("propertyId must be a numeric GA4 Property ID");
    const connections = await this.read();
    const connection: StoredGa4Connection = { siteId: input.siteId, propertyId: input.propertyId, measurementId: input.measurementId?.trim().toUpperCase() || null, updatedAt: new Date().toISOString() };
    await this.write([...connections.filter((item) => item.siteId !== input.siteId), connection]);
    await this.auditService.log({ actorUserId, action: "analytics.ga4_connection_saved", targetType: "site", targetId: input.siteId, metadata: { propertyId: input.propertyId, measurementId: connection.measurementId } });
    return { ...connection, siteName: record.name, siteUrl: record.url };
  }

  private async read(): Promise<StoredGa4Connection[]> {
    const result = await this.pool.query<{ setting_value: unknown }>("SELECT setting_value FROM system_settings WHERE setting_key = $1", [SETTING_KEY]);
    const value = result.rows[0]?.setting_value;
    return Array.isArray(value) ? value.filter((item): item is StoredGa4Connection => Boolean(item && typeof item === "object" && typeof (item as StoredGa4Connection).siteId === "string" && /^\d+$/.test((item as StoredGa4Connection).propertyId))) : [];
  }

  private async write(connections: StoredGa4Connection[]): Promise<void> {
    await this.pool.query("INSERT INTO system_settings (setting_key, setting_value) VALUES ($1, $2::jsonb) ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = NOW()", [SETTING_KEY, JSON.stringify(connections)]);
  }
}
