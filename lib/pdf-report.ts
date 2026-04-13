import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type {
  DashboardKPIs,
  CategorySpend,
  VendorSummary,
  MonthlySpend,
  Contract,
} from "./types";

export interface ReportData {
  kpis: DashboardKPIs;
  categories: CategorySpend[];
  vendors: VendorSummary[];
  monthly: MonthlySpend[];
  contracts: Contract[];
}

const fmt = (n: number) =>
  new Intl.NumberFormat("nl-BE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);

export function generateExecutiveReport(data: ReportData): jsPDF {
  const doc = new jsPDF("p", "mm", "a4");
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;
  let y = 0;

  // ── Header banner ──
  doc.setFillColor(15, 23, 42); // slate-900
  doc.rect(0, 0, pageWidth, 28, "F");
  doc.setFillColor(13, 148, 136); // teal-500
  doc.rect(0, 27, pageWidth, 1.5, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(255, 255, 255);
  doc.text("IT Finance Report", margin, 13);

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(148, 163, 184); // slate-400
  doc.text(`Generated: ${new Date().toLocaleDateString("nl-BE")}`, margin, 21);
  doc.text("CONFIDENTIAL", pageWidth - margin, 13, { align: "right" });

  y = 36;

  // ── KPI boxes ──
  const kpiBoxWidth = (contentWidth - 9) / 4;
  const kpis = [
    { label: "Total IT Spend", value: fmt(data.kpis.totalSpendYTD) },
    { label: "Budget Variance", value: `${data.kpis.budgetVariancePercent >= 0 ? "+" : ""}${data.kpis.budgetVariancePercent.toFixed(1)}%` },
    { label: "License Utilization", value: `${data.kpis.licenseUtilizationPercent.toFixed(1)}%` },
    { label: "Managed Devices", value: data.kpis.deviceCount.toString() },
  ];
  kpis.forEach((kpi, i) => {
    const x = margin + i * (kpiBoxWidth + 3);
    doc.setFillColor(30, 41, 59); // slate-800
    doc.roundedRect(x, y, kpiBoxWidth, 18, 2, 2, "F");
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.setFont("helvetica", "normal");
    doc.text(kpi.label, x + 4, y + 7);
    doc.setFontSize(12);
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.text(kpi.value, x + 4, y + 14);
  });

  y += 25;

  // ── Cost Categories table ──
  doc.setFontSize(10);
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.text("Cost Category Breakdown", margin, y);
  y += 4;

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [["Category", "Actual", "Budget", "Variance"]],
    body: data.categories
      .sort((a, b) => b.amount - a.amount)
      .map((c) => [
        c.category,
        fmt(c.amount),
        fmt(c.budget),
        `${c.variancePercent >= 0 ? "+" : ""}${c.variancePercent.toFixed(1)}%`,
      ]),
    styles: { fontSize: 8, cellPadding: 2, textColor: [203, 213, 225], fillColor: [30, 41, 59] },
    headStyles: { fillColor: [13, 148, 136], textColor: [255, 255, 255], fontStyle: "bold" },
    alternateRowStyles: { fillColor: [15, 23, 42] },
    theme: "grid",
    tableLineColor: [51, 65, 85],
    tableLineWidth: 0.1,
  });

  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

  // ── Top 5 Vendors ──
  doc.setFontSize(10);
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.text("Top 5 Vendors", margin, y);
  y += 4;

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [["#", "Vendor", "YTD Spend", "% of Total"]],
    body: data.vendors.slice(0, 5).map((v, i) => [
      (i + 1).toString(),
      v.vendorName,
      fmt(v.totalSpend),
      `${v.percentOfTotal.toFixed(1)}%`,
    ]),
    styles: { fontSize: 8, cellPadding: 2, textColor: [203, 213, 225], fillColor: [30, 41, 59] },
    headStyles: { fillColor: [13, 148, 136], textColor: [255, 255, 255], fontStyle: "bold" },
    alternateRowStyles: { fillColor: [15, 23, 42] },
    theme: "grid",
    tableLineColor: [51, 65, 85],
    tableLineWidth: 0.1,
  });

  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

  // ── Expiring Contracts ──
  const now = Date.now();
  const expiring = data.contracts
    .filter((c) => {
      const days = (new Date(c.endDate).getTime() - now) / 86400000;
      return days > 0 && days <= 180;
    })
    .sort((a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime())
    .slice(0, 5);

  if (expiring.length > 0) {
    doc.setFontSize(10);
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.text("Contracts Expiring Soon", margin, y);
    y += 4;

    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [["Vendor", "End Date", "Days Left", "Annual Cost"]],
      body: expiring.map((c) => [
        c.vendor,
        new Date(c.endDate).toLocaleDateString("nl-BE"),
        Math.ceil((new Date(c.endDate).getTime() - now) / 86400000).toString(),
        fmt(c.annualCost),
      ]),
      styles: { fontSize: 8, cellPadding: 2, textColor: [203, 213, 225], fillColor: [30, 41, 59] },
      headStyles: { fillColor: [245, 158, 11], textColor: [255, 255, 255], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [15, 23, 42] },
      theme: "grid",
      tableLineColor: [51, 65, 85],
      tableLineWidth: 0.1,
    });

    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  }

  // ── Footer ──
  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setFillColor(15, 23, 42);
  doc.rect(0, pageHeight - 12, pageWidth, 12, "F");
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139); // slate-500
  doc.setFont("helvetica", "normal");
  doc.text("Generated by IT Finance Dashboard — cv.daviddelporte.com", margin, pageHeight - 5);
  doc.text(`Page 1 of 1`, pageWidth - margin, pageHeight - 5, { align: "right" });

  return doc;
}
