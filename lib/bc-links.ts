// Business Central deep-links — TS-port van exports/_generator/bclink.py.
//
// Ontwerpprincipe (afspraak met David, zelfde als de exports): de link is een
// VINDPLAATS, geen payload. Ze draagt enkel de firma + één filterveld (documentnr
// of rekeningnr) en toont zonder BC-login niets. Tenant/environment zijn
// niet-geheime coördinaten (verschijnen sowieso in elke BC-URL).
//
// Canoniek formaat (MS-doc): https://<host>/<tenant>/<environment>/?company=..&page=..&filter=..
// (tenant EN environment in het PAD; environment als query gaf "could not find the environment").

const BASE = "https://businesscentral.dynamics.com";
const TENANT = process.env.BC_TENANT_ID || "c78ce9f9-94d2-46dd-afcf-c12e881cc810";
const BC_ENV = process.env.BC_ENVIRONMENT || "Production";

// BC-paginanummers (zelfde tabel als bclink.py)
const PAGE_GL_ENTRIES = 20;
const PAGE_VENDOR_LEDGER_ENTRIES = 29;
const PAGE_POSTED_SALES_INVOICE = 132;

function link(company: string, page: number, field: string, value: string): string {
  const filt = encodeURIComponent(`'${field}' IS '${value}'`);
  return `${BASE}/${TENANT}/${BC_ENV}/?company=${encodeURIComponent(company)}&page=${page}&filter=${filt}`;
}

/** Grootboekposten gefilterd op documentnummer — opent de exacte boeking(en). */
export function glDocumentLink(company: string, documentNumber: string): string {
  return link(company, PAGE_GL_ENTRIES, "Document No.", documentNumber);
}

/** Grootboekposten gefilterd op rekeningnummer — alle posten van één rekening. */
export function glAccountLink(company: string, accountNumber: string): string {
  return link(company, PAGE_GL_ENTRIES, "G/L Account No.", accountNumber);
}

/** Leveranciersposten (VLE) gefilterd op documentnummer — werkt voor élk open
 *  AP-item (factuur, creditnota of betaling), anders dan de factuurkaart-pagina's. */
export function vendorLedgerDocLink(company: string, documentNumber: string): string {
  return link(company, PAGE_VENDOR_LEDGER_ENTRIES, "Document No.", documentNumber);
}

/** Geboekte verkoopfactuur-kaart gefilterd op factuurnummer. */
export function salesInvoiceLink(company: string, invoiceNumber: string): string {
  return link(company, PAGE_POSTED_SALES_INVOICE, "No.", invoiceNumber);
}
