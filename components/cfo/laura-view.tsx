"use client";

// 💖 Laura-modus — supersimpel bouwblokken-dashboard voor de CFO (18/08/2026).
// v2 (vraag David): op ÁLLES kunnen doorklikken — elk blok opent een paneel met
// een heel simpel diagram, sub-vraagjes in mensentaal en een link naar de
// normale modus. Catalogus uitgebreid naar 16 vragen. Data = exact dezelfde
// gevalideerde motoren als de rest van het dashboard; alleen de verpakking is
// roze en goud. Indeling wordt per toestel bewaard (localStorage).

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { usePolledData } from "./cfo-ui";
import type { CfoDagbrief } from "@/lib/dagbrief";
import type { CfoCashForecast } from "@/lib/cashforecast";
import type { CfoMgmtPnl } from "@/lib/mgmt-pnl";
import type { CfoUnits } from "@/lib/units";
import type { CfoReceivables } from "@/lib/types";

// ---- het roze-gouden paletje (bewust één vaste, lichte look) ----
const C = {
  bg: "linear-gradient(180deg,#FFF5FA 0%,#FFEFF6 55%,#FDF6EA 100%)",
  card: "#FFFFFF", rand: "#F5C6DD", titel: "#B4457E", goud: "#B8860B",
  tekst: "#4A3B44", zacht: "#9A7F8D", groen: "#1B8A5A", rood: "#C22B4A", geel: "#A87900",
  roze: "#E56AA8", grijs: "#C9BFC5",
};
const eurS = (v: number) => {
  const a = Math.abs(v), sign = v < 0 ? "−" : "";
  if (a >= 950_000) return `${sign}€ ${(a / 1e6).toLocaleString("nl-BE", { maximumFractionDigits: 2, minimumFractionDigits: 2 })} miljoen`;
  return `${sign}€ ${Math.round(a / 1000).toLocaleString("nl-BE")}.000`;
};

type Status = "top" | "oke" | "nietgoed" | "laden";
const STATUS_UI: Record<Status, { emoji: string; label: string; kleur: string }> = {
  top: { emoji: "🦄", label: "Dit gaat goed!", kleur: C.groen },
  oke: { emoji: "🌸", label: "Oké, in de gaten houden", kleur: C.geel },
  nietgoed: { emoji: "🚨", label: "Hier doen we het niet goed", kleur: C.rood },
  laden: { emoji: "🎀", label: "Cijfers worden opgehaald…", kleur: C.zacht },
};

// ---- heel simpele diagrammen (eigen SVG — groot, rond, één boodschap) ----
function Staafjes({ data, geld = true }: { data: { label: string; waarde: number; kleur?: string }[]; geld?: boolean }) {
  if (!data.length) return null;
  const max = Math.max(...data.map((d) => Math.abs(d.waarde)), 1);
  return (
    <div className="mt-3 space-y-2">
      {data.map((d) => (
        <div key={d.label} className="flex items-center gap-2">
          <span style={{ color: C.tekst }} className="w-32 shrink-0 truncate text-[11px] font-semibold">{d.label}</span>
          <div className="h-5 flex-1 overflow-hidden rounded-full" style={{ background: "#FBE9F3" }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(3, (Math.abs(d.waarde) / max) * 100)}%`, background: d.kleur || (d.waarde < 0 ? C.rood : C.roze) }} />
          </div>
          <span style={{ color: d.waarde < 0 ? C.rood : C.tekst }} className="w-24 shrink-0 text-right text-[11px] font-bold tabular-nums">
            {geld ? eurS(d.waarde) : d.waarde.toLocaleString("nl-BE")}
          </span>
        </div>
      ))}
    </div>
  );
}
function Lijntje({ punten, kleur = C.rood }: { punten: { label: string; waarde: number }[]; kleur?: string }) {
  if (punten.length < 2) return <p style={{ color: C.zacht }} className="mt-2 text-[11px]">Nog te weinig dagen — vanaf morgen tekent de lijn zichzelf. 🎀</p>;
  const w = 560, h = 120, pad = 8;
  const min = Math.min(...punten.map((p) => p.waarde)), max = Math.max(...punten.map((p) => p.waarde));
  const y = (v: number) => h - pad - ((v - min) / Math.max(1, max - min)) * (h - 2 * pad);
  const x = (i: number) => pad + (i / (punten.length - 1)) * (w - 2 * pad);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-3 w-full" role="img" aria-label="trendlijn">
      <polyline fill="none" stroke={kleur} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round"
        points={punten.map((p, i) => `${x(i)},${y(p.waarde)}`).join(" ")} />
      {punten.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.waarde)} r={5} fill="#fff" stroke={kleur} strokeWidth={3} />)}
    </svg>
  );
}

interface BlokUitkomst { waarde: string; status: Status; uitleg: string; actie?: string; lijst?: { naam: string; detail: string }[] }
interface BlokDetail { vraagjes: { q: string; a: string }[]; diagram?: ReactNode; lijst?: { naam: string; detail: string }[]; link?: { href: string; label: string } }
interface Blok { id: string; emoji: string; titel: string; kort: BlokUitkomst; detail: BlokDetail }

const STANDAARD = ["unicorn", "bank", "gisteren", "daling", "tekort", "bellen", "winst", "firmas"];

export function LauraView({ mcpUrl }: { mcpUrl: string }) {
  const jaar = new Date().getFullYear();
  const dag = usePolledData<CfoDagbrief>("/api/cfo/dagbrief");
  const fc = usePolledData<CfoCashForecast>("/api/cfo/cashforecast");
  const pnl = usePolledData<CfoMgmtPnl>(`/api/cfo/pnl?year=${jaar}&company=ALL`);
  const pnlLY = usePolledData<CfoMgmtPnl>(`/api/cfo/pnl?year=${jaar - 1}&company=ALL`);
  const units = usePolledData<CfoUnits>("/api/cfo/units");
  const rcv = usePolledData<CfoReceivables>("/api/cfo/receivables");
  const [blokken, setBlokken] = useState<string[]>(STANDAARD);
  const [bouwen, setBouwen] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [gekopieerd, setGekopieerd] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const b = JSON.parse(localStorage.getItem("laura-blokken") || "null");
        if (Array.isArray(b) && b.length) setBlokken(b);
      } catch { /* verse start */ }
    }, 0);
    return () => clearTimeout(t);
  }, []);
  const bewaar = (b: string[]) => { setBlokken(b); try { localStorage.setItem("laura-blokken", JSON.stringify(b)); } catch { /* prima */ } };

  const BLOKKEN = useMemo<Blok[]>(() => {
    const d = dag.data, f = fc.data, p = pnl.data, pl = pnlLY.data, u = units.data, r = rcv.data;
    const laden: BlokUitkomst = { waarde: "…", status: "laden", uitleg: "Even geduld, de cijfers komen eraan." };
    const geenDetail: BlokDetail = { vraagjes: [{ q: "Waar blijven de cijfers?", a: "Ze worden nu opgehaald uit Business Central — probeer zo weer. 🎀" }] };
    const som = (x: CfoMgmtPnl | null | undefined, id: string, tm?: number) => x?.rows.find((rr) => rr.id === id)?.monthly.slice(0, tm).reduce((a2, b2) => a2 + b2, 0) ?? null;
    const volleMnd = new Date().getMonth();
    const omzet = som(p, "omzet"), omzetVMnd = som(p, "omzet", volleMnd), omzetLY = som(pl, "omzet", volleMnd), resultaat = som(p, "res_na_bel");
    const wk = f?.weeks || [];
    const uitWeek = (i: number) => (wk[i] ? wk[i].outAP + wk[i].outFixed + wk[i].outNew : 0);
    const inWeek = (i: number) => (wk[i] ? wk[i].inWithFactor + wk[i].inNewWithFactor : 0);
    const maandUit = f ? uitWeek(0) + uitWeek(1) + uitWeek(2) + uitWeek(3) : null;
    const dalend = d?.deltaVsGister.vervallen != null ? d.deltaVsGister.vervallen <= 0 : null;
    const tekortOk = f ? f.lowPoint.withFactor.value >= 0 : null;
    const sterren = [d ? d.bankEigen > 0 : null, dalend, tekortOk, resultaat != null ? resultaat > 0 : null].filter((x) => x === true).length;
    const firmas = (u?.perCompany || []).filter((x) => Math.abs(x.result) > 1000);
    const slechtste = [...firmas].sort((a, b) => a.result - b.result)[0];
    const beste = [...firmas].sort((a, b) => b.result - a.result)[0];

    const alle: Blok[] = [
      {
        id: "unicorn", emoji: "🌈", titel: "De unicorn-meter (alles samen)",
        kort: (!d || !f) ? laden : {
          waarde: `${sterren} van de 4 sterren ${"⭐".repeat(Math.max(1, sterren))}`,
          status: sterren >= 3 ? "top" : sterren === 2 ? "oke" : "nietgoed",
          uitleg: "Vier vragen in één: geld op de bank? dalen de late facturen? geen tekort op komst? maken we winst? Elke JA is een ster.",
          actie: sterren < 3 ? "Zo doen we dat: begin bij het blok met de 🚨 — dat is vandaag het belangrijkste." : undefined,
        },
        detail: (!d || !f) ? geenDetail : {
          vraagjes: [
            { q: "⭐ Staat er geld op de bank?", a: d.bankEigen > 0 ? `JA — ${eurS(d.bankEigen)}.` : `NEE — ${eurS(d.bankEigen)}. We leunen op de kredietlijnen.` },
            { q: "⭐ Dalen de te late facturen?", a: dalend == null ? "Vanaf morgen meetbaar (de trend start vandaag)." : dalend ? "JA — het belwerk werkt." : "NEE — vandaag extra bellen." },
            { q: "⭐ Blijft de kas boven nul de komende 13 weken?", a: tekortOk ? "JA." : `NEE — laagste punt ${eurS(f.lowPoint.withFactor.value)}; de bank vangt dat op, maar sneller innen maakt het gat kleiner.` },
            { q: "⭐ Maken we winst dit jaar?", a: resultaat == null ? "Wordt geladen…" : resultaat > 0 ? `JA — ${eurS(resultaat)}.` : `NEE — ${eurS(resultaat)} verlies tot nu toe.` },
          ],
          link: { href: "/cfo", label: "Naar de volledige cockpit →" },
        },
      },
      {
        id: "bank", emoji: "💰", titel: "Hoeveel geld staat er op de bank?",
        kort: !d ? laden : {
          waarde: eurS(d.bankEigen), status: d.bankEigen > 250_000 ? "top" : d.bankEigen > 0 ? "oke" : "nietgoed",
          uitleg: "Dit is al ons geld dat nú echt op de bankrekeningen staat — wat we vandaag kunnen uitgeven.",
          actie: d.bankEigen <= 0 ? "Zo doen we dat: Laura vraagt de vrije kredietruimte op bij BNP en we bellen de grootste openstaande klanten." : undefined,
        },
        detail: !d ? geenDetail : {
          vraagjes: [
            { q: "Is dat veel of weinig?", a: maandUit ? `We geven de komende maand ±${eurS(maandUit)} uit — dit saldo is dus ±${Math.max(0, Math.round((d.bankEigen / maandUit) * 30))} dagen ademruimte zonder nieuwe ontvangsten.` : "We geven per maand miljoenen uit — dit saldo alleen is dus krap; gelukkig komt er ook elke dag geld binnen." },
            { q: "Welke firma heeft het meeste geld?", a: d.perFirmaBank[0] ? `${d.perFirmaBank[0].co} met ${eurS(d.perFirmaBank[0].saldo)}.` : "—" },
            { q: "Zit het geld van de factor hierin?", a: "Nee — het factorvoorschot is geleend geld (rekening 433) en tellen we bewust niet als eigen cash." },
          ],
          diagram: <Staafjes data={d.perFirmaBank.slice(0, 7).map((x) => ({ label: x.co, waarde: x.saldo }))} />,
          link: { href: "/cfo/dagbrief", label: "Naar de dagelijkse cashpositie →" },
        },
      },
      {
        id: "gisteren", emoji: "📥", titel: "Hoeveel kwam er gisteren binnen?",
        kort: !d ? laden : {
          waarde: eurS(d.ontvangenGister.totaal),
          status: d.ontvangenGister.totaal > 300_000 ? "top" : d.ontvangenGister.totaal > 100_000 ? "oke" : "nietgoed",
          uitleg: `Gisteren hebben ${d.ontvangenGister.aantal} klanten ons betaald. Elke dag hoort hier geld binnen te komen.`,
          actie: d.ontvangenGister.totaal <= 100_000 ? "Zo doen we dat: vandaag extra bellen — de bel-lijst staat in het blok ☎️." : undefined,
        },
        detail: !d ? geenDetail : {
          vraagjes: [
            { q: "Wie waren de toppers?", a: d.ontvangenGister.top.slice(0, 3).map((b) => `${b.klant} (${eurS(b.bedrag)})`).join(", ") || "Niemand — gisteren is er niets geboekt." },
            { q: "Is dit genoeg?", a: maandUit ? `Om alles te kunnen betalen hebben we gemiddeld ±${eurS(maandUit / 22)} per werkdag nodig.` : "Richtlijn: elke werkdag hoort hier een paar honderdduizend euro te staan." },
            { q: "Waarom zie ik een betaling van vandaag nog niet?", a: "We tellen op boekdatum: pas als finance de bankbestanden verwerkt heeft, verschijnt de betaling hier." },
          ],
          diagram: <Staafjes data={d.ontvangenGister.top.slice(0, 6).map((b) => ({ label: b.klant, waarde: b.bedrag, kleur: C.groen }))} />,
          link: { href: "/cfo/dagbrief", label: "Alle betalers van gisteren →" },
        },
      },
      {
        id: "openstaand", emoji: "🧾", titel: "Hoeveel moeten klanten ons nog?",
        kort: !d ? laden : {
          waarde: eurS(d.openExtern), status: d.vervallen / Math.max(1, d.openExtern) < 0.4 ? "oke" : "nietgoed",
          uitleg: `Daarvan is ${eurS(d.vervallen)} al over de afgesproken betaaldatum — dat is te veel.`,
          actie: "Zo doen we dat: elke dag bellen tot het rode stuk kleiner wordt.",
        },
        detail: !d ? geenDetail : {
          vraagjes: [
            { q: "Hoeveel is netjes op tijd?", a: `${eurS(Math.max(0, d.openExtern - d.vervallen))} — daar hoeven we niets voor te doen.` },
            { q: "En hoeveel is te laat?", a: `${eurS(d.vervallen)}. Let op: bij factoring-klanten heeft de bank ons al 85% voorgeschoten, dus de échte kaspijn is kleiner — maar bellen blijft nodig.` },
            { q: "Wat levert €100.000 ophalen op?", a: "±€85.000 extra cash meteen (bij factoring-klanten het saldo), plus minder rente betalen." },
          ],
          diagram: <Staafjes data={[
            { label: "Nog op tijd", waarde: Math.max(0, d.openExtern - d.vervallen), kleur: C.groen },
            { label: "Te laat 😠", waarde: d.vervallen, kleur: C.rood },
          ]} />,
          link: { href: "/cfo/klanten", label: "Naar Klanten & Cash →" },
        },
      },
      {
        id: "daling", emoji: "📉", titel: "Worden de openstaande facturen kleiner?",
        kort: !d ? laden : {
          waarde: d.deltaVsGister.vervallen == null ? "vanaf morgen zichtbaar" : `${d.deltaVsGister.vervallen <= 0 ? "JA 🎉 " : "NEE "}${eurS(Math.abs(d.deltaVsGister.vervallen))} ${d.deltaVsGister.vervallen <= 0 ? "minder" : "MEER"} dan gisteren`,
          status: d.deltaVsGister.vervallen == null ? "oke" : d.deltaVsGister.vervallen <= 0 ? "top" : "nietgoed",
          uitleg: "Dit is het rapport van ons belwerk: elke dag een beetje minder te laat = goed bezig.",
        },
        detail: !d ? geenDetail : {
          vraagjes: [
            { q: "Hoe wordt dit gemeten?", a: "Elke ochtend om 07:15 maken we een foto van alle openstaande facturen en vergelijken die met gisteren." },
            { q: "Wat is het doel?", a: "De rode lijn hieronder elke dag lager — dan werkt de credit-control." },
          ],
          diagram: <Lijntje punten={d.trend.map((t) => ({ label: t.dag, waarde: t.vervallen }))} />,
          link: { href: "/cfo/dagbrief", label: "Naar de trend →" },
        },
      },
      {
        id: "tekort", emoji: "🔮", titel: "Komen we binnenkort geld tekort?",
        kort: !f ? laden : {
          waarde: f.lowPoint.withFactor.value >= 0 ? "Nee, het blijft boven nul" : `Diepste punt: ${eurS(f.lowPoint.withFactor.value)}`,
          status: f.lowPoint.withFactor.value >= 0 ? "top" : f.lowPoint.withFactor.value > -2_000_000 ? "oke" : "nietgoed",
          uitleg: "13 weken vooruitkijken: alles wat binnenkomt min alles wat we moeten betalen. Onder nul = we leunen op de bank.",
          actie: f.lowPoint.withFactor.value < 0 ? "Zo doen we dat: de kredietlijnen dekken dit, maar sneller innen maakt het gat kleiner." : undefined,
        },
        detail: !f ? geenDetail : {
          vraagjes: [
            { q: "Wanneer is het het krapst?", a: `Rond de week van ${f.lowPoint.withFactor.week.slice(8, 10)}/${f.lowPoint.withFactor.week.slice(5, 7)}.` },
            { q: "Betekent rood dat we niet kunnen betalen?", a: "Nee — rood betekent: dat stuk wordt met de kredietlijn/factor betaald. Het kost wel rente." },
            { q: "Wat zit hier niet in?", a: "De kredietlijnen zelf (bewust) en btw-aangiftes na de eerstvolgende. De aannames staan allemaal op de prognosepagina." },
          ],
          diagram: <Staafjes data={wk.filter((_, i) => i % 2 === 0).map((w) => ({ label: `wk ${w.weekStart.slice(8, 10)}/${w.weekStart.slice(5, 7)}`, waarde: w.cumWithFactor }))} />,
          link: { href: "/cfo/cashflow", label: "Naar de volledige prognose →" },
        },
      },
      {
        id: "betalenweek", emoji: "📅", titel: "Wat moeten wíj deze maand betalen?",
        kort: !f ? laden : {
          waarde: maandUit != null ? eurS(maandUit) : "…", status: "oke",
          uitleg: "Alles wat de komende 4 weken de deur uit moet: leveranciers, lonen, btw en leasing.",
        },
        detail: !f ? geenDetail : {
          vraagjes: [
            { q: "Wat is de grootste hap?", a: `Lonen (±${eurS(f.totals.payrollMonthly)} per maand) en de btw (±${eurS(f.totals.btw)} op de 20e).` },
            { q: "Komt er ook genoeg binnen?", a: `De komende 4 weken verwachten we ±${eurS(inWeek(0) + inWeek(1) + inWeek(2) + inWeek(3))} aan ontvangsten.` },
          ],
          diagram: <Staafjes data={[0, 1, 2, 3].map((i) => ({ label: `week ${i + 1}`, waarde: -uitWeek(i), kleur: C.rood }))} />,
          link: { href: "/cfo/cashflow", label: "Week per week bekijken →" },
        },
      },
      {
        id: "betalers", emoji: "🏆", titel: "Wie heeft er gisteren betaald?",
        kort: !d ? laden : {
          waarde: `${d.ontvangenGister.aantal} klanten`, status: d.ontvangenGister.aantal > 0 ? "top" : "nietgoed",
          uitleg: "Deze klanten hebben gisteren betaald — een bedankje waard.",
          lijst: d.ontvangenGister.top.slice(0, 5).map((b) => ({ naam: `${b.klant} (${b.co})`, detail: eurS(b.bedrag) })),
        },
        detail: !d ? geenDetail : {
          vraagjes: [{ q: "Waar zie ik de hele lijst?", a: "Op de dagelijkse cashpositie — elke klant is daar klikbaar tot in Business Central." }],
          lijst: d.ontvangenGister.top.slice(0, 15).map((b) => ({ naam: `${b.klant} (${b.co})`, detail: eurS(b.bedrag) })),
          link: { href: "/cfo/dagbrief", label: "Naar de volledige lijst →" },
        },
      },
      {
        id: "bellen", emoji: "☎️", titel: "Wie moeten we bellen?",
        kort: !d ? laden : {
          waarde: `${d.blok.d60.klanten} klanten zijn 60+ dagen te laat`,
          status: d.blok.d60.vervallen < 1_000_000 ? "oke" : "nietgoed",
          uitleg: `Samen ${eurS(d.blok.d60.vervallen)} te laat. Dit zijn de grootste — daar beginnen we:`,
          actie: "Zo doen we dat: Stijn, Laura en Nicolas bellen elk een paar namen per dag, tot Manon het overneemt.",
          lijst: d.blok.d60.lijst.slice(0, 5).map((k) => ({ naam: `${k.klant} (${k.co})`, detail: `${eurS(k.vervallen)} · ${k.oudsteDagen} dagen` })),
        },
        detail: !d ? geenDetail : {
          vraagjes: [
            { q: "Zouden we ze blokkeren?", a: `Bij een 60-dagengrens raak je ${d.blok.d60.klanten} klanten en ±${eurS(d.blok.d60.omzet12m)} jaaromzet; bij 75 dagen ${d.blok.d75.klanten} klanten. Dat is een botte bijl — eerst bellen dus.` },
            { q: "Wat zeg ik aan de telefoon?", a: "“We zien factuur X van Y euro open staan sinds Z — wanneer mogen we de betaling verwachten?” Vriendelijk, concreet, met datum." },
          ],
          lijst: d.blok.d60.lijst.slice(0, 15).map((k) => ({ naam: `${k.klant} (${k.co})`, detail: `${eurS(k.vervallen)} · oudste ${k.oudsteDagen} d` })),
          link: { href: "/cfo/dagbrief", label: "Naar de blokkeeranalyse →" },
        },
      },
      {
        id: "winst", emoji: "📊", titel: "Verdienen we dit jaar geld?",
        kort: !p ? laden : {
          waarde: resultaat == null ? "…" : `${resultaat >= 0 ? "Ja: " : "Nee: "}${eurS(resultaat)}`,
          status: resultaat == null ? "laden" : resultaat > 0 ? "top" : "nietgoed",
          uitleg: `We verkochten dit jaar al voor ${omzet != null ? eurS(omzet) : "…"}. Na álle kosten blijft dit over.`,
          actie: resultaat != null && resultaat < 0 ? "Zo doen we dat: de verlieslatende firma's aanpakken — zie het blok 🏢." : undefined,
        },
        detail: !p ? geenDetail : {
          vraagjes: [
            { q: "Waar gaat het geld naartoe?", a: omzet != null && resultaat != null ? `Van elke €100 omzet blijft er ${Math.round((resultaat / omzet) * 100)} over — de rest gaat naar chauffeurs, diesel, huur, onderaannemers en afschrijvingen.` : "…" },
            { q: "Is één cijfer genoeg?", a: "Nee — daarom bestaat de Management-P&L met elke kostensoort apart, tot op de factuur klikbaar." },
          ],
          diagram: omzet != null && resultaat != null ? <Staafjes data={[
            { label: "Verkocht", waarde: omzet, kleur: C.groen },
            { label: "Alle kosten", waarde: -(omzet - resultaat), kleur: C.rood },
            { label: "Blijft over", waarde: resultaat, kleur: resultaat >= 0 ? C.goud : C.rood },
          ]} /> : undefined,
          link: { href: "/cfo/pnl", label: "Naar de Management-P&L →" },
        },
      },
      {
        id: "firmas", emoji: "🏢", titel: "Welke firma doet het goed — en welke niet?",
        kort: !u ? laden : {
          waarde: slechtste ? `${slechtste.code}: ${eurS(slechtste.result)}` : "…",
          status: slechtste && slechtste.result < -100_000 ? "nietgoed" : "oke",
          uitleg: beste && slechtste ? `Beste: ${beste.code} (${eurS(beste.result)}). Slechtste: ${slechtste.code}.` : "Per firma: wat blijft er over na alle kosten?",
          actie: slechtste && slechtste.result < -100_000 ? `Zo doen we dat: het fixplan per firma staat klaar (verliesdiagnose) — begin bij ${slechtste.code}.` : undefined,
        },
        detail: !u ? geenDetail : {
          vraagjes: [
            { q: "Betekent verlies bij één firma dat de groep verliest?", a: "Niet per se — firma's werken voor elkaar (interne tarieven). Maar structureel verlies zonder interne verklaring moet gefixt." },
            { q: "Waar staat het plan?", a: "In de CEO-signalenkaart op Business Units: per firma FIXEN / verrekenprijs-check / opvolgen." },
          ],
          diagram: <Staafjes data={[...firmas].sort((a, b) => b.result - a.result).slice(0, 9).map((x) => ({ label: x.code, waarde: x.result, kleur: x.result < 0 ? C.rood : C.groen }))} />,
          link: { href: "/cfo/units", label: "Naar Business Units →" },
        },
      },
      {
        id: "meerdanvorigjaar", emoji: "📈", titel: "Verkopen we meer dan vorig jaar?",
        kort: (omzetVMnd == null || omzetLY == null) ? laden : {
          waarde: omzetLY > 0 ? `${omzetVMnd >= omzetLY ? "+" : ""}${Math.round(((omzetVMnd - omzetLY) / omzetLY) * 100)}%` : "…",
          status: omzetVMnd >= omzetLY ? "top" : "nietgoed",
          uitleg: `Zelfde maanden vergeleken: dit jaar ${eurS(omzetVMnd)} vs vorig jaar ${eurS(omzetLY)}.`,
        },
        detail: (omzetVMnd == null || omzetLY == null) ? geenDetail : {
          vraagjes: [{ q: "Waarom alleen volle maanden?", a: "De lopende maand is nog niet volledig geboekt — die meenemen zou vals spelen." }],
          diagram: <Staafjes data={[{ label: `${jaar - 1}`, waarde: omzetLY, kleur: C.grijs }, { label: `${jaar}`, waarde: omzetVMnd, kleur: C.roze }]} />,
          link: { href: "/cfo/pnl", label: "Maand per maand bekijken →" },
        },
      },
      {
        id: "dso", emoji: "⏱️", titel: "Hoe snel betalen klanten ons?",
        kort: !r ? laden : {
          waarde: r.dsoNow.total != null ? `${r.dsoNow.total} dagen` : "…",
          status: r.dsoNow.total == null ? "laden" : r.dsoNow.total <= 45 ? "top" : r.dsoNow.total <= 60 ? "oke" : "nietgoed",
          uitleg: "Gemiddeld aantal dagen tussen factuur en geld op de rekening (DSO). Afspraak is 30 dagen.",
          actie: r.dsoNow.total != null && r.dsoNow.total > 60 ? "Zo doen we dat: elke dag DSO minder = rente en ademruimte gewonnen — bellen dus." : undefined,
        },
        detail: !r ? geenDetail : {
          vraagjes: [
            { q: "En de factoring-klanten?", a: r.dsoNow.extFactoring != null ? `Die betalen (via de factor) in ±${r.dsoNow.extFactoring} dagen.` : "…" },
            { q: "En de rest?", a: r.dsoNow.extOther != null ? `De niet-gefactorde klanten doen er ±${r.dsoNow.extOther} dagen over — dáár zit de winst.` : "…" },
            { q: "Hoe snel betalen wíj (DPO)?", a: r.dsoNow.dpo != null ? `±${r.dsoNow.dpo} dagen — sneller dan klanten óns betalen; dat gat is precies waarom cash knelt.` : "…" },
          ],
          diagram: <Staafjes geld={false} data={[
            { label: "Afspraak", waarde: 30, kleur: C.grijs },
            { label: "Factoring-klanten", waarde: r.dsoNow.extFactoring ?? 0, kleur: C.roze },
            { label: "Overige klanten", waarde: r.dsoNow.extOther ?? 0, kleur: C.rood },
          ]} />,
          link: { href: "/cfo/klanten", label: "Naar Klanten & Cash →" },
        },
      },
      {
        id: "factor", emoji: "🏦", titel: "Hoeveel hebben we bij de factor opgenomen?",
        kort: !f ? laden : {
          waarde: eurS(f.totals.saldo433), status: "oke",
          uitleg: "De bank schiet 85% van onze facturen voor — dit is wat er nu van dat voorschot openstaat (geleend geld).",
        },
        detail: !f ? geenDetail : {
          vraagjes: [
            { q: "Is dat erg?", a: "Nee, daar dient factoring voor — het is onze goedkoopste financiering. Maar het is geleend: stoppen zou eenmalig veel cash kosten." },
            { q: "Wat kost het?", a: "±€265.000 per jaar aan loon en rente voor de hele groep (Cost-of-cash-analyse)." },
          ],
          diagram: <Staafjes data={(f.perCompany || []).filter((x) => x.saldo433 !== 0).map((x) => ({ label: x.company, waarde: x.saldo433 }))} />,
          link: { href: "/cfo/cashflow", label: "Naar de 433-monitor →" },
        },
      },
      {
        id: "rommel", emoji: "🧹", titel: "Hoeveel geld wacht op opruimwerk?",
        kort: !f ? laden : {
          waarde: eurS(Math.abs(f.totals.unapplied)),
          status: Math.abs(f.totals.unapplied) < 500_000 ? "oke" : "nietgoed",
          uitleg: `${f.totals.unappliedCount} ontvangen betalingen zijn nog niet aan een factuur gekoppeld — het geld is er al, de administratie nog niet.`,
          actie: "Zo doen we dat: het boekhoudteam werkt het afpuntwerkdossier af — elke opgeruimde post maakt de cijfers schoner.",
        },
        detail: !f ? geenDetail : {
          vraagjes: [
            { q: "Is dit verloren geld?", a: "Nee! Het staat al op de bank. Het moet alleen aan de juiste facturen gekoppeld worden." },
            { q: "Waarom is opruimen belangrijk?", a: "Anders lijken klanten nog te moeten betalen die al betaald hebben — en bellen we de verkeerde mensen." },
          ],
          lijst: (f.unappliedDetail || []).slice(0, 10).map((x2) => ({ naam: `${x2.party} (${x2.co})`, detail: eurS(x2.amount) })),
          link: { href: "/cfo/cashflow", label: "Naar de niet-toegewezen-monitor →" },
        },
      },
      {
        id: "restjaar", emoji: "🌦️", titel: "Hoe ziet de rest van het jaar eruit?",
        kort: !f ? laden : {
          waarde: (() => { const proj = f.months.filter((m) => !m.isActual); const eind = proj[Math.min(11, proj.length - 1)]; return eind ? eurS(eind.cum) : "…"; })(),
          status: "oke",
          uitleg: "Het verwachte banksaldo over 12 maanden, op het ritme van vorig jaar × hoe we nu draaien. Eerste 6 maanden concreet, daarna grijs.",
        },
        detail: !f ? geenDetail : {
          vraagjes: [
            { q: "Hoe weten we dat nu al?", a: "December lijkt op december: we volgen het echte bankritme van vorig jaar, bijgestuurd met de omzettrend van dit jaar." },
            { q: "Is dit een belofte?", a: "Nee — een weersvoorspelling. De eerste 6 maanden zijn vrij zeker, daarna wordt het grijzer (letterlijk)." },
          ],
          diagram: <Staafjes data={f.months.filter((m) => !m.isActual).slice(0, 12).map((m, i) => ({ label: m.month, waarde: m.cum, kleur: i < 6 ? (m.cum < 0 ? C.rood : C.roze) : C.grijs }))} />,
          link: { href: "/cfo/cashflow", label: "Naar de maandvooruitblik →" },
        },
      },
      {
        id: "grootste", emoji: "🧨", titel: "Wat is de grootste open post?",
        kort: !d ? laden : {
          waarde: d.blok.d60.lijst[0] ? `${d.blok.d60.lijst[0].klant}: ${eurS(d.blok.d60.lijst[0].vervallen)}` : "…",
          status: d.blok.d60.lijst[0] && d.blok.d60.lijst[0].vervallen > 300_000 ? "nietgoed" : "oke",
          uitleg: "De allergrootste te late betaler — die verdient vandaag een telefoontje van iemand met gezag.",
          actie: "Zo doen we dat: grote posten escaleren naar Silvio/Nicolas in plaats van de gewone herinnering.",
        },
        detail: !d ? geenDetail : {
          vraagjes: [{ q: "Wie staan er nog meer bovenaan?", a: "De top 15 staat hieronder — elk met hoe oud de oudste factuur is." }],
          lijst: d.blok.d60.lijst.slice(0, 15).map((k) => ({ naam: `${k.klant} (${k.co})`, detail: `${eurS(k.vervallen)} · ${k.oudsteDagen} d` })),
          link: { href: "/cfo/dagbrief", label: "Naar de bel-lijst →" },
        },
      },
    ];
    return alle;
  }, [dag.data, fc.data, pnl.data, pnlLY.data, units.data, rcv.data, jaar]);

  const openBlok = open ? BLOKKEN.find((b) => b.id === open) : null;
  const kopieer = async () => {
    try { await navigator.clipboard.writeText(mcpUrl); setGekopieerd(true); setTimeout(() => setGekopieerd(false), 2500); } catch { /* handmatig */ }
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.tekst }}>
      <div className="mx-auto max-w-[1100px] px-4 py-8">
        <div className="text-center">
          <h1 style={{ color: C.titel }} className="text-3xl font-extrabold tracking-tight">💖 Laura-modus 🦄</h1>
          <p style={{ color: C.zacht }} className="mt-1 text-sm">
            Klik op een blok voor het hele verhaal: een simpel diagram, de antwoorden op je vragen én waar je verder kan kijken.
            🦄 = goed · 🌸 = oké · 🚨 = niet goed (met <b>zo doen we dat</b>).
          </p>
          <div className="mt-3 flex items-center justify-center gap-2">
            <button onClick={() => setBouwen(!bouwen)}
              style={{ background: bouwen ? C.titel : "#FBDCEB", color: bouwen ? "#fff" : C.titel, border: `2px solid ${C.rand}` }}
              className="rounded-full px-4 py-1.5 text-sm font-bold shadow-sm transition">
              {bouwen ? "✅ Klaar met bouwen" : "🧱 Blokken kiezen"}
            </button>
            <a href="/cfo" style={{ color: C.zacht, border: `2px solid ${C.rand}`, background: "#fff" }} className="rounded-full px-4 py-1.5 text-sm font-bold shadow-sm">
              Normale modus →
            </a>
          </div>
        </div>

        {bouwen && (
          <div style={{ background: "#FFF9FC", border: `2px dashed ${C.rand}` }} className="mt-5 rounded-3xl p-4">
            <p style={{ color: C.titel }} className="mb-2 text-sm font-bold">🧱 Jouw bouwdoos — klik om een vraag toe te voegen of weg te halen:</p>
            <div className="flex flex-wrap gap-2">
              {BLOKKEN.map((b) => {
                const actief = blokken.includes(b.id);
                return (
                  <button key={b.id}
                    onClick={() => bewaar(actief ? blokken.filter((x) => x !== b.id) : [...blokken, b.id])}
                    style={{ background: actief ? C.titel : "#fff", color: actief ? "#fff" : C.tekst, border: `2px solid ${actief ? C.titel : C.rand}` }}
                    className="rounded-full px-3 py-1.5 text-xs font-bold transition">
                    {b.emoji} {b.titel} {actief ? "✓" : "＋"}
                  </button>
                );
              })}
            </div>
            <p style={{ color: C.zacht }} className="mt-2 text-[11px]">Volgorde: ↑ ↓ op elk blok. Jouw indeling wordt op dit toestel onthouden.</p>
          </div>
        )}

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {blokken.map((id, i) => {
            const b = BLOKKEN.find((x) => x.id === id);
            if (!b) return null;
            const st = STATUS_UI[b.kort.status];
            return (
              <div key={id} style={{ background: C.card, border: `2px solid ${C.rand}`, boxShadow: "0 6px 24px -12px rgba(180,69,126,.25)" }} className="relative rounded-3xl p-5 text-left transition hover:-translate-y-0.5">
                {bouwen && (
                  <div className="absolute right-3 top-3 z-10 flex gap-1">
                    <button onClick={() => { if (i > 0) { const bb = [...blokken]; [bb[i - 1], bb[i]] = [bb[i], bb[i - 1]]; bewaar(bb); } }} style={{ border: `1.5px solid ${C.rand}`, color: C.titel, background: "#fff" }} className="rounded-full px-2 py-0.5 text-xs font-bold">↑</button>
                    <button onClick={() => { if (i < blokken.length - 1) { const bb = [...blokken]; [bb[i + 1], bb[i]] = [bb[i], bb[i + 1]]; bewaar(bb); } }} style={{ border: `1.5px solid ${C.rand}`, color: C.titel, background: "#fff" }} className="rounded-full px-2 py-0.5 text-xs font-bold">↓</button>
                    <button onClick={() => bewaar(blokken.filter((x) => x !== id))} style={{ border: `1.5px solid ${C.rand}`, color: C.rood, background: "#fff" }} className="rounded-full px-2 py-0.5 text-xs font-bold">✕</button>
                  </div>
                )}
                <button onClick={() => setOpen(b.id)} className="block w-full text-left" title="Klik voor het hele verhaal">
                  <p style={{ color: C.titel }} className="pr-16 text-sm font-extrabold">{b.emoji} {b.titel}</p>
                  <p style={{ color: b.kort.status === "nietgoed" ? C.rood : b.kort.status === "top" ? C.groen : C.tekst }} className="mt-2 text-2xl font-black tabular-nums">{b.kort.waarde}</p>
                  <p style={{ color: st.kleur, background: "#FFF3F9", border: `1.5px solid ${C.rand}` }} className="mt-2 inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold">
                    {st.emoji} {st.label}
                  </p>
                  <p style={{ color: C.zacht }} className="mt-2 text-xs leading-relaxed">{b.kort.uitleg}</p>
                  {b.kort.lijst && (
                    <div className="mt-2 space-y-1">
                      {b.kort.lijst.map((r2) => (
                        <div key={r2.naam} style={{ borderBottom: `1px dashed ${C.rand}` }} className="flex items-baseline justify-between gap-2 pb-1 text-xs">
                          <span className="min-w-0 truncate font-semibold">{r2.naam}</span>
                          <span style={{ color: C.goud }} className="shrink-0 font-bold tabular-nums">{r2.detail}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {b.kort.actie && (
                    <p style={{ color: C.tekst, background: "#FDF3DC", border: "1.5px solid #E8D49A" }} className="mt-2 rounded-2xl px-3 py-2 text-xs font-semibold leading-relaxed">✨ {b.kort.actie}</p>
                  )}
                  <p style={{ color: C.roze }} className="mt-2 text-[11px] font-bold">👆 Klik voor het hele verhaal</p>
                </button>
              </div>
            );
          })}
        </div>

        {/* detailpaneel */}
        {openBlok && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(74,59,68,.45)" }} onClick={() => setOpen(null)}>
            <div style={{ background: C.card, border: `3px solid ${C.rand}` }} className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-3xl p-6" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-start justify-between gap-3">
                <h2 style={{ color: C.titel }} className="text-lg font-extrabold">{openBlok.emoji} {openBlok.titel}</h2>
                <button onClick={() => setOpen(null)} style={{ border: `2px solid ${C.rand}`, color: C.titel }} className="rounded-full px-3 py-1 text-sm font-bold">✕ sluit</button>
              </div>
              <p style={{ color: openBlok.kort.status === "nietgoed" ? C.rood : openBlok.kort.status === "top" ? C.groen : C.tekst }} className="mt-2 text-3xl font-black tabular-nums">{openBlok.kort.waarde}</p>
              {openBlok.detail.diagram}
              <div className="mt-4 space-y-3">
                {openBlok.detail.vraagjes.map((v) => (
                  <div key={v.q}>
                    <p style={{ color: C.titel }} className="text-sm font-bold">❓ {v.q}</p>
                    <p style={{ color: C.tekst }} className="mt-0.5 text-sm leading-relaxed">{v.a}</p>
                  </div>
                ))}
              </div>
              {openBlok.detail.lijst && (
                <div className="mt-4 space-y-1">
                  {openBlok.detail.lijst.map((r2) => (
                    <div key={r2.naam} style={{ borderBottom: `1px dashed ${C.rand}` }} className="flex items-baseline justify-between gap-2 pb-1 text-sm">
                      <span className="min-w-0 truncate font-semibold">{r2.naam}</span>
                      <span style={{ color: C.goud }} className="shrink-0 font-bold tabular-nums">{r2.detail}</span>
                    </div>
                  ))}
                </div>
              )}
              {openBlok.detail.link && (
                <a href={openBlok.detail.link.href} style={{ background: C.titel, color: "#fff" }} className="mt-5 inline-block rounded-full px-4 py-2 text-sm font-bold">
                  {openBlok.detail.link.label}
                </a>
              )}
            </div>
          </div>
        )}

        {/* Claude koppelen */}
        <div style={{ background: C.card, border: "2px solid #E8D49A", boxShadow: "0 6px 24px -12px rgba(200,160,40,.35)" }} className="mt-8 rounded-3xl p-5">
          <p style={{ color: C.goud }} className="text-sm font-extrabold">🤖✨ Vraag het gewoon aan Claude (eenmalig instellen, 2 minuten)</p>
          <ol style={{ color: C.tekst }} className="mt-2 list-decimal space-y-1.5 pl-5 text-xs leading-relaxed">
            <li>Open <b>claude.ai</b> → klik op je naam (linksonder) → <b>Settings</b> → <b>Connectors</b>.</li>
            <li>Klik <b>Add custom connector</b>. Naam: <b>Gheeraert Finance</b>. Plak bij URL de knop hieronder. Authenticatie: <b>None</b>. Klik <b>Add</b>.</li>
            <li>Klaar! Vraag bijvoorbeeld: <i>&quot;Hoeveel geld staat er op de bank en wie moet ik vandaag bellen?&quot;</i></li>
          </ol>
          {mcpUrl ? (
            <button onClick={kopieer} style={{ background: gekopieerd ? C.groen : C.goud, color: "#fff" }} className="mt-3 rounded-full px-4 py-2 text-sm font-bold shadow-sm transition">
              {gekopieerd ? "✅ Gekopieerd! Nu plakken bij URL" : "📋 Kopieer mijn geheime koppel-URL"}
            </button>
          ) : (
            <p style={{ color: C.rood }} className="mt-3 text-xs font-semibold">Koppel-URL niet beschikbaar — vraag David.</p>
          )}
          <p style={{ color: C.zacht }} className="mt-2 text-[11px]">🤫 Deze URL is geheim (jouw sleutel tot de cijfers) — niet doorsturen of delen.</p>
        </div>

        <p style={{ color: C.zacht }} className="mt-6 text-center text-[11px]">
          Zelfde echte cijfers als de normale modus (live uit Business Central) — alleen liever aangekleed. 🦄💖
        </p>
      </div>
    </div>
  );
}
