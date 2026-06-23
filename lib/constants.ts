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
  "Other IT",
];

export const CATEGORY_COLORS: Record<string, string> = {
  "Software & Licenses": "#0072B2",
  "Hardware (Depreciation)": "#E69F00",
  "Hardware (Purchases)": "#D55E00",
  "Cloud & Hosting": "#56B4E9",
  "External IT Services": "#009E73",
  "Telecom": "#CC79A7",
  "Security": "#F5C710",
  "IT Personnel": "#882255",
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

export const DEFAULT_LICENSE_PRICES: Record<string, number> = {
  SPB: 20.60,
  SPE_E3: 36.00,
  SPE_E5: 57.00,
  FLOW_FREE: 0,
  TEAMS_EXPLORATORY: 0,
  POWER_BI_STANDARD: 0,
  AAD_PREMIUM: 6.00,
  EMS: 9.80,
  EMSPREMIUM: 15.40,
  INTUNE_A: 8.60,
};

export const VARIANCE_THRESHOLDS: { green: number; amber: number } = {
  green: 5,
  amber: 10,
};

export const CONCENTRATION_RISK_THRESHOLD: number = 30;
