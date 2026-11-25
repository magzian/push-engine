import { DashboardShell } from "../_components/dashboard-shell";
import { getSiteChoices } from "../_data/sites";
import { Ga4ConnectionsPanel } from "./ga4-connections-panel";

export default async function Ga4ConnectionsPage() {
  const sites = (await getSiteChoices()).filter((site) => site.id !== "site-3");
  return (
    <DashboardShell eyebrow="Analytics" title="GA4 Connections" description="Connect each Push Engine site to its GA4 Property without editing server configuration.">
      <Ga4ConnectionsPanel sites={sites.map((site) => ({ id: site.id, name: site.name, url: site.url }))} />
    </DashboardShell>
  );
}
