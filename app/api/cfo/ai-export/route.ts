import { auth } from "@/lib/auth";
import { cfoAllowed } from "@/lib/cfo-access";
import { getCfoFinancials } from "@/lib/cfo";
import { getReceivables } from "@/lib/receivables";
import { getVat } from "@/lib/vat";
import { getBank } from "@/lib/bank";
import { getUnits } from "@/lib/units";
import { getAssets } from "@/lib/assets";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// "Export voor AI": één zelfbeschrijvend JSON-bestand met de volledige CFO-dataset
// (P&L, aging, DSO/factoring/betaalgedrag, BTW) + methodiek per sectie, zodat een
// analist of AI-assistent er direct mee kan rekenen zonder het dashboard te kennen.
export async function GET(req: Request) {
  const session = await auth().catch(() => null);
  if (!cfoAllowed(session?.user?.email)) return new Response("Forbidden", { status: 403 });

  const url = new URL(req.url);
  const exclude = (url.searchParams.get("exclude") || "").split(",").map((s) => s.trim()).filter(Boolean);

  try {
    const [cfo, rcv, vat, bank, units, assets] = await Promise.all([
      getCfoFinancials("all", undefined, undefined, false, exclude).catch((e) => ({ error: String(e).slice(0, 200) })),
      getReceivables(false, exclude).catch((e) => ({ error: String(e).slice(0, 200) })),
      getVat(false, exclude).catch((e) => ({ error: String(e).slice(0, 200) })),
      getBank(false, exclude).catch((e) => ({ error: String(e).slice(0, 200) })),
      getUnits(false, exclude).catch((e) => ({ error: String(e).slice(0, 200) })),
      getAssets(false, exclude).catch((e) => ({ error: String(e).slice(0, 200) })),
    ]);

    const bundle = {
      meta: {
        generatedAt: new Date().toISOString(),
        source: "IT Finance dashboard — Gheeraert groep (Business Central, live)",
        scopeExcluded: exclude,
        leeswijzer: [
          "Alle bedragen in EUR. P&L-cijfers (sectie cfo) zijn EXCL. btw (grootboek klasse 6/7).",
          "Klantposten/AR-cijfers (sectie klantenCash) zijn INCL. btw — dat is het te innen bedrag.",
          "DSO balansmethode = AR-eindsaldo maand ÷ gefactureerd die maand × dagen in de maand.",
          "Categorie 'extFactoring' meet time-to-cash van de factor-afwikkeling (KBC/Belfius/BNP), niet het gedrag van de eindklant.",
          "Sectie btw: maandsaldo = verschuldigde btw op verkopen − aftrekbare btw op aankopen; positief = te betalen.",
          "Elke sectie draagt 'sources' (waar komt het vandaan) en 'notes' (caveats). Neem die mee in elke analyse.",
          "Secties met {building:true} waren nog niet klaar op het moment van de export — herexporteer na enkele minuten.",
        ],
      },
      cfo,
      klantenCash: rcv,
      btw: vat,
      banken: bank,
      businessUnits: units,
      vasteActiva: assets,
    };

    const stamp = new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "");
    return new Response(JSON.stringify(bundle, null, 1), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="cfo-ai-export_${stamp}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("ai-export failed:", err);
    return Response.json({ error: String(err).slice(0, 300) }, { status: 500 });
  }
}
