// Peppol UBL 2.1 Invoice Parser
// Parses the XML format used in Peppol BIS Billing 3.0

import type { PurchaseInvoice } from "./types";
import { generateId } from "./utils";

export interface PeppolInvoice {
  id: string;
  issueDate: string;
  dueDate: string;
  invoiceNumber: string;
  supplierName: string;
  supplierVAT: string;
  buyerName: string;
  buyerVAT: string;
  currency: string;
  totalExclVAT: number;
  totalVAT: number;
  totalInclVAT: number;
  lines: PeppolInvoiceLine[];
  peppolId: string;    // Peppol participant ID
  processId: string;   // urn:fdc:peppol.eu:2017:poacc:billing:01:1.0
  rawXml?: string;
  status: "received" | "processed" | "rejected" | "matched";
}

export interface PeppolInvoiceLine {
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  vatPercent: number;
}

// XML helpers — DOMParser is a browser API and is NOT available in the Node
// server runtime (this POST route runs server-side), so we parse UBL with
// namespace-aware string matching instead. UBL/Peppol XML is well structured,
// so scoping by element name within parent blocks is reliable enough.
function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

// Matches <ns:Name ...>inner</ns:Name> (optional namespace prefix, optional attrs).
function tagPattern(name: string, flags: string): RegExp {
  return new RegExp(`<(?:[\\w.-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${name}>`, flags);
}

// First leaf-text value among the given element names within scope.
function firstText(scope: string, ...names: string[]): string {
  for (const n of names) {
    const m = scope.match(tagPattern(n, ""));
    if (m && m[1] != null) {
      const text = decodeEntities(m[1].replace(/<[^>]+>/g, "")).trim();
      if (text) return text;
    }
  }
  return "";
}

function firstNum(scope: string, ...names: string[]): number {
  return parseFloat(firstText(scope, ...names)) || 0;
}

// Inner XML of the first matching block element (e.g. a party or totals block).
function firstBlock(scope: string, name: string): string {
  const m = scope.match(tagPattern(name, ""));
  return m ? m[1] : "";
}

export function parsePeppolXML(xml: string): PeppolInvoice | null {
  try {
    if (!xml || !/<(?:[\w.-]+:)?Invoice[\s>]/.test(xml)) return null;

    // Parse header
    const invoiceNumber = firstText(xml, "ID");
    const issueDate = firstText(xml, "IssueDate");
    const dueDate = firstText(xml, "DueDate", "PaymentDueDate");
    const currency = firstText(xml, "DocumentCurrencyCode") || "EUR";

    // Supplier (AccountingSupplierParty)
    const supplierParty = firstBlock(xml, "AccountingSupplierParty");
    const supplierName = supplierParty ? firstText(supplierParty, "RegistrationName", "Name") : "";
    const supplierVAT = supplierParty ? firstText(supplierParty, "CompanyID", "EndpointID") : "";

    // Buyer (AccountingCustomerParty)
    const buyerParty = firstBlock(xml, "AccountingCustomerParty");
    const buyerName = buyerParty ? firstText(buyerParty, "RegistrationName", "Name") : "";
    const buyerVAT = buyerParty ? firstText(buyerParty, "CompanyID", "EndpointID") : "";

    // Totals (LegalMonetaryTotal)
    const monetary = firstBlock(xml, "LegalMonetaryTotal");
    const totalExclVAT = monetary ? firstNum(monetary, "TaxExclusiveAmount") : 0;
    const totalInclVAT = monetary ? firstNum(monetary, "TaxInclusiveAmount", "PayableAmount") : 0;
    const totalVAT = totalInclVAT - totalExclVAT;

    // Invoice lines
    const lines: PeppolInvoiceLine[] = [];
    const lineMatches = xml.matchAll(tagPattern("InvoiceLine", "g"));
    for (const lm of lineMatches) {
      const line = lm[1];
      lines.push({
        description: firstText(line, "Description", "Name"),
        quantity: firstNum(line, "InvoicedQuantity"),
        unitPrice: firstNum(line, "PriceAmount"),
        lineTotal: firstNum(line, "LineExtensionAmount"),
        vatPercent: firstNum(line, "Percent"),
      });
    }

    return {
      id: generateId(),
      issueDate,
      dueDate,
      invoiceNumber,
      supplierName,
      supplierVAT,
      buyerName,
      buyerVAT,
      currency,
      totalExclVAT,
      totalVAT,
      totalInclVAT,
      lines,
      peppolId: firstText(xml, "EndpointID"),
      processId: firstText(xml, "ProfileID"),
      rawXml: xml,
      status: "received",
    };
  } catch {
    return null;
  }
}

// Convert Peppol invoice to dashboard PurchaseInvoice format
export function peppolToPurchaseInvoice(
  peppol: PeppolInvoice,
  companyId: string = "comp-gdi",
  companyName: string = "GDI"
): PurchaseInvoice {
  return {
    id: peppol.id,
    number: peppol.invoiceNumber,
    invoiceDate: peppol.issueDate,
    postingDate: peppol.issueDate,
    dueDate: peppol.dueDate,
    vendorNumber: peppol.supplierVAT,
    vendorName: peppol.supplierName,
    totalAmountExcludingTax: peppol.totalExclVAT,
    totalAmountIncludingTax: peppol.totalInclVAT,
    totalTaxAmount: peppol.totalVAT,
    status: "Open",
    currencyCode: peppol.currency,
    companyId,
    companyName,
    costCategory: "Other IT",
    lines: peppol.lines.map((l) => ({
      lineType: "Item",
      description: l.description,
      unitCost: l.unitPrice,
      quantity: l.quantity,
      netAmount: l.lineTotal,
      accountId: "",
      accountNumber: "",
    })),
  };
}
