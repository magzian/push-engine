"use client";

import { useEffect, useState, useTransition } from "react";

import { useToast } from "../_components/toast";

interface Site { id: string; name: string; url: string }
interface Connection { siteId: string; siteName: string; siteUrl: string; propertyId: string; measurementId: string | null; updatedAt: string }
interface Payload { data?: Connection[]; error?: { message?: string } }

export function Ga4ConnectionsPanel({ sites }: { sites: Site[] }) {
  const toast = useToast();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [siteId, setSiteId] = useState(sites[0]?.id ?? "");
  const [propertyId, setPropertyId] = useState("");
  const [measurementId, setMeasurementId] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();

  const load = () => fetch("/api/dashboard/analytics/ga4-connections", { cache: "no-store" }).then(async (response) => {
    const payload = await response.json() as Payload;
    if (!response.ok) throw new Error(payload.error?.message ?? "Unable to load GA4 connections");
    setConnections(payload.data ?? []);
  });

  useEffect(() => { void load().catch((error) => toast.showError(error instanceof Error ? error.message : "Unable to load GA4 connections")).finally(() => setLoading(false)); }, []);

  function save() {
    startTransition(() => { void fetch("/api/dashboard/analytics/ga4-connections", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ siteId, propertyId, ...(measurementId ? { measurementId } : {}) }) })
      .then(async (response) => { const payload = await response.json() as { data?: Connection; error?: { message?: string } }; if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? "Unable to save GA4 connection"); setConnections((items) => [...items.filter((item) => item.siteId !== payload.data!.siteId), payload.data!]); setPropertyId(""); setMeasurementId(""); toast.showSuccess("GA4 connection saved."); })
      .catch((error) => toast.showError(error instanceof Error ? error.message : "Unable to save GA4 connection")); });
  }

  return <section className="card">
    <div className="panel-heading"><div><p className="eyebrow">Super admin only</p><h3>Connect a site</h3></div></div>
    <p className="subtle">The GA4 service-account credentials remain on the server. Enter a numeric GA4 Property ID, not a G- Measurement ID.</p>
    <div className="form-grid" style={{ marginTop: 16 }}>
      <label>Push Engine site<select value={siteId} onChange={(event) => setSiteId(event.target.value)}>{sites.map((site) => <option key={site.id} value={site.id}>{site.name} — {site.url}</option>)}</select></label>
      <label>GA4 Property ID<input value={propertyId} inputMode="numeric" onChange={(event) => setPropertyId(event.target.value)} placeholder="e.g. 352927142" /></label>
      <label>Measurement ID <span className="subtle">(reference)</span><input value={measurementId} onChange={(event) => setMeasurementId(event.target.value)} placeholder="G-ABC123" /></label>
    </div>
    <button className="button primary" type="button" disabled={pending || !siteId || !/^\d+$/.test(propertyId)} onClick={save} style={{ marginTop: 16 }}>{pending ? "Saving..." : "Save GA4 connection"}</button>
    <div style={{ marginTop: 28 }}><p className="eyebrow">Configured sites</p>{loading ? <p className="subtle">Loading...</p> : connections.length ? <div className="table-wrap"><table><thead><tr><th>Site</th><th>Property ID</th><th>Measurement ID</th></tr></thead><tbody>{connections.map((connection) => <tr key={connection.siteId}><td>{connection.siteName}<br /><span className="subtle">{connection.siteUrl}</span></td><td>{connection.propertyId}</td><td>{connection.measurementId ?? "—"}</td></tr>)}</tbody></table></div> : <p className="subtle">No database-managed GA4 connections yet. Existing environment mappings continue to work.</p>}</div>
  </section>;
}
