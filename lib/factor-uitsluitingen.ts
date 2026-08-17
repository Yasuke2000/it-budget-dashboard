// Factor-uitsluitingen uit de factorportaal-exports ("lelijke excels", 17/08/2026).
// Bron: KBC ComFin-portaal, contract BE32736 (Warehouse - beperkingen 10.08.2026.xlsx); Belfius/BNP-lijsten nog op te vragen
// Facturen die de factor NIET bevoorschot (achterstal/betwisting/limiet): in de
// met-factoring-forecast tellen ze aan 100% op betaalgedrag, niet aan 15%.
// Totaal uitgesloten per 2026-08-10: EUR 42518.45. Belfius (GDI) en
// BNP (GTR) hebben hetzelfde rapport — die lijsten ontbreken nog.
// Bijwerken: nieuwe portaal-export -> exports/factoring/ -> lijst hier verversen.

export const FACTOR_UITSLUITINGEN: Record<string, string[]> = {
  WHS: [
    "202500285",
    "2402905",
    "26010203",
    "26010204",
    "26010205",
    "26010206",
    "26010209",
    "26010543",
    "26020097",
    "26020193",
    "26020299",
    "26020364",
    "26020427",
    "26020548",
    "26020636",
    "26030051",
    "26030118",
    "26030465",
    "26040032",
    "26050466",
    "26050510",
    "F26060579",
    "F26070050",
    "F26070155",
    "F26070179",
    "F26070270",
    "V01-26-0050",
    "V01-26-0102",
  ],
};
