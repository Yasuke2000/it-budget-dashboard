// Excel-export van de Klanten & Cash-data — "doorklikken naar de bron" (CFO-vraag
// 04/08/2026). Zelfde vaste featureset als de andere exports: pull-timestamp in de
// bestandsnaam én op het titelblad, IC-markering, BC-deeplinks per post en een
// methodiek-blad dat per kolom zegt waar het cijfer vandaan komt.

import ExcelJS from "exceljs";
import type { CfoReceivables } from "./types";

const EUR = '#,##0.00;[Red]-#,##0.00';
const stamp = (d: Date) =>
  new Intl.DateTimeFormat("nl-BE", { timeZone: "Europe/Brussels", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);

function titleRow(ws: ExcelJS.Worksheet, title: string, sub: string, cols: number) {
  ws.mergeCells(1, 1, 1, cols);
  const t = ws.getCell(1, 1);
  t.value = title;
  t.font = { bold: true, size: 13 };
  ws.mergeCells(2, 1, 2, cols);
  const s = ws.getCell(2, 1);
  s.value = sub;
  s.font = { size: 9, color: { argb: "FF666666" } };
  ws.getRow(3).height = 4;
}
function header(ws: ExcelJS.Worksheet, row: number, cells: string[]) {
  const r = ws.getRow(row);
  cells.forEach((c, i) => {
    const cell = r.getCell(i + 1);
    cell.value = c;
    cell.font = { bold: true, size: 9 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };
    cell.border = { bottom: { style: "thin", color: { argb: "FFBBBBBB" } } };
  });
  ws.views = [{ state: "frozen", ySplit: row }];
  r.commit();
}

export async function buildRcvWorkbook(d: CfoReceivables, pulledAt: Date): Promise<{ buffer: ArrayBuffer; filename: string }> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "IT Finance dashboard — Gheeraert";
  wb.created = pulledAt;
  // Demodata mag geëxporteerd worden (zodat het exportpad testbaar is), maar dan staat
  // het onmiskenbaar op élk blad — een demobestand mag nooit als echt kunnen doorgaan.
  const sub = d.isLive
    ? `Data opgehaald uit Business Central op ${stamp(pulledAt)} · bedragen in EUR · klantposten INCL. btw`
    : `⚠ VOORBEELDDATA (DEMOMODUS) — GEEN ECHTE CIJFERS · gegenereerd ${stamp(pulledAt)}`;

  // ---- 1. DSO per maand ----
  const s1 = wb.addWorksheet("DSO per maand");
  titleRow(s1, "DSO per maand en per categorie", sub, 11);
  header(s1, 4, ["Maand", "DSO extern totaal (d)", "DSO via factoring (d)", "DSO niet-factoring (d)", "DSO countback (d)", "DPO extern (d)",
    "AR eind — factoring", "AR eind — niet-factoring", "AR eind — intercompany", "Gefactureerd — extern", "Gefactureerd — IC"]);
  d.dso.months.forEach((m, i) => {
    s1.addRow([
      m, d.dso.dsoTotal[i], d.dso.dsoExtFactoring[i], d.dso.dsoExtOther[i], d.dso.dsoCountback?.[i] ?? null, d.dso.dpoTotal[i],
      d.dso.arEndByCat.extFactoring[i], d.dso.arEndByCat.extOther[i], d.dso.arEndByCat.ic[i],
      d.dso.salesByCat.extFactoring[i] + d.dso.salesByCat.extOther[i], d.dso.salesByCat.ic[i],
    ]);
  });
  s1.columns.forEach((c, i) => { c.width = i === 0 ? 10 : 20; if (i >= 6) c.numFmt = EUR; });

  // ---- 2. Klantbetaalgedrag ----
  const s2 = wb.addWorksheet("Klantbetaalgedrag");
  titleRow(s2, "Betaalgedrag per klant (laatste 12 maanden)", sub, 10);
  header(s2, 4, ["Klant", "Vennootschap(pen)", "Gefactureerd 12m", "Open nu", "Waarvan vervallen", "Betaalde facturen",
    "Dagen tot betaling (gew.)", "Dagen vs vervaldag", "Factoring-aandeel % (>=40% = label factoring)", "Kredietlimiet"]);
  for (const c of d.customers) {
    s2.addRow([c.name + (c.ic ? " [IC]" : ""), c.companies.join(", "), c.invoiced12m, c.openNow, c.overdueNow, c.paidCount,
      c.avgDaysToPay, c.avgDaysVsDue, c.factoredSharePct, c.creditLimit ?? null]);
  }
  s2.columns.forEach((c, i) => { c.width = i === 0 ? 38 : 18; if ([2, 3, 4, 9].includes(i)) c.numFmt = EUR; });

  // ---- 2b. Bellijst per ouderdomsblok (vraag Laura 05/08/2026) ----
  // Exact dezelfde lijst als de bellijst op /cfo/klanten, met het FACTORING-label
  // erbij. De pagina toont de 40 grootste per blok; dit blad bevat ze ALLE, want
  // dat is wat de pagina belooft. Eén klant kan in meerdere blokken staan wanneer
  // hij facturen van verschillende ouderdom open heeft — daarom staat het blok in
  // de eerste kolom en niet als filter.
  if (d.behaviour?.ageing?.length) {
    const sb = wb.addWorksheet("Bellijst");
    const totRows = d.behaviour.ageing.reduce((n, b) => n + b.customers.length, 0);
    titleRow(
      sb,
      "Bellijst per ouderdomsblok — met factoring-label",
      `${sub} · ${totRows} klantrijen over ${d.behaviour.ageing.length} blokken · ouderdom = dagen sinds FACTUURDATUM (niet sinds vervaldag) · bedragen INCL. btw, intercompany uitgesloten`,
      11,
    );
    header(sb, 4, ["Ouderdomsblok", "Klant", "Op factoring?", "Openstaand", "Waarvan vervallen",
      "Facturen", "Oudste (dagen)", "Gemiddeld (dagen)", "Telefoon", "E-mail", "Vennootschap(pen)"]);
    for (const b of d.behaviour.ageing) {
      for (const c of b.customers) {
        sb.addRow([
          b.label, c.name, c.factored ? "FACTORING" : "eigen risico",
          c.amount, c.overdue, c.invoices, c.maxDays, c.avgDays,
          c.phone || "", c.email || "", c.companies.join(", "),
        ]);
      }
    }
    sb.autoFilter = { from: { row: 4, column: 1 }, to: { row: sb.rowCount, column: 11 } };
    sb.columns.forEach((c, i) => {
      c.width = i === 1 ? 40 : i === 9 ? 34 : i === 0 ? 28 : 16;
      if (i >= 3 && i <= 4) c.numFmt = EUR;
    });
    // Samenvatting per blok onderaan: hoeveel geld zit op factoring en hoeveel niet.
    sb.addRow([]);
    sb.addRow(["SAMENVATTING PER BLOK", "", "", "", "", "", "", "", "", "", ""]).font = { bold: true };
    header(sb, sb.rowCount + 1, ["Ouderdomsblok", "Klanten", "waarvan op factoring", "Openstaand totaal",
      "waarvan op factoring", "waarvan eigen risico", "", "", "", "", ""]);
    for (const b of d.behaviour.ageing) {
      const f = b.customers.filter((c) => c.factored);
      const fAmt = f.reduce((n, c) => n + c.amount, 0);
      sb.addRow([b.label, b.customers.length, f.length, b.amount, fAmt, b.amount - fAmt]);
    }
    // header() zet de bevroren rij; de tweede aanroep hierboven zou hem naar de
    // samenvatting verplaatsen. Bij 2.000+ rijen wil je juist de kolomtitels
    // bovenaan vast houden, dus die zetten we terug.
    sb.views = [{ state: "frozen", ySplit: 4 }];
  }

  // ---- 3. Open posten met BC-link ----
  const s3 = wb.addWorksheet("Open posten");
  titleRow(s3, `Open klantposten — ${d.openInvoices.itemsShown ?? d.openInvoices.items.length} grootste van ${d.openInvoices.itemsTotal ?? d.openInvoices.items.length}`, sub, 9);
  header(s3, 4, ["Vennootschap", "Klant", "Documentnr", "Factuurdatum", "Vervaldag", "Dagen te laat", "Bedrag (incl. btw)", "Kanaal", "Open in BC"]);
  for (const it of d.openInvoices.items) {
    const r = s3.addRow([it.company, it.customer, it.docNo, it.invDate, it.dueDate, it.daysVsDue, it.amount, it.via || "bank", it.bcUrl ? "openen ↗" : ""]);
    if (it.bcUrl) {
      const c = r.getCell(9);
      c.value = { text: "openen ↗", hyperlink: it.bcUrl };
      c.font = { color: { argb: "FF0563C1" }, underline: true, size: 9 };
    }
  }
  s3.columns.forEach((c, i) => { c.width = i === 1 ? 34 : 16; if (i === 6) c.numFmt = EUR; });

  // ---- 4. Factoring ----
  const s4 = wb.addWorksheet("Factoring");
  titleRow(s4, "Factoring — volume, snelheid en kosten", sub, 7);
  header(s4, 4, ["Factor", "Vennootschap(pen)", "Afgewikkeld 12m", "Mediaan dagen tot geld", "Gem. dagen", "Open bij factoring-klanten", "Open > 90 dagen"]);
  for (const f of d.factors) {
    s4.addRow([f.label, f.companies.join(", "), f.settled12m, f.medianDaysToSettle, f.avgDaysToSettle, f.openFactored, f.openFactoredOver90]);
  }
  s4.addRow([]);
  header(s4, s4.rowCount + 1, ["Maand", "Commissie (613340)", "Rente (650000, factoring)", "Totaal", "", "", ""]);
  d.factoringCost.months.forEach((m, i) => {
    s4.addRow([m, d.factoringCost.fee?.[i] ?? null, d.factoringCost.interest?.[i] ?? null, d.factoringCost.amounts[i]]);
  });
  s4.addRow([`TOTAAL YTD t/m ${d.factoringCost.ytdThrough ?? "?"}`, d.factoringCost.feeYtd ?? null, d.factoringCost.interestYtd ?? null, d.factoringCost.totalYtd ?? null])
    .font = { bold: true };
  s4.columns.forEach((c, i) => { c.width = i <= 1 ? 30 : 22; if (i >= 2) c.numFmt = EUR; });

  // ---- 5. Facturatie per week ----
  const s5 = wb.addWorksheet("Facturatie per week");
  titleRow(s5, "Facturatie per week (excl. intercompany)", sub, 5);
  header(s5, 4, ["Week vanaf (maandag)", "Naar factoring-klanten", "Overige externe klanten", "Totaal", "Aantal facturen"]);
  for (const w of d.weekFlow) s5.addRow([w.weekStart, w.factored, w.other, w.factored + w.other, w.count]);
  s5.columns.forEach((c, i) => { c.width = 24; if (i >= 1 && i <= 3) c.numFmt = EUR; });

  // ---- 5b. Cashpotentieel & target (vraag Peter/Laura 05/08/2026) ----
  // Finance moet hiermee zelf kunnen rekenen, dus het voorschotpercentage en de
  // norm staan als losse cel bovenaan en niet verstopt in de formules.
  const cp = d.behaviour?.cashPotential;
  if (cp) {
    const s5b = wb.addWorksheet("Cashpotentieel");
    titleRow(s5b, `Cashpotentieel — wat komt vrij bij betaling op ${cp.normDays} dagen`, sub, 5);
    s5b.addRow([]);
    s5b.addRow(["AANNAME — voorschot factoring", cp.advancePct / 100]).font = { bold: true };
    s5b.getCell(`B${s5b.rowCount}`).numFmt = "0%";
    s5b.addRow(["AANNAME — jaarrente voor de rentewinst", cp.ratePct / 100]);
    s5b.getCell(`B${s5b.rowCount}`).numFmt = "0.0%";
    s5b.addRow(["Norm (dagen)", cp.normDays]);
    s5b.addRow(["LET OP", "Het voorschotpercentage staat NIET in Business Central (elke factuur wordt daar in één keer op 100% afgewikkeld). Pas de cel hierboven aan zodra het echte percentage uit de factorcontracten of de maandrapporten van KBC/Belfius/BNP komt."]);
    s5b.addRow([]);

    header(s5b, s5b.rowCount + 1, ["Stand vandaag", "Bedrag (incl. btw)", "", "", ""]);
    const stand: [string, number][] = [
      ["Openstaand extern totaal", cp.openTotal],
      ["— bij factoring-klanten", cp.openFactored],
      ["— bij niet-factoring-klanten", cp.openNonFactored],
      [`Al voorgeschoten door de bank (${cp.advancePct}%)`, cp.alreadyAdvanced],
      [`Retentie nog te ontvangen (${100 - cp.advancePct}%)`, cp.retentionDue],
      ["= Effectief nog te innen cash", cp.effectiveOutstanding],
      [`Bruto openstaand boven ${cp.normDays} dagen`, cp.unlockGrossAtNorm],
      [`Eenmalige CASH-vrijmaking bij ${cp.normDays} dagen`, cp.unlockAtNorm],
      ["— waarvan beltarget (t/m 180 dagen)", cp.unlockCallable],
      ["— waarvan dossierwerk (180+ dagen)", cp.dossierOver180],
      ["— waarvan retentie bij factoring-klanten", cp.unlockFactored],
      ["— waarvan volle facturen bij niet-factoring", cp.unlockNonFactored],
      ["Rentewinst per maand daarna", cp.monthlyInterestSaved],
      ["Bruto >90 dagen bij factoring (terugnamerisico)", cp.recourseOver90Gross],
      ["Voorschot dat de bank daarop kan terugvragen", cp.recourseOver90],
    ];
    for (const [k, v] of stand) s5b.addRow([k, v]);
    if (cp.structuralRelease != null) s5b.addRow([`Kruiscontrole: structureel bij DSO ${cp.dsoNow} → ${cp.normDays} d`, cp.structuralRelease]);
    s5b.addRow([]);

    header(s5b, s5b.rowCount + 1, ["Verbetertraject", "Vrij (eenmalig)", "waarvan factoring-retentie", "waarvan niet-factoring", "Facturen"]);
    for (const t of [...cp.targets].sort((a, b) => b.normDays - a.normDays)) {
      s5b.addRow([`alles ≤ ${t.normDays} dagen`, t.unlock, t.unlockFactored, t.unlockNonFactored, t.invoices]);
    }
    s5b.addRow([]);

    header(s5b, s5b.rowCount + 1, ["Ouderdomsblok", "Openstaand", "Vrij te maken", "", ""]);
    for (const b of cp.perBucket) s5b.addRow([b.label, b.open, b.unlock]);
    s5b.addRow([]);

    header(s5b, s5b.rowCount + 1, ["Klant", "Openstaand", "Al voorgeschoten", "Target cash", "Oudste (dagen)"]);
    for (const c of cp.customers) {
      s5b.addRow([`${c.name}${c.factored ? " (factoring)" : ""}`, c.open, c.alreadyAdvanced, c.unlockAtNorm, c.maxDays]);
    }
    s5b.addRow([]);
    s5b.addRow(["Aannames & beperkingen", ""]).font = { bold: true };
    for (const n of cp.notes) s5b.addRow(["", n]);
    s5b.columns.forEach((c, i) => { c.width = i === 0 ? 46 : 22; if (i >= 1 && i <= 3) c.numFmt = EUR; });
  }

  // ---- 6. Methodiek ----
  const s6 = wb.addWorksheet("Methodiek & bronnen");
  titleRow(s6, "Hoe elk cijfer berekend is", sub, 2);
  header(s6, 4, ["Onderwerp", "Uitleg"]);
  for (const src of d.sources) s6.addRow([src.label, src.detail]);
  s6.addRow([]);
  s6.addRow(["Caveats", ""]).font = { bold: true };
  for (const n of d.notes) s6.addRow(["", n]);
  s6.addRow([]);
  s6.addRow(["Datakwaliteit", ""]).font = { bold: true };
  for (const q of d.dataQuality) s6.addRow(["", q]);
  s6.getColumn(1).width = 30;
  s6.getColumn(2).width = 150;
  s6.getColumn(2).alignment = { wrapText: true, vertical: "top" };

  const buffer = await wb.xlsx.writeBuffer();
  const fn = `${d.isLive ? "" : "DEMO - "}Klanten-en-Cash - Gheeraert Groep - ${pulledAt.toISOString().slice(0, 10)} ${String(pulledAt.getHours()).padStart(2, "0")}u${String(pulledAt.getMinutes()).padStart(2, "0")}.xlsx`;
  return { buffer: buffer as ArrayBuffer, filename: fn };
}
