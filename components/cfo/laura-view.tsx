"use client";

// 💖 Laura-modus — supersimpel bouwblokken-dashboard voor de CFO (18/08/2026).
// Eigen roze-gouden look, volledig gescheiden van de rest ("normal mode").
// Elke blok: één groot getal, een smiley-oordeel, één zin uitleg en — als het
// niet goed gaat — "zo doen we dat". Blokken kiezen/verschuiven = de bouwdoos;
// de keuze wordt in de browser bewaard (localStorage), dus iedere kijker heeft
// haar eigen indeling. Data = exact dezelfde gevalideerde motoren als de rest.

import { useEffect, useMemo, useState } from "react";
import { usePolledData } from "./cfo-ui";
import type { CfoDagbrief } from "@/lib/dagbrief";
import type { CfoCashForecast } from "@/lib/cashforecast";
import type { CfoMgmtPnl } from "@/lib/mgmt-pnl";

// ---- het roze-gouden kleurenpaletje (bewust één vaste, lichte look) ----
const C = {
  bg: "linear-gradient(180deg,#FFF5FA 0%,#FFEFF6 55%,#FDF6EA 100%)",
  card: "#FFFFFF", rand: "#F5C6DD", titel: "#B4457E", goud: "#B8860B",
  tekst: "#4A3B44", zacht: "#9A7F8D", groen: "#1B8A5A", rood: "#C22B4A", geel: "#A87900",
};
const eurS = (v: number) => {
  const a = Math.abs(v), sign = v < 0 ? "−" : "";
  if (a >= 950_000) return `${sign}€ ${(a / 1e6).toLocaleString("nl-BE", { maximumFractionDigits: 2, minimumFractionDigits: 2 })} miljoen`;
  return `${sign}€ ${Math.round(a / 1000).toLocaleString("nl-BE")}.000`;
};

type Status = "top" | "oke" | "nietgoed" | "laden";
interface BlokUitkomst {
  waarde: string; status: Status; uitleg: string; actie?: string;
  lijst?: { naam: string; detail: string }[];
}
interface BlokDef { id: string; emoji: string; titel: string }

const STATUS_UI: Record<Status, { emoji: string; label: string; kleur: string }> = {
  top: { emoji: "🦄", label: "Dit gaat goed!", kleur: C.groen },
  oke: { emoji: "🌸", label: "Oké, in de gaten houden", kleur: C.geel },
  nietgoed: { emoji: "🚨", label: "Hier doen we het niet goed", kleur: C.rood },
  laden: { emoji: "🎀", label: "Cijfertjes worden opgehaald…", kleur: C.zacht },
};

const CATALOGUS: BlokDef[] = [
  { id: "bank", emoji: "💰", titel: "Hoeveel geld staat er op de bank?" },
  { id: "gisteren", emoji: "📥", titel: "Hoeveel kwam er gisteren binnen?" },
  { id: "openstaand", emoji: "🧾", titel: "Hoeveel moeten klanten ons nog?" },
  { id: "daling", emoji: "📉", titel: "Worden de openstaande facturen kleiner?" },
  { id: "tekort", emoji: "🔮", titel: "Komen we binnenkort geld tekort?" },
  { id: "betalers", emoji: "🏆", titel: "Wie heeft er gisteren betaald?" },
  { id: "bellen", emoji: "☎️", titel: "Wie moeten we bellen?" },
  { id: "winst", emoji: "📊", titel: "Verdienen we dit jaar geld?" },
  { id: "unicorn", emoji: "🌈", titel: "De unicorn-meter (alles samen)" },
];
const STANDAARD = ["unicorn", "bank", "gisteren", "daling", "tekort", "bellen"];

export function LauraView({ mcpUrl }: { mcpUrl: string }) {
  const dag = usePolledData<CfoDagbrief>("/api/cfo/dagbrief");
  const fc = usePolledData<CfoCashForecast>("/api/cfo/cashforecast");
  const pnl = usePolledData<CfoMgmtPnl>(`/api/cfo/pnl?year=${new Date().getFullYear()}&company=ALL`);
  const [blokken, setBlokken] = useState<string[]>(STANDAARD);
  const [bouwen, setBouwen] = useState(false);
  const [gekopieerd, setGekopieerd] = useState(false);

  useEffect(() => {
    // Na hydration de bewaarde indeling laden (setTimeout: geen synchrone
    // setState in het effect — lintregel + voorkomt hydration-mismatch).
    const t = setTimeout(() => {
      try {
        const opgeslagen = JSON.parse(localStorage.getItem("laura-blokken") || "null");
        if (Array.isArray(opgeslagen) && opgeslagen.length) setBlokken(opgeslagen.filter((b) => CATALOGUS.some((c) => c.id === b)));
      } catch { /* verse start */ }
    }, 0);
    return () => clearTimeout(t);
  }, []);
  const bewaar = (b: string[]) => { setBlokken(b); try { localStorage.setItem("laura-blokken", JSON.stringify(b)); } catch { /* prima */ } };

  const uitkomst = useMemo<Record<string, BlokUitkomst>>(() => {
    const d = dag.data, f = fc.data, p = pnl.data;
    const laden: BlokUitkomst = { waarde: "…", status: "laden", uitleg: "Even geduld, de cijfertjes komen eraan." };
    const pnlSom = (id: string) => p?.rows.find((r) => r.id === id)?.monthly.reduce((a, b) => a + b, 0) ?? null;
    const omzet = pnlSom("omzet"), resultaat = pnlSom("res_na_bel");
    const dalingOk = d?.deltaVsGister.vervallen != null ? d.deltaVsGister.vervallen <= 0 : null;
    const tekortOk = f ? f.lowPoint.withFactor.value >= 0 : null;
    const unicornScore = [d ? d.bankEigen > 0 : null, dalingOk, tekortOk, resultaat != null ? resultaat > 0 : null].filter((x) => x === true).length;

    return {
      bank: !d ? laden : {
        waarde: eurS(d.bankEigen),
        status: d.bankEigen > 250_000 ? "top" : d.bankEigen > 0 ? "oke" : "nietgoed",
        uitleg: "Dit is al ons geld dat nú echt op de bankrekeningen staat — wat we vandaag kunnen uitgeven.",
        actie: d.bankEigen <= 0 ? "Zo doen we dat: Laura vraagt de vrije kredietruimte op bij BNP en we bellen de grootste openstaande klanten." : undefined,
      },
      gisteren: !d ? laden : {
        waarde: eurS(d.ontvangenGister.totaal),
        status: d.ontvangenGister.totaal > 300_000 ? "top" : d.ontvangenGister.totaal > 100_000 ? "oke" : "nietgoed",
        uitleg: `Gisteren hebben ${d.ontvangenGister.aantal} klanten ons betaald. Elke dag hoort hier geld binnen te komen.`,
        actie: d.ontvangenGister.totaal <= 100_000 ? "Zo doen we dat: vandaag extra bellen — de bel-lijst staat in het blok ☎️." : undefined,
      },
      openstaand: !d ? laden : {
        waarde: eurS(d.openExtern),
        status: d.vervallen / Math.max(1, d.openExtern) < 0.4 ? "oke" : "nietgoed",
        uitleg: `Zoveel moeten klanten ons in totaal nog betalen. Daarvan is ${eurS(d.vervallen)} al over de afgesproken datum — dat is te veel.`,
        actie: "Zo doen we dat: elke dag bellen tot het rode stuk kleiner wordt — de daling zie je in het blok 📉.",
      },
      daling: !d ? laden : {
        waarde: d.deltaVsGister.vervallen == null ? "vanaf morgen zichtbaar" : `${d.deltaVsGister.vervallen <= 0 ? "JA 🎉 " : "NEE "}${eurS(Math.abs(d.deltaVsGister.vervallen))} ${d.deltaVsGister.vervallen <= 0 ? "minder" : "MEER"} dan gisteren`,
        status: d.deltaVsGister.vervallen == null ? "oke" : d.deltaVsGister.vervallen <= 0 ? "top" : "nietgoed",
        uitleg: "Dit is het rapport van ons belwerk: worden de te late facturen elke dag een beetje kleiner?",
        actie: d.deltaVsGister.vervallen != null && d.deltaVsGister.vervallen > 0 ? "Zo doen we dat: vandaag de top van de bel-lijst afwerken (blok ☎️)." : undefined,
      },
      tekort: !f ? laden : {
        waarde: f.lowPoint.withFactor.value >= 0 ? "Nee, het blijft boven nul" : `Ja: ${eurS(f.lowPoint.withFactor.value)} rond ${f.lowPoint.withFactor.week.slice(8, 10)}/${f.lowPoint.withFactor.week.slice(5, 7)}`,
        status: f.lowPoint.withFactor.value >= 0 ? "top" : f.lowPoint.withFactor.value > -2_000_000 ? "oke" : "nietgoed",
        uitleg: "We kijken 13 weken vooruit: al het geld dat binnenkomt min alles wat we moeten betalen. Onder nul = we leunen op de bank.",
        actie: f.lowPoint.withFactor.value < 0 ? "Zo doen we dat: de kredietlijnen dekken dit, maar sneller innen maakt het gat kleiner — zie blok ☎️." : undefined,
      },
      betalers: !d ? laden : {
        waarde: `${d.ontvangenGister.aantal} klanten`,
        status: d.ontvangenGister.aantal > 0 ? "top" : "nietgoed",
        uitleg: "Een dankjewel-lijstje: deze klanten hebben gisteren betaald.",
        lijst: d.ontvangenGister.top.slice(0, 5).map((b) => ({ naam: `${b.klant} (${b.co})`, detail: eurS(b.bedrag) })),
      },
      bellen: !d ? laden : {
        waarde: `${d.blok.d60.klanten} klanten zijn 60+ dagen te laat`,
        status: d.blok.d60.vervallen < 1_000_000 ? "oke" : "nietgoed",
        uitleg: `Samen zijn ze ${eurS(d.blok.d60.vervallen)} te laat met betalen. Dit zijn de vijf grootste — daar beginnen we:`,
        actie: "Zo doen we dat: Stijn, Laura en Nicolas bellen elk een paar namen per dag, tot Manon het overneemt.",
        lijst: d.blok.d60.lijst.slice(0, 5).map((k) => ({ naam: `${k.klant} (${k.co})`, detail: `${eurS(k.vervallen)} · oudste ${k.oudsteDagen} dagen` })),
      },
      winst: !p ? laden : {
        waarde: resultaat == null ? "…" : `${resultaat >= 0 ? "Ja: " : "Nee: "}${eurS(resultaat)}`,
        status: resultaat == null ? "laden" : resultaat > 0 ? "top" : "nietgoed",
        uitleg: `We verkochten dit jaar al voor ${omzet != null ? eurS(omzet) : "…"}. Na álle kosten blijft dit over. ${resultaat != null && resultaat < 0 ? "Minder dan nul = we maken verlies." : ""}`,
        actie: resultaat != null && resultaat < 0 ? "Zo doen we dat: de verlieslatende firma's aanpakken — het plan staat klaar in de Management-P&L (normale modus)." : undefined,
      },
      unicorn: (!d || !f) ? laden : {
        waarde: `${unicornScore} van de 4 sterren ⭐`,
        status: unicornScore >= 3 ? "top" : unicornScore === 2 ? "oke" : "nietgoed",
        uitleg: "Vier vragen in één: geld op de bank? dalen de late facturen? geen tekort op komst? maken we winst? Elke JA is een ster.",
        actie: unicornScore < 3 ? "Zo doen we dat: begin bij het blok met de 🚨 — dat is vandaag het belangrijkste." : undefined,
      },
    };
  }, [dag.data, fc.data, pnl.data]);

  const kopieer = async () => {
    try { await navigator.clipboard.writeText(mcpUrl); setGekopieerd(true); setTimeout(() => setGekopieerd(false), 2500); } catch { /* selecteer handmatig */ }
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.tekst }}>
      <div className="mx-auto max-w-[1100px] px-4 py-8">
        {/* kop */}
        <div className="text-center">
          <h1 style={{ color: C.titel }} className="text-3xl font-extrabold tracking-tight">💖 Laura-modus 🦄</h1>
          <p style={{ color: C.zacht }} className="mt-1 text-sm">
            Alles wat je wil weten, zonder te twijfelen. 🦄 = goed · 🌸 = oké · 🚨 = niet goed, en dan staat er meteen bij <b>zo doen we dat</b>.
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

        {/* bouwdoos */}
        {bouwen && (
          <div style={{ background: "#FFF9FC", border: `2px dashed ${C.rand}` }} className="mt-5 rounded-3xl p-4">
            <p style={{ color: C.titel }} className="mb-2 text-sm font-bold">🧱 Jouw bouwdoos — klik om een blok toe te voegen of weg te halen:</p>
            <div className="flex flex-wrap gap-2">
              {CATALOGUS.map((b) => {
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
            <p style={{ color: C.zacht }} className="mt-2 text-[11px]">Volgorde veranderen: gebruik de ↑ ↓ op elk blok. Jouw indeling wordt onthouden op dit toestel.</p>
          </div>
        )}

        {/* blokken */}
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {blokken.map((id, i) => {
            const def = CATALOGUS.find((c) => c.id === id)!;
            const u = uitkomst[id] || { waarde: "…", status: "laden" as Status, uitleg: "" };
            const st = STATUS_UI[u.status];
            return (
              <div key={id} style={{ background: C.card, border: `2px solid ${C.rand}`, boxShadow: "0 6px 24px -12px rgba(180,69,126,.25)" }} className="relative rounded-3xl p-5">
                {bouwen && (
                  <div className="absolute right-3 top-3 flex gap-1">
                    <button onClick={() => { if (i > 0) { const b = [...blokken]; [b[i - 1], b[i]] = [b[i], b[i - 1]]; bewaar(b); } }} style={{ border: `1.5px solid ${C.rand}`, color: C.titel }} className="rounded-full px-2 py-0.5 text-xs font-bold">↑</button>
                    <button onClick={() => { if (i < blokken.length - 1) { const b = [...blokken]; [b[i + 1], b[i]] = [b[i], b[i + 1]]; bewaar(b); } }} style={{ border: `1.5px solid ${C.rand}`, color: C.titel }} className="rounded-full px-2 py-0.5 text-xs font-bold">↓</button>
                    <button onClick={() => bewaar(blokken.filter((x) => x !== id))} style={{ border: `1.5px solid ${C.rand}`, color: C.rood }} className="rounded-full px-2 py-0.5 text-xs font-bold">✕</button>
                  </div>
                )}
                <p style={{ color: C.titel }} className="pr-16 text-sm font-extrabold">{def.emoji} {def.titel}</p>
                <p style={{ color: u.status === "nietgoed" ? C.rood : u.status === "top" ? C.groen : C.tekst }} className="mt-2 text-2xl font-black tabular-nums">{u.waarde}</p>
                <p style={{ color: st.kleur, background: "#FFF3F9", border: `1.5px solid ${C.rand}` }} className="mt-2 inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold">
                  {st.emoji} {st.label}
                </p>
                <p style={{ color: C.zacht }} className="mt-2 text-xs leading-relaxed">{u.uitleg}</p>
                {u.lijst && (
                  <div className="mt-2 space-y-1">
                    {u.lijst.map((r) => (
                      <div key={r.naam} style={{ borderBottom: `1px dashed ${C.rand}` }} className="flex items-baseline justify-between gap-2 pb-1 text-xs">
                        <span className="min-w-0 truncate font-semibold">{r.naam}</span>
                        <span style={{ color: C.goud }} className="shrink-0 font-bold tabular-nums">{r.detail}</span>
                      </div>
                    ))}
                  </div>
                )}
                {u.actie && (
                  <p style={{ color: C.tekst, background: "#FDF3DC", border: `1.5px solid #E8D49A` }} className="mt-2 rounded-2xl px-3 py-2 text-xs font-semibold leading-relaxed">
                    ✨ {u.actie}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {/* Claude koppelen — copy-paste */}
        <div style={{ background: C.card, border: `2px solid #E8D49A`, boxShadow: "0 6px 24px -12px rgba(200,160,40,.35)" }} className="mt-8 rounded-3xl p-5">
          <p style={{ color: C.goud }} className="text-sm font-extrabold">🤖✨ Vraag het gewoon aan Claude (eenmalig instellen, 2 minuutjes)</p>
          <ol style={{ color: C.tekst }} className="mt-2 list-decimal space-y-1.5 pl-5 text-xs leading-relaxed">
            <li>Open <b>claude.ai</b> → klik op je naam (linksonder) → <b>Settings</b> → <b>Connectors</b>.</li>
            <li>Klik <b>Add custom connector</b>. Naam: <b>Gheeraert Finance</b>. Plak bij URL de knop hieronder. Authenticatie: <b>None</b>. Klik <b>Add</b>.</li>
            <li>Klaar! Vraag Claude bijvoorbeeld: <i>&quot;Hoeveel geld staat er op de bank en wie moet ik vandaag bellen?&quot;</i></li>
          </ol>
          {mcpUrl ? (
            <button onClick={kopieer} style={{ background: gekopieerd ? C.groen : C.goud, color: "#fff" }} className="mt-3 rounded-full px-4 py-2 text-sm font-bold shadow-sm transition">
              {gekopieerd ? "✅ Gekopieerd! Nu plakken bij URL" : "📋 Kopieer mijn geheime koppel-URL"}
            </button>
          ) : (
            <p style={{ color: C.rood }} className="mt-3 text-xs font-semibold">Koppel-URL niet beschikbaar — vraag David.</p>
          )}
          <p style={{ color: C.zacht }} className="mt-2 text-[11px]">🤫 Deze URL is geheim (hij is jouw sleutel tot de cijfers) — niet doorsturen of delen.</p>
        </div>

        <p style={{ color: C.zacht }} className="mt-6 text-center text-[11px]">
          Zelfde echte cijfers als de normale modus (live uit Business Central) — alleen liever aangekleed. 🦄💖
        </p>
      </div>
    </div>
  );
}
