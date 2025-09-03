export const DEFAULT_GL_MAPPING: Record<string, string> = {
  "61100": "Software & Licenses",
  "61200": "Software & Licenses",
  "62100": "Telecom",
  "62200": "Telecom",
  "63100": "External IT Services",
  "63200": "External IT Services",
  "64100": "IT Personnel",
  "23100": "Hardware (Depreciation)",
  "23200": "Hardware (Depreciation)",
  "60100": "Cloud & Hosting",
  "60200": "Cloud & Hosting",
  "65100": "Security",
  "65200": "Security",
};

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
  "Software & Licenses": "#0d9488",
  "Hardware (Depreciation)": "#f97316",
  "Hardware (Purchases)": "#fb923c",
  "Cloud & Hosting": "#3b82f6",
  "External IT Services": "#8b5cf6",
  "Telecom": "#22c55e",
  "Security": "#ef4444",
  "IT Personnel": "#eab308",
  "Other IT": "#6b7280",
};

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
