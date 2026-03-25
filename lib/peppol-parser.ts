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

export function parsePeppolXML(xml: string): PeppolInvoice | null {
  try {
    // Use DOMParser (available in Node 18+ and browsers)
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, "text/xml");

    // Check for parse errors
    const parseError = doc.querySelector("parsererror");
    if (parseError) return null;

    // Helper to get text content by tag name (handles namespaces)
    const getText = (parent: Element | Document, ...tags: string[]): string => {
      for (const tag of tags) {
        const el =
          parent.getElementsByTagName(tag)[0] ||
          parent.getElementsByTagName(`cbc:${tag}`)[0] ||
          parent.getElementsByTagName(`cac:${tag}`)[0];
        if (el?.textContent) return el.textContent.trim();
      }
      return "";
    };

    const getNum = (parent: Element | Document, ...tags: string[]): number => {
      const text = getText(parent, ...tags);
      return parseFloat(text) || 0;
    };

    // Parse header
    const invoiceNumber = getText(doc, "ID");
    const issueDate = getText(doc, "IssueDate");
    const dueDate =
      getText(doc, "DueDate") || getText(doc, "PaymentDueDate");
    const currency = getText(doc, "DocumentCurrencyCode") || "EUR";

    // Supplier (AccountingSupplierParty)
    const supplierParty =
      doc.getElementsByTagName("AccountingSupplierParty")[0] ||
      doc.getElementsByTagName("cac:AccountingSupplierParty")[0];
    const supplierName = supplierParty
      ? getText(supplierParty, "RegistrationName", "Name")
      : "";
    const supplierVAT = supplierParty
      ? getText(supplierParty, "CompanyID", "EndpointID")
      : "";

    // Buyer (AccountingCustomerParty)
    const buyerParty =
      doc.getElementsByTagName("AccountingCustomerParty")[0] ||
      doc.getElementsByTagName("cac:AccountingCustomerParty")[0];
    const buyerName = buyerParty
      ? getText(buyerParty, "RegistrationName", "Name")
      : "";
    const buyerVAT = buyerParty
      ? getText(buyerParty, "CompanyID", "EndpointID")
      : "";

    // Totals (LegalMonetaryTotal)
    const monetary =
      doc.getElementsByTagName("LegalMonetaryTotal")[0] ||
      doc.getElementsByTagName("cac:LegalMonetaryTotal")[0];
    const totalExclVAT = monetary ? getNum(monetary, "TaxExclusiveAmount") : 0;
    const totalInclVAT = monetary
      ? getNum(monetary, "TaxInclusiveAmount", "PayableAmount")
      : 0;
    const totalVAT = totalInclVAT - totalExclVAT;

    // Invoice lines
    const lineElements =
      doc.getElementsByTagName("InvoiceLine").length > 0
        ? doc.getElementsByTagName("InvoiceLine")
        : doc.getElementsByTagName("cac:InvoiceLine");

    const lines: PeppolInvoiceLine[] = [];
    for (let i = 0; i < lineElements.length; i++) {
      const line = lineElements[i];
      lines.push({
        description: getText(line, "Description", "Name"),
        quantity: getNum(line, "InvoicedQuantity"),
        unitPrice: getNum(line, "PriceAmount"),
        lineTotal: getNum(line, "LineExtensionAmount"),
        vatPercent: getNum(line, "Percent"),
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
      peppolId: getText(doc, "EndpointID"),
      processId: getText(doc, "ProfileID"),
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
