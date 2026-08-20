// Prognose-aanpassingen — de week- en maandprognose bewerkbaar maken
// (meeting 20/08/2026: "het model editable maken zodat je bepaalde waarden
// erbij kan steken"). Eigen scenario-waarden — besparingen, extra omzet uit
// sales, bankfinanciering van de historische put, aflossingen — bovenop het
// gemeten basismodel. Dit bestand is client-safe (geen fs/db-imports): de
// opslag zit in /api/cfo/cashforecast/aanpassingen, de toepassing gebeurt in
// de view bovenop de gecachete basisprognose (wijziging = meteen zichtbaar,
// zonder herbouw van het BC-model). Basis en scenario blijven gescheiden:
// voor het bankdossier moet zichtbaar zijn wat gemeten is en wat aanname is.

export type FcAdjCategorie =
  | "besparing" | "omzet" | "financiering" | "aflossing" | "kost" | "werkkapitaal" | "overig";
export type FcAdjFrequentie = "eenmalig" | "wekelijks" | "maandelijks";
export type FcAdjRichting = "in" | "uit";

export interface FcAanpassing {
  id: string;
  actief: boolean;               // uitschakelen = uit het scenario zonder te wissen
  label: string;                 // bv. "Besparing wagenpark" of "Bankfinanciering put"
  categorie: FcAdjCategorie;
  richting: FcAdjRichting;       // in = kas erbij, uit = kas eraf
  bedrag: number;                // EUR per keer (positief getal)
  frequentie: FcAdjFrequentie;
  start: string;                 // "YYYY-MM-DD" — eerste (of enige) keer
  einde?: string;                // "YYYY-MM-DD" — laatste dag (alleen bij herhalend)
  opmerking?: string;            // onderbouwing van de aanname — hoort bij het bankdossier
}

export const FC_ADJ_CATEGORIEEN: { key: FcAdjCategorie; label: string; richtingDefault: FcAdjRichting }[] = [
  { key: "besparing", label: "Besparing / optimalisatie", richtingDefault: "in" },
  { key: "omzet", label: "Extra omzet / sales", richtingDefault: "in" },
  { key: "financiering", label: "Financiering (bank)", richtingDefault: "in" },
  { key: "aflossing", label: "Aflossing / rente", richtingDefault: "uit" },
  { key: "kost", label: "Extra kost / investering", richtingDefault: "uit" },
  { key: "werkkapitaal", label: "Werkkapitaal (DSO/DPO)", richtingDefault: "in" },
  { key: "overig", label: "Overig", richtingDefault: "in" },
];

const DAY = 86400000;
const ms = (s: string) => Date.parse(`${s.length === 7 ? `${s}-01` : s}T00:00:00Z`);

// Alle voorvallen van één aanpassing als UTC-ms, binnen [vandaag, horizon).
// Verleden telt NIET mee — wat al gebeurd is zit in de echte bankstand (het
// anker van de prognose); een eenmalige post met een startdatum in het
// verleden schuift naar vandaag (bv. "financiering komt nu binnen").
function voorvallen(a: FcAanpassing, vandaagMs: number, horizonEindMs: number): number[] {
  const uit: number[] = [];
  const eind = a.einde ? ms(a.einde) : Infinity;
  if (a.frequentie === "eenmalig") {
    const t = Math.max(ms(a.start), vandaagMs);
    if (t < horizonEindMs && t <= eind) uit.push(t);
    return uit;
  }
  if (a.frequentie === "wekelijks") {
    let t = ms(a.start);
    if (t < vandaagMs) t += Math.ceil((vandaagMs - t) / (7 * DAY)) * 7 * DAY;
    for (; t <= eind && t < horizonEindMs; t += 7 * DAY) uit.push(t);
    return uit;
  }
  // maandelijks: zelfde dag van de maand als de start (geclampt op maandlengte)
  const d0 = new Date(ms(a.start));
  const dag = d0.getUTCDate();
  for (let k = 0; k < 600; k++) {
    const dim = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + k + 1, 0)).getUTCDate();
    const t = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + k, Math.min(dag, dim));
    if (t > eind || t >= horizonEindMs) break;
    if (t < vandaagMs) continue;
    uit.push(t);
  }
  return uit;
}

export interface FcAdjReeks { in: number[]; uit: number[]; net: number[] }

/** Actieve aanpassingen omzetten naar bedragen per week (zelfde raster als FcWeek[]). */
export function pasToeOpWeken(adjs: FcAanpassing[], weekStarts: string[], vandaagIso: string): FcAdjReeks {
  const n = weekStarts.length;
  const res: FcAdjReeks = { in: Array(n).fill(0), uit: Array(n).fill(0), net: Array(n).fill(0) };
  if (!n) return res;
  const w0 = ms(weekStarts[0]);
  const horizonEind = ms(weekStarts[n - 1]) + 7 * DAY;
  const vandaagMs = Math.max(ms(vandaagIso), w0);
  for (const a of adjs) {
    if (!a.actief || !(a.bedrag > 0)) continue;
    for (const t of voorvallen(a, vandaagMs, horizonEind)) {
      const i = Math.min(n - 1, Math.max(0, Math.floor((t - w0) / (7 * DAY))));
      if (a.richting === "in") { res.in[i] += a.bedrag; res.net[i] += a.bedrag; }
      else { res.uit[i] += a.bedrag; res.net[i] -= a.bedrag; }
    }
  }
  return res;
}

/** Actieve aanpassingen omzetten naar bedragen per maand ("YYYY-MM", projectiemaanden). */
export function pasToeOpMaanden(adjs: FcAanpassing[], maanden: string[], vandaagIso: string): FcAdjReeks {
  const n = maanden.length;
  const res: FcAdjReeks = { in: Array(n).fill(0), uit: Array(n).fill(0), net: Array(n).fill(0) };
  if (!n) return res;
  const idx = new Map(maanden.map((m, i) => [m, i] as const));
  const laatste = maanden[n - 1];
  const horizonEind = Date.UTC(Number(laatste.slice(0, 4)), Number(laatste.slice(5, 7)), 1); // 1e dag ná de laatste maand
  const vandaagMs = ms(vandaagIso);
  for (const a of adjs) {
    if (!a.actief || !(a.bedrag > 0)) continue;
    for (const t of voorvallen(a, vandaagMs, horizonEind)) {
      const d = new Date(t);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      const i = idx.get(key) ?? (key < maanden[0] ? 0 : -1);
      if (i < 0) continue;
      if (a.richting === "in") { res.in[i] += a.bedrag; res.net[i] += a.bedrag; }
      else { res.uit[i] += a.bedrag; res.net[i] -= a.bedrag; }
    }
  }
  return res;
}

// ---- Validatie (gedeeld door de API-route en de editor) ----
const CATS = new Set<string>(FC_ADJ_CATEGORIEEN.map((c) => c.key));
const ISO_RX = /^\d{4}-\d{2}-\d{2}$/;

export function valideerAanpassingen(input: unknown): { ok: FcAanpassing[] } | { fout: string } {
  if (!Array.isArray(input)) return { fout: "verwacht { aanpassingen: [...] }" };
  if (input.length > 200) return { fout: "maximaal 200 aanpassingen" };
  const ok: FcAanpassing[] = [];
  for (const r of input as Record<string, unknown>[]) {
    const id = String(r?.id ?? "").slice(0, 60);
    const label = String(r?.label ?? "").trim().slice(0, 120);
    const bedrag = Number(r?.bedrag);
    const start = String(r?.start ?? "");
    const einde = r?.einde ? String(r.einde) : undefined;
    const categorie = String(r?.categorie ?? "overig");
    const frequentie = String(r?.frequentie ?? "eenmalig");
    if (!id) return { fout: "aanpassing zonder id" };
    if (!label) return { fout: "elke aanpassing heeft een label nodig" };
    // Bedrag 0 mag: dat is een klaargezet concept — de toepassing (pasToeOp…)
    // slaat rijen zonder bedrag over, dus een concept is bewust inert.
    if (!Number.isFinite(bedrag) || bedrag < 0 || bedrag > 100_000_000) return { fout: `ongeldig bedrag bij "${label}"` };
    if (!ISO_RX.test(start)) return { fout: `ongeldige startdatum bij "${label}"` };
    if (einde !== undefined && (!ISO_RX.test(einde) || einde < start)) return { fout: `ongeldige einddatum bij "${label}"` };
    if (!["eenmalig", "wekelijks", "maandelijks"].includes(frequentie)) return { fout: `ongeldige frequentie bij "${label}"` };
    ok.push({
      id, actief: r?.actief !== false, label,
      categorie: (CATS.has(categorie) ? categorie : "overig") as FcAdjCategorie,
      richting: r?.richting === "uit" ? "uit" : "in",
      bedrag: Math.round(bedrag),
      frequentie: frequentie as FcAdjFrequentie,
      start,
      ...(einde ? { einde } : {}),
      ...(r?.opmerking ? { opmerking: String(r.opmerking).slice(0, 300) } : {}),
    });
  }
  return { ok };
}
