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
    "Dagen tot betaling (gew.)", "Dagen vs vervaldag", "Factoring-aandeel %", "Kredietlimiet"]);
  for (const c of d.customers) {
    s2.addRow([c.name + (c.ic ? " [IC]" : ""), c.companies.join(", "), c.invoiced12m, c.openNow, c.overdueNow, c.paidCount,
      c.avgDaysToPay, c.avgDaysVsDue, c.factoredSharePct, c.creditLimit ?? null]);
  }
  s2.columns.forEach((c, i) => { c.width = i === 0 ? 38 : 18; if ([2, 3, 4, 9].includes(i)) c.numFmt = EUR; });

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
