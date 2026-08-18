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
];

export const isApUitzondering = (co: string, doc: string): ApUitzondering | undefined =>
  AP_UITZONDERINGEN.find((u) => u.co === co.toUpperCase() && u.doc === doc);
