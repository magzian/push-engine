export interface Ga4PropertyMapping {
  siteOrigin: string;
  propertyId: string;
}

interface Ga4ServiceAccountConfig {
  clientEmail: string;
  privateKey: string;
  properties: Ga4PropertyMapping[];
}

function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    return `${url.protocol.toLowerCase()}//${hostname}${url.port ? `:${url.port}` : ""}`;
  } catch {
    return null;
  }
}

export function loadGa4ServiceAccountConfig(): Ga4ServiceAccountConfig | null {
  const clientEmail = process.env.GA4_SERVICE_ACCOUNT_CLIENT_EMAIL?.trim();
  const privateKey = process.env.GA4_SERVICE_ACCOUNT_PRIVATE_KEY?.replaceAll("\\n", "\n").trim();
  const rawMappings = process.env.GA4_PROPERTY_MAPPINGS_JSON?.trim();
  if (!clientEmail || !privateKey || !rawMappings) return null;

  try {
    const parsed = JSON.parse(rawMappings) as Array<{ siteOrigin?: unknown; propertyId?: unknown }>;
    const properties = parsed.flatMap((item) => {
      const siteOrigin = typeof item.siteOrigin === "string" ? normalizeOrigin(item.siteOrigin) : null;
      const propertyId = typeof item.propertyId === "string" ? item.propertyId.trim() : "";
      return siteOrigin && /^\d+$/.test(propertyId) ? [{ siteOrigin, propertyId }] : [];
    });
    return properties.length > 0 ? { clientEmail, privateKey, properties } : null;
  } catch {
    return null;
  }
}

export function findGa4PropertyId(siteUrl: string, config = loadGa4ServiceAccountConfig()): string | null {
  const origin = normalizeOrigin(siteUrl);
  if (!origin || !config) return null;
  return config.properties.find((property) => property.siteOrigin === origin)?.propertyId ?? null;
}
