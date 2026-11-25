import { NextResponse } from "next/server";

import { apiFetch } from "../../../../../lib/server-api";

async function proxy(init?: RequestInit): Promise<Response> {
  const response = await apiFetch("/analytics/ga4-connections", init);
  const payload = await response.json().catch(() => ({ success: false, error: { message: "Invalid API response" } }));
  return NextResponse.json(payload, { status: response.status });
}

export async function GET(): Promise<Response> {
  return proxy();
}

export async function POST(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null);
  return proxy({ method: "POST", body: JSON.stringify(body) });
}
