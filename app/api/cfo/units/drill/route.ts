// GET /api/cfo/units/drill?company=GTR&from=..&to=..            → alle P&L-rekeningen van één firma
// GET /api/cfo/units/drill?cls=61&from=..&to=..&exclude=GPR     → één klasse over alle firma's
//
// Drill-down onder de Business Units-pagina (vraag David 13/08/2026: "op de kosten
// kunnen klikken en inkijken wat eronder zit — omzet en kosten"). Per rekening het
// bedrag in het gekozen venster, met een BC-deeplink per firma×rekening (vindplaats,
// geen payload). Zelfde tekenconventie als lib/units.ts: omzet (70–74) positief
// gemaakt, kosten (60–64) debet-normaal; 65–69/75–79 buiten de operationele view.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { cfoAllowed } from "@/lib/cfo-access";
import { fetchBCCompanies, getBCToken } from "@/lib/bc-client";
import { ODATA_ROOT, API_ROOT, pageAllOData, isOperatingCompany, isDemoMode } from "@/lib/bc-odata";
import { glAccountLink } from "@/lib/bc-links";
import { getCache, setCache } from "@/lib/sync-cache";
import { fetchWithRetry } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface DrillRow {
  company: string;
  account: string;
  name: string;
  amount: number;      // teken-genormaliseerd (omzet +, kost +; negatief = creditsaldo op een kostrekening e.d.)
  kind: "income" | "expense";
  bcUrl: string;
}
interface DrillResponse {
  rows: DrillRow[];
  totals: { revenue: number; costs: number };
  count: number; capped: boolean;
  from: string; to: string;
  demo?: boolean;
  warning?: string;
}

const OP_REV = new Set(["70", "71", "72", "74"]);
const OP_COST = new Set(["60", "61", "62", "63", "64"]);
const VALID_CLS = new Set([...OP_REV, ...OP_COST]);
const CAP = 250;
const r2 = (v: number) => Math.round(v * 100) / 100;

// Rekeningnamen per firma (klein: één accounts-pull, 30 min cache).
async function accountNames(companyId: string, code: string, token: string): Promise<Record<string, string>> {
  const key = `drill-acctnames-${code}`;
  const cached = getCache<Record<string, string>>(key);
  if (cached) return cached;
  const names: Record<string, string> = {};
  let url: string | null = `${API_ROOT}/companies(${companyId})/accounts?$select=number,displayName`;
  while (url) {
    const res: Response = await fetchWithRetry(url, {
      headers: { Authorization: `Bearer ${token}`, "Data-Access-Intent": "ReadOnly", Accept: "application/json" },
    }, { timeoutMs: 60_000, maxAttempts: 2 });
    if (!res.ok) break;
    const j: { value?: { number?: string; displayName?: string }[]; "@odata.nextLink"?: string } = await res.json();
    for (const a of j.value || []) if (a.number) names[a.number] = a.displayName || "";
    url = j["@odata.nextLink"] || null;
  }
  setCache(key, names, 30);
  return names;
}

export async function GET(req: NextRequest) {
  const session = await auth().catch(() => null);
  if (!cfoAllowed(session?.user?.email)) return NextResponse.json({ error: "CFO-toegang vereist" }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const company = (sp.get("company") || "").trim().toUpperCase();
  const cls = (sp.get("cls") || "").trim();
  const from = sp.get("from") || "";
  const to = sp.get("to") || "";
  const exclude = (sp.get("exclude") || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  if (!ISO.test(from) || !ISO.test(to) || from > to) return NextResponse.json({ error: "from/to ongeldig" }, { status: 400 });
  if (!company && !cls) return NextResponse.json({ error: "company of cls vereist" }, { status: 400 });
  if (company && !/^[A-Z]{2,5}$/.test(company)) return NextResponse.json({ error: "company ongeldig" }, { status: 400 });
  if (cls && !VALID_CLS.has(cls)) return NextResponse.json({ error: "cls ongeldig (60–64/70–74)" }, { status: 400 });

  if (isDemoMode()) {
    const rows: DrillRow[] = Array.from({ length: 6 }, (_, i) => ({
      company: company || ["GTR", "GDI", "WHS"][i % 3],
      account: `${cls || "61"}${1100 + i * 10}`,
      name: `Voorbeeldrekening ${i + 1}`,
      amount: r2((6 - i) * 123_456.78),
      kind: (cls && OP_REV.has(cls) ? "income" : "expense") as DrillRow["kind"],
      bcUrl: glAccountLink(company || "GTR", `${cls || "61"}${1100 + i * 10}`),
    }));
    return NextResponse.json({
      rows, totals: { revenue: 0, costs: r2(rows.reduce((s, r) => s + r.amount, 0)) },
      count: rows.length, capped: false, from, to, demo: true,
    } satisfies DrillResponse);
  }

  const cacheKey = `units-drill-${company || "*"}-${cls || "*"}-${from}-${to}-x:${exclude.sort().join(",")}`;
  const cached = getCache<DrillResponse>(cacheKey);
  if (cached) return NextResponse.json(cached);

  try {
    const token = await getBCToken();
    const raw = await fetchBCCompanies();
    const companies = raw
      .map((c) => ({ id: String(c.id), code: String(c.name) }))
      .filter((c) => isOperatingCompany(c.code) && !exclude.includes(c.code.toUpperCase()))
      .filter((c) => !company || c.code.toUpperCase() === company);
    if (!companies.length) return NextResponse.json({ error: "geen firma in scope" }, { status: 404 });

    const lo = cls ? `${cls}0000` : "600000";
    const hi = cls ? `${cls}9999` : "799999";
    const agg = new Map<string, number>(); // `${code}|${acct}`
    const failed: string[] = [];
    for (const c of companies) {
      const filter = encodeURIComponent(
        `Posting_Date ge ${from} and Posting_Date le ${to} and G_L_Account_No ge '${lo}' and G_L_Account_No le '${hi}'`
      );
      try {
        await pageAllOData(
          `${ODATA_ROOT}/ODataV4/Company('${encodeURIComponent(c.code)}')/Grootboekposten_Excel?$filter=${filter}&$select=G_L_Account_No,Amount`,
          (e) => {
            const acct = String(e.G_L_Account_No || "");
            const c2 = acct.slice(0, 2);
            if (!OP_REV.has(c2) && !OP_COST.has(c2)) return;
            const amt = (e.Amount as number) || 0;
            const signed = OP_REV.has(c2) ? -amt : amt;
            const k = `${c.code}|${acct}`;
            agg.set(k, (agg.get(k) || 0) + signed);
          },
          token
        );
      } catch { failed.push(c.code); }
    }

    // namen: per betrokken firma (bij klasse-drill: alle betrokken firma's)
    const names: Record<string, Record<string, string>> = {};
    for (const c of companies) {
      if ([...agg.keys()].some((k) => k.startsWith(`${c.code}|`))) {
        names[c.code] = await accountNames(c.id, c.code, token);
      }
    }

    const rows: DrillRow[] = [...agg.entries()]
      .map(([k, v]) => {
        const [code, acct] = k.split("|");
        const kind: DrillRow["kind"] = OP_REV.has(acct.slice(0, 2)) ? "income" : "expense";
        return { company: code, account: acct, name: names[code]?.[acct] || "", amount: r2(v), kind, bcUrl: glAccountLink(code, acct) };
      })
      .filter((r) => Math.abs(r.amount) >= 0.005)
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
    const totals = {
      revenue: r2(rows.filter((r) => r.kind === "income").reduce((s, r) => s + r.amount, 0)),
      costs: r2(rows.filter((r) => r.kind === "expense").reduce((s, r) => s + r.amount, 0)),
    };
    const result: DrillResponse = {
      rows: rows.slice(0, CAP), totals, count: rows.length, capped: rows.length > CAP, from, to,
      ...(failed.length ? { warning: `Onvolledig: BC gaf geen antwoord voor ${failed.join(", ")}.` } : {}),
    };
    setCache(cacheKey, result, failed.length ? 2 : 30);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err).slice(0, 200) }, { status: 502 });
  }
}
