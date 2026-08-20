// Remote MCP-endpoint (Streamable HTTP, JSON-antwoordmodus) — zodat de CFO
// vanuit Claude Desktop met de live cijfers kan praten zonder kubectl/creds op
// zijn laptop (vraag David 18/08/2026). Beveiliging: statisch bearer-token uit
// de omgeving (MCP_TOKEN, k8s-secret) — géén token, géén antwoord. Alles
// ALLEEN-LEZEN: dezelfde regels als de lokale MCP-server (nooit $top, ReadOnly).
// Client-kant (vraag David 18/08: géén installatie bij de CFO): custom
// connector in claude.ai/Claude Desktop met het token ÍN de URL —
//   https://itfinance.daviddelporte.com/api/mcp/<token>
// (capability-URL: de URL ís de sleutel; alleen delen met wie mag lezen,
// intrekken = token in het k8s-secret vervangen). Bearer-header werkt ook.

import { getBCToken } from "@/lib/bc-client";
import { ODATA_ROOT, API_ROOT, pageAllOData } from "@/lib/bc-odata";
import { fetchWithRetry } from "@/lib/http";
import { ORIGIN, verifieerAccessToken } from "@/lib/mcp-oauth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Dezelfde allowlist-gedachte als de lokale MCP: alleen gevalideerde endpoints.
const DASHBOARD_ENDPOINTS = [
  "/api/cfo/cashforecast", "/api/cfo/pnl", "/api/cfo/units", "/api/cfo/receivables",
  "/api/cfo/bank", "/api/cfo/balance", "/api/cfo/ic-btw", "/api/cfo/leasing",
];

const TOOLS = [
  {
    name: "dashboard",
    description: `Lees de gevalideerde dashboard-cijfers (LIVE, zelfde bron als de pagina's). Endpoints: ${DASHBOARD_ENDPOINTS.join(", ")}. Query-parameters mogen erbij (bv. /api/cfo/pnl?year=2026&company=GTR). Antwoord 202 = data wordt opgebouwd: wacht 30s en probeer opnieuw.`,
    inputSchema: { type: "object", properties: { endpoint: { type: "string", description: "pad, bv. /api/cfo/cashforecast" } }, required: ["endpoint"] },
  },
  {
    name: "bc_query",
    description: "Ruwe ALLEEN-LEZEN query op Business Central. Vorm (a) ODataV4-webservice: service bv. Grootboekposten_Excel, Cust_LedgerEntries, VendorLedgerEntries (velden Pascal_Snake). Vorm (b) api:true voor api/v2.0: service bv. salesInvoices, accounts, generalLedgerEntries (camelCase; expand=salesInvoiceLines voor factuurlijnen). Firmacodes: GTR GDI WHS TDR GRE GTG GSS GPR TFO LMB GEX. Gebruik ALTIJD filter én select — anders wordt het antwoord afgekapt.",
    inputSchema: {
      type: "object",
      properties: {
        company: { type: "string" }, service: { type: "string" },
        filter: { type: "string" }, select: { type: "string" }, expand: { type: "string" },
        api: { type: "boolean", description: "true = api/v2.0-entiteit" },
      },
      required: ["company", "service"],
    },
  },
] as const;

const MAX_CHARS = 80_000;

async function runDashboard(endpoint: string): Promise<string> {
  const path = String(endpoint || "");
  if (!DASHBOARD_ENDPOINTS.some((e) => path === e || path.startsWith(`${e}?`))) {
    return `Endpoint niet toegestaan. Kies uit: ${DASHBOARD_ENDPOINTS.join(", ")}`;
  }
  // Interne call: de route draait in dezelfde pod als de app.
  const res = await fetch(`http://localhost:3000${path}`, { headers: { "x-mcp-internal": "1" } });
  const body = await res.text();
  return `HTTP ${res.status}\n${body.slice(0, MAX_CHARS)}${body.length > MAX_CHARS ? "\n…AFGEKAPT — filter strakker" : ""}`;
}

async function runBcQuery(a: { company: string; service: string; filter?: string; select?: string; expand?: string; api?: boolean }): Promise<string> {
  const token = await getBCToken();
  const co = String(a.company || "").toUpperCase();
  if (!/^[A-Z]{2,5}$/.test(co)) return "Ongeldige firmacode.";
  const qs: string[] = [];
  if (a.filter) qs.push(`$filter=${encodeURIComponent(a.filter)}`);
  if (a.select) qs.push(`$select=${encodeURIComponent(a.select)}`);
  if (a.expand) qs.push(`$expand=${encodeURIComponent(a.expand)}`);
  let url: string;
  if (a.api) {
    const companies: { id: string; name: string }[] = [];
    await pageAllOData(`${API_ROOT}/companies?$select=id,name`, (c) => companies.push({ id: String(c.id), name: String(c.name) }), token);
    const comp = companies.find((c) => c.name.toUpperCase() === co);
    if (!comp) return `Firma ${co} niet gevonden.`;
    url = `${API_ROOT}/companies(${comp.id})/${a.service}${qs.length ? `?${qs.join("&")}` : ""}`;
  } else {
    url = `${ODATA_ROOT}/ODataV4/Company('${encodeURIComponent(co)}')/${a.service}${qs.length ? `?${qs.join("&")}` : ""}`;
  }
  const rows: unknown[] = [];
  let pages = 0;
  let next: string | null = url;
  while (next && pages < 200) {
    const res: Response = await fetchWithRetry(next, {
      headers: { Authorization: `Bearer ${token}`, "Data-Access-Intent": "ReadOnly", Accept: "application/json" },
    }, { timeoutMs: 90_000, maxAttempts: 2 });
    if (!res.ok) return `BC ${res.status}: ${(await res.text()).slice(0, 300)}`;
    const j: { value?: unknown[]; "@odata.nextLink"?: string } = await res.json();
    for (const v of j.value || []) rows.push(v);
    next = j["@odata.nextLink"] || null;
    pages++;
    if (JSON.stringify(rows).length > MAX_CHARS) break;
  }
  const out = JSON.stringify({ aantal: rows.length, afgekapt: Boolean(next), rows });
  return out.length > MAX_CHARS ? out.slice(0, MAX_CHARS) + "…AFGEKAPT — filter strakker" : out;
}

// Antwoordvorm volgt de Accept-header (connectorfix 20/08): claude.ai en de
// officiële MCP-SDK's verwachten bij "Accept: text/event-stream" een
// SSE-geformatteerd antwoord (event: message / data: {...}) — precies wat de
// referentieservers doen. Zonder event-stream in Accept blijft het puur JSON
// (curl, eenvoudige clients). Op initialize geven we ook een Mcp-Session-Id
// mee; wij zijn stateless en valideren hem daarna bewust niet.
function wantsSse(req: Request): boolean {
  return (req.headers.get("accept") || "").includes("text/event-stream");
}
function rpcBody(req: Request, payload: Record<string, unknown>, extraHeaders?: Record<string, string>): Response {
  if (wantsSse(req)) {
    return new Response(`event: message\ndata: ${JSON.stringify(payload)}\n\n`, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store", ...extraHeaders },
    });
  }
  return new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json", ...extraHeaders } });
}
function rpc(req: Request, id: unknown, result: unknown, extraHeaders?: Record<string, string>): Response {
  return rpcBody(req, { jsonrpc: "2.0", id, result }, extraHeaders);
}
function rpcErr(req: Request, id: unknown, code: number, message: string): Response {
  return rpcBody(req, { jsonrpc: "2.0", id, error: { code, message } });
}

export async function POST(req: Request, ctx: { params: Promise<{ slug?: string[] }> }) {
  const expected = process.env.MCP_TOKEN;
  const header = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const { slug } = await ctx.params;
  const pathToken = (slug || [])[0] || "";
  // Diagnose-logging (connectorprobleem 19/08): methode + user-agent + auth-vorm,
  // NOOIT het token zelf — zo is in de pod-logs te zien wat claude.ai stuurt.
  const ua = (req.headers.get("user-agent") || "?").slice(0, 80);
  const authVorm = header ? "header" : pathToken ? "url" : "geen";
  if (!expected || (header !== expected && pathToken !== expected && !verifieerAccessToken(header, expected))) {
    console.log(`[mcp] 401 ua="${ua}" auth=${authVorm}`);
    // WWW-Authenticate met resource_metadata-pointer: zo vindt claude.ai de
    // OAuth-flow (docs: lazy authentication). Zonder deze header + metadata
    // breekt de connector-broker af met "Couldn't reach".
    // Root-variant zonder padsuffix — exact zoals de bewezen werkende
    // EMAsphere-connector (probe 20/08); beide varianten serveren dezelfde JSON.
    return new Response("Unauthorized", {
      status: 401,
      headers: { "WWW-Authenticate": `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource"` },
    });
  }

  let msg: { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> };
  try { msg = await req.json(); } catch { console.log(`[mcp] parse-error ua="${ua}"`); return rpcErr(req, null, -32700, "Parse error"); }
  const { id, method, params } = msg;
  console.log(`[mcp] ${method || "?"} ua="${ua}" auth=${authVorm} accept="${(req.headers.get("accept") || "?").slice(0, 50)}"`);

  if (method === "initialize") {
    return rpc(req, id, {
      protocolVersion: (params?.protocolVersion as string) || "2025-03-26",
      capabilities: { tools: {} },
      serverInfo: { name: "gheeraert-finance", version: "1.0.0" },
      instructions: "Alleen-lezen toegang tot het Gheeraert CFO-dashboard en Business Central. Vermeld bij elk cijfer de bron. Gebruik altijd filter+select bij bc_query.",
    }, { "Mcp-Session-Id": crypto.randomUUID() });
  }
  if (method === "notifications/initialized" || String(method || "").startsWith("notifications/")) {
    return new Response(null, { status: 202 });
  }
  if (method === "ping") return rpc(req, id, {});
  if (method === "tools/list") return rpc(req, id, { tools: TOOLS });
  if (method === "tools/call") {
    const name = String(params?.name || "");
    const args = (params?.arguments || {}) as Record<string, unknown>;
    try {
      let text: string;
      if (name === "dashboard") text = await runDashboard(String(args.endpoint || ""));
      else if (name === "bc_query") text = await runBcQuery(args as Parameters<typeof runBcQuery>[0]);
      else return rpcErr(req, id, -32602, `Onbekende tool: ${name}`);
      return rpc(req, id, { content: [{ type: "text", text }] });
    } catch (e) {
      return rpc(req, id, { content: [{ type: "text", text: `Fout: ${String(e).slice(0, 300)}` }], isError: true });
    }
  }
  return rpcErr(req, id, -32601, `Onbekende methode: ${method}`);
}

// Streamable HTTP: GET is optioneel (SSE-stream) — wij ondersteunen alleen POST.
export async function GET(req: Request) {
  console.log(`[mcp] GET ua="${(req.headers.get("user-agent") || "?").slice(0, 80)}" accept="${(req.headers.get("accept") || "?").slice(0, 60)}"`);
  return new Response("Method Not Allowed", { status: 405 });
}
export async function DELETE() { return new Response(null, { status: 200 }); }
