// On-demand leasing-export (Excel) voor de CFO-cockpit — zelfde vraag als het
// finance-deliverable (Laura: "effectieve leasingcash per maand per vennootschap"),
// maar live op de klik. Vaste export-featureset: pull-timestamp in bestandsnaam +
// titelrij, IC-markering, BC-deeplinks per boeking, methodiek-blad.

import ExcelJS from "exceljs";
import type { LeasingData } from "./leasing";

const EUR_FMT = '#,##0\\ "€"';
const GREEN = "FF1B4D3E", ICCLR = "FF7A5195", YELLOW = "FFFFF2CC";
const ACCT_NL: Record<string, string> = {
  "610200": "Huur motorvoertuigen", "610250": "Huur getrokken materiaal",
  "610260": "Huur logistiek materiaal", "610500": "Huur personenwagens",
};
function fill(ws: ExcelJS.Worksheet, row: number, cols: number, argb: string) {
  for (let c = 1; c <= cols; c++) ws.getCell(row, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
}
const monthNl = (m: string) => ({ "01": "jan", "02": "feb", "03": "mrt", "04": "apr", "05": "mei", "06": "jun", "07": "jul", "08": "aug", "09": "sep", "10": "okt", "11": "nov", "12": "dec" }[m.slice(5)] || m);

export async function buildLeasingWorkbook(
  data: LeasingData, pulledAt: Date
): Promise<{ buffer: ArrayBuffer; filename: string }> {
  const stamp = pulledAt.toLocaleString("nl-BE", { timeZone: "Europe/Brussels", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const fileStamp = pulledAt.toLocaleString("sv-SE", { timeZone: "Europe/Brussels" }).replace(" ", "_").replace(/:/g, "").slice(0, 15);
  const months = [...new Set((data.perCompanyMonthly || []).flatMap((c) => Object.keys(c.months)))].sort();

  const wb = new ExcelJS.Workbook();
  wb.created = pulledAt;

  // ---- blad 1: overzicht per vennootschap per maand ----
  const ws = wb.addWorksheet("Cash-out per maand");
  const headers = ["Vennootschap", "Maand", "Huur/renting (extern)", "Aflossing leasing (4222x)", "Intrest (650010)", "TOTAAL cash-out", "Nieuwe leases (cr.)"];
  const NC = headers.length;
  ws.getCell(1, 1).value = `LEASING CASH-OUT — GHEERAERT GROEP — periode ${data.period.from} t/m ${data.period.to} — data getrokken op ${stamp}`;
  ws.getCell(1, 1).font = { bold: true, size: 13, color: { argb: "FFFFFFFF" } };
  fill(ws, 1, NC, GREEN);
  ws.getRow(3).values = headers;
  ws.getRow(3).font = { bold: true, color: { argb: "FFFFFFFF" } };
  fill(ws, 3, NC, GREEN);
  [30, 10, 20, 22, 16, 16, 18].forEach((w, i) => (ws.getColumn(i + 1).width = w));

  // groepstotaal per maand bovenaan
  let r = 4;
  const gm: Record<string, { huur: number; afl: number; intrest: number; nieuw: number }> = {};
  for (const m of months) gm[m] = { huur: 0, afl: 0, intrest: 0, nieuw: 0 };
  for (const c of data.perCompanyMonthly || []) {
    for (const [m, v] of Object.entries(c.months)) {
      gm[m].huur += v.huur; gm[m].afl += v.afl; gm[m].intrest += v.intrest; gm[m].nieuw += v.nieuw;
    }
  }
  for (const m of months) {
    ws.getCell(r, 1).value = "GROEP";
    ws.getCell(r, 1).font = { bold: true };
    ws.getCell(r, 2).value = monthNl(m);
    const v = gm[m];
    [v.huur, v.afl, v.intrest, v.huur + v.afl + v.intrest, v.nieuw].forEach((x, i) => {
      const c = ws.getCell(r, 3 + i); c.value = Math.round(x); c.numFmt = EUR_FMT; c.font = { bold: true };
    });
    fill(ws, r, NC, YELLOW);
    r++;
  }
  r++;
  for (const c of data.perCompanyMonthly || []) {
    for (const m of months) {
      const v = c.months[m];
      if (!v || (!v.huur && !v.afl && !v.intrest && !v.nieuw)) continue;
      ws.getCell(r, 1).value = c.code;
      ws.getCell(r, 2).value = monthNl(m);
      [v.huur, v.afl, v.intrest, v.huur + v.afl + v.intrest, v.nieuw].forEach((x, i) => {
        const cc = ws.getCell(r, 3 + i); cc.value = x; cc.numFmt = EUR_FMT;
        if (i === 3) cc.font = { bold: true };
      });
      r++;
    }
  }
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: r - 1, column: NC } };
  ws.views = [{ state: "frozen", ySplit: 3 }];

  // ---- blad 2: boekingen (met BC-links) ----
  const ws2 = wb.addWorksheet("Boekingen");
  const h2 = ["Vennootschap", "Rekening", "Datum", "Documentnr (→ BC)", "Leverancier", "Soort", "Omschrijving", "Bedrag"];
  ws2.getCell(1, 1).value = `ALLE HUUR-/LEASINGBOEKINGEN — klik het documentnr om de post in Business Central te openen — data getrokken op ${stamp}`;
  ws2.getCell(1, 1).font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
  fill(ws2, 1, h2.length, GREEN);
  ws2.getRow(3).values = h2;
  ws2.getRow(3).font = { bold: true, color: { argb: "FFFFFFFF" } };
  fill(ws2, 3, h2.length, GREEN);
  [13, 22, 11, 18, 34, 12, 44, 13].forEach((w, i) => (ws2.getColumn(i + 1).width = w));
  let r2 = 4;
  for (const e of data.entries || []) {
    ws2.getCell(r2, 1).value = e.company;
    ws2.getCell(r2, 2).value = `${e.account} ${ACCT_NL[e.account] || ""}`.trim();
    ws2.getCell(r2, 3).value = e.date;
    if (e.bcUrl) {
      ws2.getCell(r2, 4).value = { text: e.docNo, hyperlink: e.bcUrl };
      ws2.getCell(r2, 4).font = { color: { argb: "FF1F5FA8" }, underline: true };
    } else {
      ws2.getCell(r2, 4).value = e.docNo;
    }
    ws2.getCell(r2, 5).value = e.vendor || "(memoriaal)";
    ws2.getCell(r2, 6).value = e.kind === "ic" ? "IC" : e.kind === "uitgesloten" ? "Uitgesloten" : "Extern";
    if (e.kind !== "extern") {
      ws2.getCell(r2, 6).font = { bold: true, color: { argb: e.kind === "ic" ? ICCLR : "FFB4342A" } };
    }
    ws2.getCell(r2, 7).value = e.description;
    ws2.getCell(r2, 8).value = e.amount; ws2.getCell(r2, 8).numFmt = EUR_FMT;
    r2++;
  }
  if (data.entriesCapped) {
    ws2.getCell(r2, 1).value = "LET OP: boekingenlijst afgekapt op het maximum — totalen op blad 1 zijn wél volledig.";
    ws2.getCell(r2, 1).font = { bold: true, color: { argb: "FFB4342A" } };
  }
  ws2.autoFilter = { from: { row: 3, column: 1 }, to: { row: Math.max(4, r2 - 1), column: h2.length } };
  ws2.views = [{ state: "frozen", ySplit: 3 }];

  // ---- blad 3: gefilterde leveranciers ----
  const ws3 = wb.addWorksheet("Geëlimineerd");
  ws3.getCell(1, 1).value = `GEËLIMINEERD (IC & uitgesloten leveranciers) — ter controle — ${stamp}`;
  ws3.getCell(1, 1).font = { bold: true, size: 12 };
  ws3.getRow(3).values = ["Leverancier", "Soort", "Bedrag (periode)"];
  ws3.getRow(3).font = { bold: true, color: { argb: "FFFFFFFF" } };
  fill(ws3, 3, 3, GREEN);
  ws3.getColumn(1).width = 46; ws3.getColumn(2).width = 14; ws3.getColumn(3).width = 16;
  let r3 = 4;
  for (const v of (data.vendors || []).filter((x) => x.kind !== "extern")) {
    ws3.getCell(r3, 1).value = v.name;
    ws3.getCell(r3, 2).value = v.kind === "ic" ? "IC" : "Uitgesloten";
    ws3.getCell(r3, 3).value = v.amount; ws3.getCell(r3, 3).numFmt = EUR_FMT;
    r3++;
  }
  ws3.getCell(r3 + 1, 1).value = `Totaal geëlimineerd: IC € ${Math.round(data.totals.ic).toLocaleString("nl-BE")} · uitgesloten € ${Math.round(data.totals.uitgesloten).toLocaleString("nl-BE")}`;
  ws3.getCell(r3 + 1, 1).font = { bold: true };

  // ---- blad 4: methodiek ----
  const ws4 = wb.addWorksheet("Methodiek");
  const notes = [
    `LEASING CASH-OUT — Gheeraert Groep · DATA GETROKKEN OP: ${stamp} (live uit Business Central op het moment van de klik).`,
    "",
    `Rekeningen (spec finance/Birgit, alle bedragen excl. btw): huur/renting ${data.config.accounts.join(", ")};`,
    `intresten ${(data.config.interestAccounts || []).join(", ")}; leasingschulden-prefix ${(data.config.debtAccounts || []).join(", ")}`,
    "(de mail noemde 422000; de effectieve bewegingen staan op 422200 'Leasingschulden rollend materieel' — prefix vangt beide).",
    "",
    "Cash-out = externe huur/renting (facturen) + aflossingen leasingschulden (debet 4222x) + intresten leasing.",
    "Nieuwe leases (credit 4222x) zijn géén cash-out en staan apart.",
    "",
    "Intercompany-eliminatie: leverancier per boeking via documentnr-join met de leveranciersposten; IC herkend op naam",
    "(incl. de korte schrijfwijze 'LAMBERTS & ZONEN'). Memoriaalboekingen zonder leveranciersmatch: IC herkend via de",
    `omschrijving (groepsnaam of firmacode). Uitgesloten leveranciers (geen leasing): ${(data.config.excludedVendors || []).join(", ") || "—"}.`,
    "",
    "Kanttekeningen: bedragen per BOEKINGSMAAND (bankbetaling volgt de vervaldag, ± 30–60 dagen later, incl. aftrekbare btw).",
    "Openingssaldi leasingschulden staan onvolledig in BC (migratiejaar) — het openstaande-schuld-saldo is daarom niet in dit bestand opgenomen.",
    "Doorklikken: documentnrs op het Boekingen-blad openen de post rechtstreeks in Business Central (BC-login vereist).",
    "Zelfde analyse live in het dashboard: CFO-cockpit → kaart 'Leasing & huur — rollend materieel'.",
  ];
  notes.forEach((t, i) => {
    ws4.getCell(i + 2, 2).value = t;
    ws4.getCell(i + 2, 2).font = i === 0 ? { bold: true } : { size: 10 };
  });
  ws4.getColumn(2).width = 130;

  const buffer = await wb.xlsx.writeBuffer();
  const filename = `Leasing cash-out - Gheeraert Groep - ${fileStamp}.xlsx`;
  return { buffer: buffer as ArrayBuffer, filename };
}
