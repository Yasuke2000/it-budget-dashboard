// GET /api/cfo/gl?account=613300&from=2026-01-01&to=2026-07-23&exclude=GPR,GRE
// Drill-down bottom for the CFO cockpit: the individual GL postings behind one
// account, across the consolidation scope, each with a BC deep-link (vindplaats,
// geen payload — zelfde conventie als de exports). CFO-allowlist-gated, net als /cfo.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { cfoAllowed } from "@/lib/cfo-access";
import { fetchBCCompanies, fetchBCGlEntriesForAccount } from "@/lib/bc-client";
import { glDocumentLink, glAccountLink } from "@/lib/bc-links";
import { getCache, setCache } from "@/lib/sync-cache";

export const dynamic = "force-dynamic";

interface GlDrillEntry {
  company: string;      // korte firmacode (GTR, GDI, …)
  date: string;
  documentNumber: string;
  description: string;
  amount: number;       // signed by class kind (7x credit-normaal, 6x debet-normaal)
  bcUrl: string;
}
interface GlDrillResponse {
  account: string;
  entries: GlDrillEntry[];
  count: number;        // totaal aantal posten (vóór cap)
  total: number;        // som over ALLE posten
  capped: boolean;
  accountLinks: { company: string; url: string }[]; // "alle posten van deze rekening in BC"
  demo?: boolean;
  note?: string;
}

const CAP = 300;

function isOperatingCompany(name: string): boolean {
  return !/^_/.test(name) && !/test|copie|fleetmate/i.test(name);
}

export async function GET(req: NextRequest) {
  const session = await auth().catch(() => null);
  if (!cfoAllowed(session?.user?.email)) {
    return NextResponse.json({ error: "CFO-toegang vereist" }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const account = (sp.get("account") || "").trim();
  const from = sp.get("from") || "";
  const to = sp.get("to") || "";
  const exclude = (sp.get("exclude") || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (!/^\d{3,10}$/.test(account) || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ error: "account/from/to ongeldig" }, { status: 400 });
  }

  // Demomodus: toon werkende voorbeeldposten zodat de flow te zien is.
  if (process.env.NEXT_PUBLIC_DEMO_MODE !== "false") {
    const entries: GlDrillEntry[] = Array.from({ length: 8 }, (_, i) => ({
      company: ["GTR", "GDI", "WHS"][i % 3],
      date: `2026-0${(i % 6) + 1}-1${i}`,
      documentNumber: `1191007${80 + i}`,
      description: `Voorbeeldboeking ${i + 1} op ${account}`,
      amount: Math.round((8 - i) * 12_345.67),
      bcUrl: glDocumentLink(["GTR", "GDI", "WHS"][i % 3], `1191007${80 + i}`),
    }));
    return NextResponse.json({
      account, entries, count: entries.length, total: entries.reduce((s, e) => s + e.amount, 0),
      capped: false, accountLinks: [{ company: "GTR", url: glAccountLink("GTR", account) }],
      demo: true, note: "Demomodus — voorbeeldposten; de BC-links volgen wel het echte formaat.",
    } satisfies GlDrillResponse);
  }

  const cacheKey = `cfo-gl-${account}-${from}-${to}-x:${exclude.sort().join(",")}`;
  const cached = getCache<GlDrillResponse>(cacheKey);
  if (cached) return NextResponse.json(cached);

  try {
    const raw = await fetchBCCompanies();
    const companies = raw
      .map((c) => ({ id: String(c.id), code: String(c.name) }))
      .filter((c) => isOperatingCompany(c.code) && !exclude.includes(c.code.toUpperCase()));

    // 7x is credit-normaal (opbrengsten), al de rest debet-normaal.
    const sign = account.startsWith("7") ? -1 : 1;
    const all: GlDrillEntry[] = [];
    const CHUNK = 3;
    for (let i = 0; i < companies.length; i += CHUNK) {
      const batch = companies.slice(i, i + CHUNK);
      const parts = await Promise.all(batch.map(async (c) => {
        const rows = await fetchBCGlEntriesForAccount(c.id, account, from, to).catch(() => []);
        return rows.map((r) => ({
          company: c.code,
          date: r.postingDate,
          documentNumber: r.documentNumber,
          description: r.description,
          amount: Math.round((r.debit - r.credit) * sign * 100) / 100,
          bcUrl: glDocumentLink(c.code, r.documentNumber),
        }));
      }));
      for (const p of parts) all.push(...p.slice(0, 5000)); // spread-guard per firma
    }

    all.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
    const total = Math.round(all.reduce((s, e) => s + e.amount, 0));
    const result: GlDrillResponse = {
      account,
      entries: all.slice(0, CAP),
      count: all.length,
      total,
      capped: all.length > CAP,
      accountLinks: companies
        .filter((c) => all.some((e) => e.company === c.code))
        .map((c) => ({ company: c.code, url: glAccountLink(c.code, account) })),
    };
    setCache(cacheKey, result, 30); // 30 min — drill is een leesvenster, geen rapport
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err).slice(0, 200) }, { status: 502 });
  }
}
