// Excel-export van de Management-P&L (vraag David 19/08/2026): zelfde buckets
// en periode-/scopekeuze als de pagina, plus een detailblad per bucket met
// BC-links en een leeswijzer. Bedragen: opbrengsten +, kosten −, excl. btw.

import ExcelJS from "exceljs";
import type { CfoMgmtPnl } from "./mgmt-pnl";

const BLUE = "FF1F5FA8", YEL = "FFFFF2CC";
const EUR = '#,##0\\ "€"';

export async function buildPnlWorkbook(
  p: CfoMgmtPnl, mFrom: number, mTo: number, excluded: string[], pulledAt: Date
): Promise<{ buffer: ArrayBuffer; filename: string }> {
  const mA = Math.min(Math.max(1, mFrom), p.months.length);
  const mB = Math.max(mA, Math.min(mTo, p.months.length));
  const zicht = <T,>(arr: T[]) => arr.slice(mA - 1, mB);
  const somRij = (id: string) => zicht(p.rows.find((r) => r.id === id)?.monthly || []).reduce((a, b) => a + b, 0);
  const stamp = pulledAt.toLocaleString("nl-BE", { timeZone: "Europe/Brussels", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const scope = p.company === "ALL" ? `${11 - excluded.length}/11 vennootschappen${excluded.length ? ` (zonder ${excluded.join(", ")})` : ""}` : p.company;

  const wb = new ExcelJS.Workbook();
  wb.created = pulledAt;
  const ws = wb.addWorksheet("P&L");
  const maanden = zicht(p.months);
  const NC = maanden.length + 2;
  ws.getCell(1, 1).value = `MANAGEMENT-P&L ${p.year} — ${scope} — periode ${p.months[mA - 1]} t/m ${p.months[mB - 1]} — data getrokken ${stamp} — bruto, incl. onderlinge facturatie, excl. btw`;
  ws.getCell(1, 1).font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
  for (let c = 1; c <= NC; c++) ws.getCell(1, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } };
  ws.getRow(3).values = ["Bucket", ...maanden, mA === 1 && mB === p.months.length ? "YtD" : "Periode-totaal"];
  ws.getRow(3).font = { bold: true, color: { argb: "FFFFFFFF" } };
  for (let c = 1; c <= NC; c++) ws.getCell(3, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } };
  ws.getColumn(1).width = 38;
  for (let c = 2; c <= NC; c++) ws.getColumn(c).width = 13;

  let r = 4;
  for (const row of p.rows) {
    if ((row.id === "niet_gemapt" || row.id === "niet_recurrent") && row.ytd === 0) continue;
    const isPct = row.id === "brutomarge_pct";
    const totaal = isPct
      ? (somRij("omzet") ? Math.round((somRij("brutomarge") / somRij("omzet")) * 1000) / 10 : 0)
      : zicht(row.monthly).reduce((a, b) => a + b, 0);
    ws.getCell(r, 1).value = (row.indent ? "    " : "") + row.label;
    zicht(row.monthly).forEach((v, i) => {
      const cell = ws.getCell(r, 2 + i);
      cell.value = isPct ? v / 100 : Math.round(v);
      cell.numFmt = isPct ? "0.0%" : EUR;
    });
    const tot = ws.getCell(r, NC);
    tot.value = isPct ? totaal / 100 : Math.round(totaal);
    tot.numFmt = isPct ? "0.0%" : EUR;
    tot.font = { bold: true };
    if (row.style === "subtotal" || row.style === "total") {
      for (let c = 1; c <= NC; c++) {
        ws.getCell(r, c).font = { bold: true };
        ws.getCell(r, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: YEL } };
      }
    }
    r++;
  }
  ws.views = [{ state: "frozen", xSplit: 1, ySplit: 3 }];

  // Detailblad: rekeningen per bucket (top-40 van het jaar) — het bedrag volgt
  // de GEKOZEN PERIODE (vraag David 19/08); het jaartotaal staat er als extra
  // kolom naast. Rijen die in de periode op 0 staan blijven weg.
  const heleJaar2 = mA === 1 && mB >= p.months.length;
  const perLbl = heleJaar2 ? `YtD ${p.year}` : `${p.months[mA - 1]} t/m ${p.months[mB - 1]}`;
  const perVan = (d: { monthly?: number[]; ytd: number }) =>
    d.monthly && d.monthly.length ? d.monthly.slice(mA - 1, mB).reduce((s, x) => s + x, 0) : (heleJaar2 ? d.ytd : 0);
  const ws2 = wb.addWorksheet("Detail per bucket");
  ws2.getCell(1, 1).value = `DETAIL PER BUCKET — rekeningen per vennootschap (periode: ${perLbl})`;
  ws2.getCell(1, 1).font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
  for (let c = 1; c <= 6; c++) ws2.getCell(1, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } };
  ws2.getRow(3).values = ["Bucket", "Rekening (BC-link)", "Naam", "Vennootschap", perLbl, `YtD ${p.year}`];
  ws2.getRow(3).font = { bold: true, color: { argb: "FFFFFFFF" } };
  for (let c = 1; c <= 6; c++) ws2.getCell(3, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } };
  [26, 16, 36, 13, 15, 15].forEach((w, i) => (ws2.getColumn(i + 1).width = w));
  let r2 = 4;
  for (const row of p.rows) {
    const det = p.detail[row.id];
    if (!det || det.length === 0) continue;
    const detP = det.map((d) => ({ ...d, per: perVan(d) })).filter((d) => Math.abs(d.per) >= 0.5)
      .sort((a, b) => Math.abs(b.per) - Math.abs(a.per));
    for (const d of detP) {
      ws2.getCell(r2, 1).value = row.label;
      ws2.getCell(r2, 2).value = { text: d.account, hyperlink: d.bcUrl };
      ws2.getCell(r2, 2).font = { color: { argb: BLUE }, underline: true };
      ws2.getCell(r2, 3).value = d.name;
      ws2.getCell(r2, 4).value = d.company;
      ws2.getCell(r2, 5).value = Math.round(d.per);
      ws2.getCell(r2, 5).numFmt = EUR;
      ws2.getCell(r2, 6).value = Math.round(d.ytd);
      ws2.getCell(r2, 6).numFmt = EUR;
      r2++;
    }
  }
  ws2.views = [{ state: "frozen", ySplit: 3 }];
  ws2.autoFilter = { from: { row: 3, column: 1 }, to: { row: r2 - 1, column: 6 } };

  // Leeswijzer
  const ws3 = wb.addWorksheet("Leeswijzer");
  const notes = [
    `Management-P&L ${p.year} — ${scope} — periode ${p.months[mA - 1]} t/m ${p.months[mB - 1]}`,
    `DATA GETROKKEN OP: ${stamp} (live uit Business Central op het moment van de klik).`,
    "",
    "PERIODE = rapporteringsmaand (boekingsperiode/Posting Date in BC), niet het moment waarop de boeking is ingegeven — zelfde afbakening als EMAsphere.",
    `SCOPE: ${scope}. Bedragen zijn de BRUTO som van de geselecteerde vennootschappen, inclusief onderlinge facturatie (IC wordt hier niet geëlimineerd — de echte IC-eliminatie staat op de Business Units-pagina).`,
    `Controlelijn: ${p.controlelijn === 0 ? "€0 — alle grootboekposten zijn gemapt" : `€${p.controlelijn.toLocaleString("nl-BE")} — zie niet-gemapte rekeningen op de pagina`}. Niet-recurrente omzet (GPR gebouwenverkoop) staat apart en zit niet in de omzet.`,
    "Detailblad: de rekeningen achter elke bucket, met het bedrag van de GEKOZEN PERIODE (zelfde filter als het P&L-blad) én het jaartotaal ernaast. Selectie = top-40 van het jaar per bucket; rekeningen die in de periode op 0 staan zijn weggelaten. Rekeningnummer = link naar Business Central.",
    ...p.notes,
  ];
  notes.forEach((t, i) => {
    ws3.getCell(i + 2, 2).value = t;
    ws3.getCell(i + 2, 2).font = i === 0 ? { bold: true, size: 13 } : i === 1 ? { bold: true } : { size: 10 };
  });
  ws3.getColumn(2).width = 130;

  const fileStamp = pulledAt.toLocaleString("sv-SE", { timeZone: "Europe/Brussels" }).replace(" ", "_").replace(/:/g, "").slice(0, 15);
  const buffer = await wb.xlsx.writeBuffer();
  return {
    buffer: buffer as ArrayBuffer,
    filename: `Management-PL ${p.year} ${p.company === "ALL" ? "conso" : p.company} ${p.months[mA - 1]} tm ${p.months[mB - 1]} - ${fileStamp}.xlsx`,
  };
}
