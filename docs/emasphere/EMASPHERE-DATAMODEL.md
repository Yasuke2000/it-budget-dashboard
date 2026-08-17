# EMAsphere — reverse engineering datamodel (Gheeraert Transport Conso)

Uitgelezen op 2026-08-17 via de EMAsphere MCP-server (versie 2026.5.0), gebruiker David Delporte.
Situatie: `REPORTING - REPORTING 2026-03` (PUBLISHED, cutoff 2026-03), reporting currency EUR.

Doel: genoeg detail om EMAsphere-rapportering te repliceren op eigen infrastructuur
(BC365 → eigen berekeningen → eigen dashboard), zonder EMAsphere in de keten.

## 1. Kernconclusie

EMAsphere is **geen** financiële engine. Het is een dunne semantische laag boven één
platte feitentabel. De hele "intelligentie" zit in drie dingen:

1. Een **mapping** van grootboekrekening → `categoryCode` (bv. `701100` → `70-VERT`)
2. **Datagrids**: rijen = filterpredicaten op `categoryCode`, plus formule-rijen (`13 = 1+5+9`)
3. **KPI-definities**: variabelen + vergelijkingsassen (Actual / LY / Budget)

Alles daaronder is `SUM(amount) GROUP BY dimensies, refMonth`. Volledig repliceerbaar.
De moeilijkheid zit in de mappingtabel en ~130 datagrids, niet in de techniek.

## 2. Entiteiten

Base tenant Consolidation `b25474b0-8b13-4aa6-89a0-61a664f357de` + 9 dochters (zie
entity_kpis_2026-03.csv voor UUID's). LMB/GEX zitten NIET in de conso. Boekjaren =
kalenderjaren, exercise 1 = 2015 t/m 14 = 2028; huidig 2026 (nr 12). Geen aggregation scopes.

## 3. Feitentabel: flow `movement`

Volledig schema in movement_schema.csv. Kern: `categoryCode` is de spil van alle rapporten;
`amount` is **credit-positief**; `period` = refMonth; analytics: 1=Partners (leeg),
**2=Afdeling**, **3=Vloot (nummerplaat+model!)**, 4=IC-vlag; afgeleide analytics niet repliceren.

## 4. Tekenconventies (valkuil #1)

- `movement`: credit-positief (opbrengsten +, kosten −, natuurlijke activa −).
- Balansgrid zet `negate: true` op actiefrijen → debet-positief in de summary.
- `get_balance_sheet_summary` (activa debet-positief) vs `get_financial_breakdown(Assets)`
  (credit-positief): abs() nemen vóór vergelijken. Passiva in beide credit-positief.
- Eigen model: kies één conventie (debet-positief; `amount * -1` bij inlezen).

## 5. Datagrid = rapportdefinitie

Rijtypes: Filter (predicaat op categoryCode → SUM), Formula (`2..4`, `1+5+9`, `36-38`;
rij-ID's zijn posities!), Empty, DrillDown, Variable, Conditional, Computed.
Pseudo-categorieën: `$$Costs`, `$$Revenues`, `$$Results`. Grid types: PNL, BALANCE_SHEET,
CASH_FLOW, COST, REVENUE, FORECAST_WORKBENCH, CUSTOM. `datagridProvider`:
accounting-service (movement) of operational-service (Trip e.a.).

## 6. Hoofd-P&L (grid `P&L`, id 14cab313-7a01-4d29-8a71-1260b73a76f7)

39 rijen — volledige mapping in pnl_line_mapping.csv. Controlelijn (rij 39) = rij 36
(gestructureerd resultaat) − rij 38 (brute som Costs+Revenues).

## 7. Balans (grid `Balans`, id 9b4114fe-56fb-4dbb-b993-f024f6a199e8)

Belgisch MAR op categoryCode: 20-BA-OP … 58-BA-*; passiva 10-BP-GK … 16-BP-VOO.
R/C-codes per entiteit: 41-RC-GDI/GPR/GSS/GTG/GTR/TFO = interco-eliminatiehaken.

## 8. Situaties (bitemporeel model)

Situatie pint (1) injectieversies per flow en (2) de cutoff (grens actual/forecast).
Reporting date = losse analytische cursor. Statussen PUBLISHED (bevroren) / PENDING (live) /
IN_REVIEW / ARCHIVED. Drie datasets per situatie: Current (actuals), Comparison (LY, = value2),
Reference (Budget — GEEN aparte situatie; alleen via KPI-comparisons met sourceSituation="Reference").
Eigen model: snapshot_id op elke feitrij + snapshots-tabel (cutoff, status, comparison/budget-ref).

### Dataflows in REPORTING 2026-03
Boekhouding: movements (injectie 165, 07/05/2026) · forecasts (injectie 1, 10/03/2026, ref 2025-12).
Operationeel: Trip (318) · Trip_rendabiliteit (276) · Customer (217).
HR (Officient): Individual, Contract, Pay Slip(+Line), Leave, Seniority, Position, Office,
Transaction, Collective Agreement + categorietabellen — ALLE laatst ingelezen **2026-01-08**.

> **SIGNAAL:** alle HR/Trip-flows stoppen op 2026-01-08 terwijl movements t/m 2026-05 loopt —
> consistent met een verlopen Entra client secret (`07446dd3-f668-4b0e-8c14-15110ffd7305`).
> Alles wat op Trip/Officient steunt (Gem Omzet/Km, FTE, absenteïsme, trip-rendabiliteit)
> is sinds januari bevroren. → Actie: secret vernieuwen (Azure Portal).

### Manuele correcties in deze situatie (NIET in BC!)
TOF nieuwe coaches (2025-09) · raming verzekering (2026-01) · reclass huur (2026-02, dup) ·
Van den Ende TOF 2025 (2026-02) · **verhoogde huur naar uitzonderlijke** (2026-03) ·
**eliminatie onroerende lease** (2026-03) · **Raming Accijnsrecup 032026** (2026-03) ·
**overdracht vakantiegeld naar 04** (2026-03).
Zonder een eigen manual_adjustments-laag sluiten BC-gebaseerde cijfers hier nooit op aan.

## 9. Bevindingen

**Controlelijn ≠ 0, fors**: 1.736.344 YtD 2026 en 5.035.681 over 2025 — elke maand
400k–950k positief. Ofwel mappinggat (codes die nergens gedekt worden), ofwel structurele
scope-/tekenafwijking (67-TAX/77-REG in groep Results; negate). Niemand weet het.
→ [PRIO] navragen vóór migratie: EMAsphere's eigen integriteitscheck staat niet op nul.

**Uitzonderlijke kosten maart 2026 −1.598.298** → de manuele huur-reclasses (GDI 610090).

## 10. Migratiepad

| # | Artefact | Bron | Moeilijkheid |
|---|---|---|---|
| 1 | Mapping rekening→categoryCode | niet exporteerbaar via MCP; opvragen bij EMAsphere of afleiden via get_financial_breakdown(criteria=account) | **HOOG — de echte lock-in** |
| 2 | Feitentabel | BC OData GL + dimensies | laag |
| 3 | Analytics 1–4 | BC-dimensies (Afdeling, Vloot, Partners, IC) | laag |
| 4 | ~130 datagrid-definities | config_get_datagrid per id | middel |
| 5 | KPI-definities | config_get_kpi_definition | middel |
| 6 | Manuele correcties (bedragen!) | alleen namen via MCP; bedragen bij boekhouding | **HOOG** |
| 7 | Historiek 2015–2025 | alleen via EMAsphere | middel, eenmalig |
| 8 | Situatieversie-historiek | list_situations + herbevragen | hoog, zelden de moeite |

**Vraag EMAsphere expliciet om een export van de mappingtabel vóór opzeg** — contractueel jullie data.

## 11. API-oppervlak & extractie

Zie emasphere_client.py (skelet, geverifieerd tegen 2026.5.0). Waarschuwingen:
get_financial_breakdown_detail is ONgepagineerd (8,7MB per brede call) — altijd per maand ×
entiteit × groep snijden; get_financial_breakdown toont top-5 + Other (isResidual).
Dimensieledenlijsten makkelijker uit BC halen dan uit EMAsphere.
