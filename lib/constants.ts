// Maps real Business Central G/L account numbers (Belgian PCMN, 6-digit) to IT
// cost categories. Derived from the live Gheeraert chart of accounts and
// confirmed with David — only accounts that genuinely carry IT spend are listed.
// Everything else is Unclassified (non-IT) and excluded from IT totals.
//
// Cost model: IT SPEND = operating expense + capitalised purchases (capex).
// Depreciation of IT assets is tracked SEPARATELY (IT_DEPRECIATION_ACCOUNTS) and
// surfaced as its own figure, so the purchase and its depreciation are never
// double-counted. Accumulated-depreciation contra accounts (…009) are excluded.
export const DEFAULT_GL_MAPPING: Record<string, string> = {
  // IT operating expense
  "611120": "Hardware (Purchases)",     // Onderhoud computer hardware
  "611130": "Software & Licenses",      // Onderhoud computer software (maintenance / subscriptions)
  "612350": "Hardware (Purchases)",     // Computerbenodigdheden (computer supplies)
  "612400": "Telecom",                  // Telefonie en internet
  "613320": "External IT Services",     // Informaticadiensten (external IT services / consultancy)
  // NOTE: 614400 "Verzekering cyber" is NOT mapped — despite its name it's a
  // catch-all insurance account dominated by ~€92k truck insurance (ALLIA,
  // "VRACHTWAGENS"). The real cyber premium is only ~€5.5k and isn't cleanly
  // isolable by account, so it's better tracked as a line in the Contracts register.
  // IT capital purchases (fixed-asset additions — actual hardware/software buys)
  "240200": "Hardware (Purchases)",     // Computer hardware
  "240500": "Software & Licenses",      // Computer software
  "215000": "Software & Licenses",      // Software (intangible)
  "211000": "Software & Licenses",      // Concessies, octrooien, licenties, know-how, merken
};

// G/L accounts queried from generalLedgerEntries to compute IT spend. Kept in
// sync with DEFAULT_GL_MAPPING — these are the only accounts we pull, which is
// what keeps the BC query fast (a few thousand rows instead of ~46k invoices).
export const IT_GL_ACCOUNTS: string[] = Object.keys(DEFAULT_GL_MAPPING);

// Non-IT accounts that nonetheless carry some IT spend from allowlisted vendors
// (ALLPHI/iDocta/GMI on external-services, Canon printers on office-supplies /
// recharge). We pull GL for these too, but ONLY count entries whose vendor is on
// the IT_VENDOR_RULES allowlist — and we count the actual G/L posting
// (debit − credit), NOT the invoice-header total. This is the accurate measure:
// it nets credit notes and only reflects what truly hit the expense account.
export const ALLOWLIST_SCAN_ACCOUNTS: string[] = [
  "613300", // Externe dienstverlening (ALLPHI, JUST-FIX-IT, GMI, iDocta land here)
  "612300", // Kantoorbenodigdheden (Canon, iDocta)
  "615800", // Andere door te rekenen kosten (Canon)
  "611110", // Onderhoud/installatie (Connectify 3CX telephony lands here — €5.3k/yr)
  // Added after the 2026-06 full-ledger completeness sweep (290 candidates,
  // adversarially classified). Each holds exactly one IT vendor amid non-IT bulk:
  "611011", // Onderhoud gebouwen in huur (Ubiquiti UniFi networking gear)
  "612500", // Documentatie en naslagwerken (Alpega freight/TMS software subscription)
  "614400", // Verzekering cyber (CyberContract cyber-insurance; rest is ALLIA truck insurance)
];

// IT vendor allowlist — captures spend from these vendors EVEN when it lands on
// a non-IT account (e.g. iDocta and Canon printers booked to office-supplies
// 612300). Matched case-insensitively on the posted-invoice vendor name. Only
// invoices NOT already counted via an IT account are added (no double-count).
// Keyed pattern → category. Editable/persisted via settings-store (merged over
// these defaults).
export const IT_VENDOR_RULES: Record<string, string> = {
  idocta: "External IT Services",
  canon: "Hardware (Purchases)",
  // External IT/dev partners booked to the generic 613300 "Externe
  // dienstverlening" account (NOT an IT account), confirmed with David in the
  // 2026-06 spend audit. Captured by name so their spend counts as IT without
  // mapping all of 613300 (which is dominated by intercompany + management fees).
  allphi: "External IT Services",         // outsourced dev/MSP partner (~€154k/yr)
  "just-fix-it": "External IT Services",   // IT support (~€33k/yr, booked to 613300)
  "gmi group": "External IT Services",     // IT services (also booked to 611130)
  connectify: "Telecom",                   // 3CX telephony / IT-telecom (~€5.3k/yr, booked to 611110)
  ubiquiti: "Hardware (Purchases)",        // UniFi networking gear (booked to 611011)
  cybercontract: "Security",               // cyber-insurance / -compliance (booked to 614400)
  alpega: "Operational Software",          // freight/TMS software platform (booked to 612500)
};

// Group entities — when one of these is the *vendor* on an invoice it's an
// intercompany recharge / self-billing, not third-party IT spend. Excluded from
// IT totals so internal cross-charges never inflate the numbers (and so a broad
// vendor-allowlist pattern can never accidentally pull in €1.85M of GSS recharge
// booked to 613300). Matched case-insensitively as a substring of the vendor name.
export const INTERCOMPANY_VENDORS: string[] = [
  "gheeraert",            // GTG / GSS / GPR / GTR / Distribution / Express / Property / Renting / Garage
  "marcel lamberts",
  "de rudder",
  "trans-form",
  "warehouse bv",
];

// Lower-case and strip every non-alphanumeric char before matching, so a vendor
// allowlist/pattern is insensitive to spacing, hyphens and punctuation. Without
// this, BC's "JUST -FIX IT-" never matched the rule "just-fix-it" and ~€33k/yr of
// IT support was silently dropped from the spend total (2026-06 completeness audit).
export function normalizeVendor(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** True when the invoice vendor is a Gheeraert-group entity (intercompany). */
export function isIntercompanyVendor(vendorName: string): boolean {
  const v = normalizeVendor(vendorName);
  return INTERCOMPANY_VENDORS.some((p) => v.includes(normalizeVendor(p)));
}

/** True when the vendor is operational/business-system software (TMS/telematics). */
export function isOperationalSoftwareVendor(vendorName: string, patterns: string[] = OPERATIONAL_SOFTWARE_VENDORS): boolean {
  const v = normalizeVendor(vendorName);
  return patterns.some((p) => p && v.includes(normalizeVendor(p)));
}

// Depreciation/amortisation of IT assets (P&L). Reported as a SEPARATE figure,
// never added to IT spend (the asset purchase is already counted as capex above).
export const IT_DEPRECIATION_ACCOUNTS: string[] = [
  "630000", // Afschr. concessies, octrooien, licenties
  "630005", // Afschr. software
  "630402", // Afschr. computer hardware
  "630405", // Afschr. computer software
];

export const IT_CATEGORIES: string[] = [
  "Software & Licenses",
  "Hardware (Depreciation)",
  "Hardware (Purchases)",
  "Cloud & Hosting",
  "External IT Services",
  "Telecom",
  "Security",
  "IT Personnel",
  "Operational Software",
  "Other IT",
];

// Operational / business-system software (transport TMS, telematics, port/route
// platforms). These run the transport business rather than the IT estate, so
// they're tagged separately and can be toggled in/out of the IT total
// (Settings → "includeOperationalSoftware"). Matched on vendor name. Editable
// and persisted via settings-store (operationalSoftwareVendors), merged over
// these defaults.
export const OPERATIONAL_SOFTWARE_VENDORS: string[] = [
  "transics", "transporeon", "ptv", "eurotracs", "fleetgo", "trimble",
  "punch telematic", "ion logistics", "t-mining", "alpega", "timocom",
  "transline", "axitra", "shift logistics", "peripass", "alfapass",
  "secure logistics", "avantida", "cinvio",
];

export const OPERATIONAL_SOFTWARE_CATEGORY = "Operational Software";

export const CATEGORY_COLORS: Record<string, string> = {
  "Software & Licenses": "#0072B2",
  "Hardware (Depreciation)": "#E69F00",
  "Hardware (Purchases)": "#D55E00",
  "Cloud & Hosting": "#56B4E9",
  "External IT Services": "#009E73",
  "Telecom": "#CC79A7",
  "Security": "#F5C710",
  "IT Personnel": "#882255",
  "Operational Software": "#7B68EE",
  "Other IT": "#999999",
  // Spend on GL accounts not in the IT mapping — NOT counted as IT by default.
  "Unclassified": "#4b5563",
};

// Bucket used in live mode when a purchase invoice / GL entry hits an account
// that isn't in DEFAULT_GL_MAPPING. Kept distinct from "Other IT" so non-IT
// company spend never silently inflates the IT totals — the dashboard excludes
// it by default and surfaces how much is unclassified.
export const UNCLASSIFIED_CATEGORY = "Unclassified";

/** True for categories that count as IT spend (everything except Unclassified). */
export function isITCategory(category: string): boolean {
  return category !== UNCLASSIFIED_CATEGORY;
}

export const SKU_NAMES: Record<string, string> = {
  ENTERPRISEPACK: "Office 365 E3",
  SPE_E3: "Microsoft 365 E3",
  SPE_E5: "Microsoft 365 E5",
  FLOW_FREE: "Power Automate Free",
  TEAMS_EXPLORATORY: "Teams Exploratory",
  POWER_BI_STANDARD: "Power BI Free",
  EXCHANGESTANDARD: "Exchange Online Plan 1",
  AAD_PREMIUM: "Entra ID P1",
  AAD_PREMIUM_P2: "Entra ID P2",
  EMS: "Enterprise Mobility + Security E3",
  EMSPREMIUM: "Enterprise Mobility + Security E5",
  PROJECTPREMIUM: "Project Plan 5",
  VISIOCLIENT: "Visio Plan 2",
  DEFENDER_ENDPOINT_P1: "Defender for Endpoint P1",
  ATP_ENTERPRISE: "Defender for Office 365 P1",
  INTUNE_A: "Intune Plan 1",
  BUSINESS_BASIC: "Microsoft 365 Business Basic",
  O365_BUSINESS_PREMIUM: "Microsoft 365 Business Premium",
  SPB: "Microsoft 365 Business Premium",
};

// Per-seat MONTHLY price (EUR, ex-VAT). Real rates derived from the actual EASI
// (Microsoft 365 CSP) and GMI (Business Central partner) invoices, 2026-06.
// Editable/overridable in Settings → License Prices.
export const DEFAULT_LICENSE_PRICES: Record<string, number> = {
  SPB: 17.55,                          // M365 Business Premium (EASI annual rate €210.63/yr)
  SPE_E3: 36.00,
  SPE_E5: 57.00,
  FLOW_FREE: 0,
  TEAMS_EXPLORATORY: 0,
  POWER_BI_STANDARD: 0,
  AAD_PREMIUM: 6.00,                   // Entra ID P1
  AAD_PREMIUM_P2: 10.08,               // Entra ID P2 (EASI)
  EMS: 9.80,
  EMSPREMIUM: 15.40,
  INTUNE_A: 8.60,
  O365_BUSINESS_ESSENTIALS: 6.72,      // M365 Business Basic (EASI)
  EXCHANGESTANDARD: 4.44,              // Exchange Online P1 (EASI)
  ATP_ENTERPRISE: 2.24,                // Defender for O365 P1 (EASI)
  DYN365_BUSCENTRAL_ESSENTIAL: 69.30,  // BC Essentials (GMI: €5,821.20/yr ÷ 7 seats)
  DYN365_BUSCENTRAL_TEAM_MEMBER: 8.00, // BC Team Member (Microsoft NCE list est.)
};

export const VARIANCE_THRESHOLDS: { green: number; amber: number } = {
  green: 5,
  amber: 10,
};

export const CONCENTRATION_RISK_THRESHOLD: number = 30;
// 25–30% is the "watch" band (recognised TPRM single-vendor caution zone). A
// vendor here isn't flagged red but should be monitored — e.g. EASI at ~29.7%.
export const CONCENTRATION_WATCH_THRESHOLD: number = 25;
