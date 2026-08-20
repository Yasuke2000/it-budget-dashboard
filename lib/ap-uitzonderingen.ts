// Apart gezette leveranciersposten — open posten die GEEN cash-out worden.
// Ze verdwijnen niet (aansluiting met het grootboek blijft zichtbaar), maar
// tellen niet mee in de aging-blokken of de cashflowprognose-uitstroom.
// Bijwerken: post toevoegen met firma + documentnummer + reden + wie/wanneer.

export interface ApUitzondering { co: string; doc: string; reden: string }

export const AP_UITZONDERINGEN: ApUitzondering[] = [
  {
    co: "GDI",
    doc: "AF26030354",
    reden:
      "Akte sale-and-leaseback Sint-Niklaas (ES Finance, €1.928.891): opgemaakt bij de akte, zit al als uitzonderlijke kost in de P&L (verhoogde eerste huur, incl. 3 maanden huur) en wordt via de akte verrekend — geen cash-out. (David, 18/08/2026)",
  },
  // ---- Rode markeringen beslislijst Laura 20/08/2026 (som EUR 2.844.000 incl.
  // 4 GSS-regels met afwijkende kleur): facturen die boekhoudkundig nog verwerkt
  // worden (saldering/CN/betwist) maar zeker niet meer betaald worden. Bron:
  // 'Openstaande leveranciersfacturen - beslislijst 2026-08-20 Laura.xlsx'.
  { co: "GRE", doc: "AF26070148", reden: "NV DESARENT, EUR 425,931.36. Beslissing Laura 20/08/2026 (rode markering beslislijst): boekhoudkundig nog te verwerken, wordt zeker niet meer betaald — geen cash-out." },
  { co: "GPR", doc: "AF25120009", reden: "HEXAPORT, EUR 311,575.00. Beslissing Laura 20/08/2026 (rode markering beslislijst): boekhoudkundig nog te verwerken, wordt zeker niet meer betaald — geen cash-out." },
  { co: "GRE", doc: "AF26020003", reden: "NV DESARENT, EUR 215,616.86. Beslissing Laura 20/08/2026 (rode markering beslislijst): boekhoudkundig nog te verwerken, wordt zeker niet meer betaald — geen cash-out." },
  { co: "GDI", doc: "AF26060604", reden: "ES FINANCE NV/SA, EUR 213,168.06. Beslissing Laura 20/08/2026 (rode markering beslislijst): boekhoudkundig nog te verwerken, wordt zeker niet meer betaald — geen cash-out." },
  { co: "TDR", doc: "202501676", reden: "DESARENT NV, EUR 114,297.81. Beslissing Laura 20/08/2026 (rode markering beslislijst): boekhoudkundig nog te verwerken, wordt zeker niet meer betaald — geen cash-out." },
  { co: "TDR", doc: "AF26010101", reden: "DESARENT NV, EUR 114,297.81. Beslissing Laura 20/08/2026 (rode markering beslislijst): boekhoudkundig nog te verwerken, wordt zeker niet meer betaald — geen cash-out." },
  { co: "TDR", doc: "202501216", reden: "DESARENT NV, EUR 95,277.11. Beslissing Laura 20/08/2026 (rode markering beslislijst): boekhoudkundig nog te verwerken, wordt zeker niet meer betaald — geen cash-out." },
  { co: "WHS", doc: "202500369", reden: "MORE WAY SERVICE SRL, EUR 80,000.00. Beslissing Laura 20/08/2026 (rode markering beslislijst): boekhoudkundig nog te verwerken, wordt zeker niet meer betaald — geen cash-out." },
  { co: "GPR", doc: "AF26040010", reden: "SA CERATEC, EUR 55,480.34. Beslissing Laura 20/08/2026 (rode markering beslislijst): boekhoudkundig nog te verwerken, wordt zeker niet meer betaald — geen cash-out." },
  { co: "TDR", doc: "AF26010015", reden: "DESARENT NV, EUR 14,520.00. Beslissing Laura 20/08/2026 (rode markering beslislijst): boekhoudkundig nog te verwerken, wordt zeker niet meer betaald — geen cash-out." },
  { co: "TDR", doc: "AF26010020", reden: "DESARENT NV, EUR 4,519.64. Beslissing Laura 20/08/2026 (rode markering beslislijst): boekhoudkundig nog te verwerken, wordt zeker niet meer betaald — geen cash-out." },
  { co: "GRE", doc: "AF26050173", reden: "NV DESARENT, EUR 1,089.00. Beslissing Laura 20/08/2026 (rode markering beslislijst): boekhoudkundig nog te verwerken, wordt zeker niet meer betaald — geen cash-out." },
  { co: "GRE", doc: "AF26050174", reden: "NV DESARENT, EUR -1,089.00. Beslissing Laura 20/08/2026 (rode markering beslislijst): boekhoudkundig nog te verwerken, wordt zeker niet meer betaald — geen cash-out." },
  { co: "GDI", doc: "BEL-26-121/11", reden: "ES FINANCE NV/SA, EUR -213,168.06. Beslissing Laura 20/08/2026 (rode markering beslislijst): boekhoudkundig nog te verwerken, wordt zeker niet meer betaald — geen cash-out." },
  { co: "GRE", doc: "AF26030110", reden: "NV DESARENT, EUR -215,616.86. Beslissing Laura 20/08/2026 (rode markering beslislijst): boekhoudkundig nog te verwerken, wordt zeker niet meer betaald — geen cash-out." },
  { co: "GPR", doc: "BNP-25070/1", reden: "HEXAPORT, EUR -311,575.00. Beslissing Laura 20/08/2026 (rode markering beslislijst): boekhoudkundig nog te verwerken, wordt zeker niet meer betaald — geen cash-out." },
  { co: "GDI", doc: "AF25120317", reden: "DESARENT N.V., EUR 1,391.50. Beslissing Laura 20/08/2026 (rode markering beslislijst): boekhoudkundig nog te verwerken, wordt zeker niet meer betaald — geen cash-out." },
  { co: "TDR", doc: "202501651", reden: "DESARENT NV, EUR 968.00. Beslissing Laura 20/08/2026 (rode markering beslislijst): boekhoudkundig nog te verwerken, wordt zeker niet meer betaald — geen cash-out." },
  { co: "TDR", doc: "AF26010016", reden: "DESARENT NV, EUR 968.00. Beslissing Laura 20/08/2026 (rode markering beslislijst): boekhoudkundig nog te verwerken, wordt zeker niet meer betaald — geen cash-out." },
  { co: "GDI", doc: "AF25110286", reden: "DESARENT N.V., EUR 695.75. Beslissing Laura 20/08/2026 (rode markering beslislijst): boekhoudkundig nog te verwerken, wordt zeker niet meer betaald — geen cash-out." },
  { co: "GDI", doc: "AF26010318", reden: "DESARENT N.V., EUR 695.75. Beslissing Laura 20/08/2026 (rode markering beslislijst): boekhoudkundig nog te verwerken, wordt zeker niet meer betaald — geen cash-out." },
  { co: "TDR", doc: "AF26010014", reden: "DESARENT NV, EUR 500.00. Beslissing Laura 20/08/2026 (rode markering beslislijst): boekhoudkundig nog te verwerken, wordt zeker niet meer betaald — geen cash-out." },
  { co: "TDR", doc: "202501652", reden: "DESARENT NV, EUR 484.00. Beslissing Laura 20/08/2026 (rode markering beslislijst): boekhoudkundig nog te verwerken, wordt zeker niet meer betaald — geen cash-out." },
  { co: "TDR", doc: "AF26010017", reden: "DESARENT NV, EUR 484.00. Beslissing Laura 20/08/2026 (rode markering beslislijst): boekhoudkundig nog te verwerken, wordt zeker niet meer betaald — geen cash-out." },
  { co: "GSS", doc: "AF25100032", reden: "NV DESARENT, EUR 1,149.50. Beslissing Laura 20/08/2026 (rode markering beslislijst): boekhoudkundig nog te verwerken, wordt zeker niet meer betaald — geen cash-out. (Afwijkende kleurmarkering — zelfde DESARENT-opkuis; schrappen als dit niet bedoeld was.)" },
  { co: "GSS", doc: "AF25110028", reden: "NV DESARENT, EUR 1,149.50. Beslissing Laura 20/08/2026 (rode markering beslislijst): boekhoudkundig nog te verwerken, wordt zeker niet meer betaald — geen cash-out. (Afwijkende kleurmarkering — zelfde DESARENT-opkuis; schrappen als dit niet bedoeld was.)" },
  { co: "GSS", doc: "AF25120023", reden: "NV DESARENT, EUR 1,149.50. Beslissing Laura 20/08/2026 (rode markering beslislijst): boekhoudkundig nog te verwerken, wordt zeker niet meer betaald — geen cash-out. (Afwijkende kleurmarkering — zelfde DESARENT-opkuis; schrappen als dit niet bedoeld was.)" },
  { co: "GSS", doc: "AF26010018", reden: "NV DESARENT, EUR 1,149.50. Beslissing Laura 20/08/2026 (rode markering beslislijst): boekhoudkundig nog te verwerken, wordt zeker niet meer betaald — geen cash-out. (Afwijkende kleurmarkering — zelfde DESARENT-opkuis; schrappen als dit niet bedoeld was.)" },
];

export const isApUitzondering = (co: string, doc: string): ApUitzondering | undefined =>
  AP_UITZONDERINGEN.find((u) => u.co === co.toUpperCase() && u.doc === doc);
