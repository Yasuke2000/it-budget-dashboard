# Cashflowprognose — fase 2-plan (destillaat van de research 17/08/2026)

*Fase 1 (live sinds 17/08, `/cfo/cashflow`): 13-weken direct op betaalgedrag per klant, CN gesaldeerd, factoring-variant (85/15 via 433) side-by-side, kalenderposten (lonen/btw/leasing), maandlaag uit bankseizoenspatroon, 433/niet-toegewezen-monitor.*

## Architectuurbeslissing (uit de research, bevestigd)

- **HERZIEN (beslissing David 18/08): alles in eigen huis — niets blijft bij EMAsphere.** De 13-weken directe forecast én de lange-termijnlaag (maandritme tot eind volgend jaar + 6 mnd) leven in het dashboard. Consequentie: de maandlaag moet doorgroeien van seizoensbeeld naar volwaardige 12-maandenprognose (budget per maand aansluiten, IC-eliminatie zit al in de eigen conso-logica); statutaire rapportering blijft de boekhouding zelf.
- **Anker élke week op de echte bankstand** (staat erin: cashOwn excl. factorkrediet); nooit een geprojecteerd saldo doorschuiven (forecast drift).
- Week 1–4 scherp, week 5–13 richtinggevend; 100% accuraatheid najagen is verspilde tijd.

## Wat accuraatheid écht drijft (prioriteitsvolgorde fase 2)

1. **CODA-dagreconciliatie** — belangrijkste externe bron. Route: **Isabel Connect of Codabox** (géén eigen PSD2: eIDAS-certificaat €2-10k/jr; GoCardless/Nordigen gratis tier is dood). EMAsphere gebruikt zelf Isabel Connect. Actie: Isabel-contracteigenaar intern vinden → connection number aanvragen.
2. **E-trans opmaakdatums** (meeting): het moment van aanbieding aan de factor = het echte 85%-cashmoment. Tot dan is de 85/15-timing een modelaanname.
3. **Factorportaal-rapporten** (KBC ComFin Touch / Belfius / BNP): maandelijkse Excel per factor bevestigd beschikbaar → daarmee de 433-lump-sums aan facturen koppelen en de voorschot-aanname vervangen door realiteit.
4. **Betaaldatum-verdeling per klant verfijnen** (nu: mediaan dagen-tot-betaald). Pas daarna eventueel survival/boosting-model (fase 3, marginale winst).

## Belgische kalender — nog toe te voegen aan het weekprofiel

- **Voorafbetalingen VenB** (aanslagjaar 2027): VA1 ≤ 10/4, VA2 ≤ 10/7, VA3 ≤ 12/10, VA4 ≤ 21/12 — bedragen bij finance opvragen.
- **Viapass/Satellic**: facturatie tweewekelijks (15e + maandeinde). **CO₂-toeslag Vlaanderen sinds 1/7/2026: >32t Euro-VI ±€0,204 → ±€0,286/km (+40%)** — zit deels nog niet in de bankhistoriek waar de maandlaag op leunt → maandlaag onderschat tol vanaf H2. BTW: Wallonië mét btw (recupereerbaar), Vlaanderen/Brussel zonder.
- **RSZ-kwartaalvoorschotten + bedrijfsvoorheffing ~15e** (zit nu impliciet in het 62-maandgemiddelde op maandeinde — splitsen).
- **Accijnsrecuperatie professionele diesel** (FOD Financiën) als terugkerende inflow — sluit aan op de accijns-PRIO-vraag aan finance.
- **Brandstofindex** FOD Economie/CARBU voor de maandlaag.

## Als het dashboard-polled-model knelt (schaalpad, niet nu)

Research-referentiestack: dlt (incrementeel op `systemModifiedAt`) → Postgres/DuckDB → dbt → Dagster, met bc2adls als volume-escape. Rate limits BC: 6.000 req/user/5min, 5 concurrent, 429+Retry-After, 10min→504. Auth: liever certificaat/federated credential dan client secret (zie de verlopen Entra-secret-les bij EMAsphere).

## Governance (deels al staand beleid)

- Forecast-snapshots bewaren en wekelijks 1-13-weken-vooruit-fout meten (MAPE + bias) tegen CODA-actuals → momentopnames-systeem van de cockpit hergebruiken.
- Reconciliatiechecks: som ledger = banksaldo (bestaat als aging-GL-check), forecast-openingssaldo = bankstand.
- RBAC staat (CFO-gate); betaalgedrag-data = GDPR-adjacent → minimalisatie.

## Factoring-feiten (Cost-of-cash + research, ter referentie)

- Voorschot 85% bij alle drie (Belfius/BNP/KBC), bevestigd 17/08. Saldo bij inning. Recourse: alleen KBC/WHS heeft Coface-dekking; Belfius/BNP dragen wij het risico.
- d-basics = data-exportbrug naar factoren/verzekeraars, géén financieringsvorm — relevant als we factuurdata zelf moeten aanleveren.
