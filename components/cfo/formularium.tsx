"use client";

// Formularium — het begrippenregister van de CFO-pagina's. Eén doel: tijdens een
// meeting binnen de vijf seconden kunnen tonen "hoe kom je daaraan" — wat betekent
// de term, wat is de formule, uit welke BC-tabel komt het, en op welke aanname of
// standaard het steunt. De inhoud volgt METHODIEK-FORMULES.md (dat document is de
// canonieke bron; wijzigt daar een formule, dan moet dit register mee).

import { useMemo, useState } from "react";
import { ArrowLeft, Search, ChevronDown, BookOpenText, TriangleAlert } from "lucide-react";

interface Begrip {
  term: string;
  cat: string;
  /** Wat betekent het — gewone taal, één à twee zinnen. */
  wat: string;
  /** De formule, letterlijk zoals gerekend. */
  formule?: string;
  /** Waar komt het vandaan — BC-tabel en velden. */
  bron: string;
  /** Waarop gebaseerd: standaard, aanname of eigen keuze. */
  basis?: string;
  /** Waar het in het dashboard staat. */
  waar?: string;
  /** true = dit cijfer hangt aan een aanname die nog niet bevestigd is. */
  aanname?: boolean;
}

const CATS = [
  "Winst & verlies", "Consolidatie", "Balans & ratio's", "DSO & betaalgedrag",
  "Factoring", "Cash", "BTW", "Spelregels",
] as const;

const BEGRIPPEN: Begrip[] = [
  // ---- Winst & verlies ----
  {
    term: "Bedrijfsopbrengsten", cat: "Winst & verlies",
    wat: "Alles wat de groep verdient uit de gewone bedrijfsactiviteit: omzet, geproduceerde vaste activa en overige bedrijfsopbrengsten.",
    formule: "klasse 70 + 71 + 72 + 74 (per post: credit − debet)",
    bron: "generalLedgerEntries (Business Central), alle 11 vennootschappen, boekingen tot en met vandaag.",
    basis: "Structuur van de Belgische jaarrekening (MAR/PCMN). De eenmalige gebouwenverkoop van €10,63M (705200, GPR) is er bewust uit gehouden — zie 'Niet-recurrente opbrengst'.",
    waar: "CFO-cockpit, eerste KPI-tegel + waterfall",
  },
  {
    term: "EBITDA", cat: "Winst & verlies",
    wat: "Het operationele resultaat vóór afschrijvingen: wat de exploitatie zelf oplevert, los van hoe machines en gebouwen afgeschreven worden.",
    formule: "bedrijfsopbrengsten − (klasse 60 + 61 + 62 + 64)   — klasse 63 telt hier NIET mee",
    bron: "generalLedgerEntries, per rekeningklasse gesommeerd.",
    basis: "Niet-GAAP maar gangbare definitie (CBN Technische nota 2017/01 kent varianten). Onze keuze: niet-recurrente posten (76/66) blijven erbuiten — zuiverder, maar vermeld het bij benchmarks.",
    waar: "CFO-cockpit, waterfall + geconsolideerde kaart",
  },
  {
    term: "EBIT / operationeel resultaat", cat: "Winst & verlies",
    wat: "Het operationele resultaat ná afschrijvingen. Dit is het cijfer dat het dichtst bij 'bedrijfswinst' (code 9901) van de jaarrekening ligt.",
    formule: "EBITDA − klasse 63 (afschrijvingen)",
    bron: "generalLedgerEntries.",
    basis: "CBN Technische nota 2017/01. Let op: afschrijvingen worden bij Gheeraert grotendeels op 31/12 geboekt, dus een YTD-EBIT in de loop van het jaar is systematisch te positief.",
    waar: "CFO-cockpit + Business Units (per vennootschap)",
  },
  {
    term: "Nettoresultaat", cat: "Winst & verlies",
    wat: "Wat er onderaan de streep overblijft na financiële kosten, uitzonderlijke posten en belastingen.",
    formule: "EBIT + (75 − 65) + (76 − 66) − (67 − 77)",
    bron: "generalLedgerEntries. Klassen 68/69/78/79 (resultaatverwerking) zijn uitgesloten — die meerekenen zou het resultaat dubbel tellen.",
    waar: "CFO-cockpit, waterfall",
  },
  {
    term: "Niet-recurrente opbrengst (705200)", cat: "Winst & verlies",
    wat: "De verkoop van de gebouwen door GPR aan ES Finance (€10,63M, maart 2026). Eenmalig — geen omzet uit de bedrijfsactiviteit.",
    bron: "Rekening 705200 bij GPR, geïsoleerd als aparte lijn.",
    basis: "Zonder deze isolatie was het operationeel resultaat +€7,98M i.p.v. −€2,35M, had GPR 99% 'marge' en sprong de maart-DSO van 20 naar 58 dagen. De externe review bevestigde: die boeking hoort eigenlijk op 763 (meerwaarde realisatie vaste activa) — aanbeveling ligt bij de boekhouding.",
    waar: "Business Units, noot onder de firma-tabel",
  },
  // ---- Consolidatie ----
  {
    term: "Intercompany (IC)", cat: "Consolidatie",
    wat: "Transacties tussen onze eigen groepsvennootschappen. Die tellen dubbel als je de firma's gewoon optelt: wat GTR aan WHS factureert is omzet bij de een en kost bij de ander.",
    bron: "Herkend op de tegenpartij van de boeking (klant of leverancier = groepsvennootschap); memoriaalboekingen zonder tegenpartij aanvullend op de omschrijving.",
    basis: "De INTERCO-dimensie in BC is onvolledig, daarom tegenpartij-herkenning. De restfout is zichtbaar in de symmetrie-check.",
    waar: "Overal — elk cijfer zegt of het bruto (incl. IC) of geconsolideerd is",
  },
  {
    term: "Geconsolideerd vs bruto", cat: "Consolidatie",
    wat: "Bruto = de elf firma's opgeteld, met het interne verkeer er nog in. Geconsolideerd = na aftrek van de intercompany-transacties: wat de groep écht aan de buitenwereld verdient.",
    formule: "geconsolideerd = bruto − intercompany (per grootboekregel)",
    bron: "Grootboekposten_Excel (grootboek met tegenpartijen en alle 8 dimensies inline).",
    basis: "Management-consolidatie voor besluitvorming — geen statutaire consolidatie (geen deelnemingen, minderheidsbelangen of herwaarderingen).",
    waar: "Business Units, kaart 'Geconsolideerde P&L' + cockpit-tegels met IC-schakelaar",
  },
  {
    term: "Symmetrie-check", cat: "Consolidatie",
    wat: "Controle op de IC-eliminatie: wat de ene firma intern factureert, moet de andere als kost boeken. IC-omzet en IC-kosten horen dus gelijk te zijn; het verschil (Δ) is de meetfout van de eliminatie.",
    formule: "Δ = IC-omzet − IC-kosten   (ideaal: 0)",
    bron: "Grootboekposten_Excel, beide kanten onafhankelijk geteld.",
    waar: "Business Units, onder de geconsolideerde P&L",
  },
  // ---- Balans & ratio's ----
  {
    term: "Current ratio", cat: "Balans & ratio's",
    wat: "Kan de groep haar korte schulden betalen met wat er op korte termijn beschikbaar is? Boven 1 = de vlottende activa dekken de korte schulden.",
    formule: "(kas + handelsvorderingen + voorraad) ÷ (handelsschulden 44x + korte financiële schulden 43x + fiscale/sociale schulden 45x)",
    bron: "Grootboeksaldi (klassen 55, 3, 43, 45) + open klant- en leveranciersposten.",
    basis: "Gecorrigeerd op 05/08/2026 na externe review: voordien zat alleen de handelsschuld in de noemer en stond de ratio op 1,47 — nu 0,88. Nog steeds een benadering op de condensed balans, geen bankcovenant-cijfer.",
    waar: "CFO-cockpit, ratio-tegels (klikbaar)",
  },
  {
    term: "Quick ratio", cat: "Balans & ratio's",
    wat: "Zelfde vraag als de current ratio, maar strenger: zonder de voorraad, want die moet eerst verkocht worden.",
    formule: "(kas + handelsvorderingen) ÷ alle kortlopende schulden (44x + 43x + 45x)",
    bron: "Zelfde bronnen als de current ratio.",
    waar: "CFO-cockpit, ratio-tegels",
  },
  {
    term: "Solvabiliteit", cat: "Balans & ratio's",
    wat: "Welk deel van alles wat de groep bezit met eigen geld gefinancierd is in plaats van met schuld. Banken kijken hier het eerst naar; 30%+ is comfortabel.",
    formule: "eigen vermogen (klasse 1) ÷ (klasse 2 + 3 + vorderingen + kas) × 100%",
    bron: "Grootboeksaldi per klasse.",
    basis: "De noemer is een benadering van het balanstotaal uit de condensed balans, geen statutair balanstotaal.",
    waar: "CFO-cockpit, ratio-tegels",
  },
  {
    term: "Liquide middelen vs banksaldo", cat: "Balans & ratio's",
    wat: "Twee cashcijfers die elkaar lijken tegen te spreken maar allebei kloppen: 'Liquide middelen (klasse 55)' telt alleen de échte bankrekeningen; de bankenkaart telt óók de factor- en kredietrekeningen mee — en daar staat het opgenomen factorvoorschot als negatief saldo op.",
    formule: "banksaldo totaal = échte cash + factor-/kredietrekeningen (voorschot = SCHULD op 433, geen cash)",
    bron: "BankAccountLedgerEntries per rekening; de bankenkaart splitst beide sinds 10/08/2026.",
    basis: "Concreet voorbeeld: klasse 55 = +€583k terwijl alle rekeningen samen −€846k gaven. Het verschil was de KBC FACTORING-rekening van WHS op −€1,35M — opgenomen voorschot.",
    waar: "Klanten & Cash → Banken; cockpit → condensed balans",
  },
  {
    term: "Cash conversion cycle (CCC)", cat: "Balans & ratio's",
    wat: "Het aantal dagen tussen geld uitgeven aan een opdracht en geld ervoor ontvangen. Negatief = leveranciers financieren de cyclus.",
    formule: "DSO + DIO (voorraaddagen) − DPO",
    bron: "Afgeleid van de drie ratio's ernaast, alle over dezelfde periode.",
    basis: "Voor een transportgroep is de voorraadcomponent klein — de CCC wordt hier vooral gedreven door DSO minus DPO.",
    waar: "CFO-cockpit, ratio-tegels",
  },
  // ---- DSO & betaalgedrag ----
  {
    term: "DSO (balansmethode)", cat: "DSO & betaalgedrag",
    wat: "Hoeveel dagen omzet er bij klanten open staat — hoe lang ons geld gemiddeld bij hen zit voor het binnenkomt. Dit is de trendlijn per maand.",
    formule: "AR-eindsaldo van de maand ÷ omzet van die maand × dagen in die maand",
    bron: "Cust_LedgerEntries (volledige historie, alle vennootschappen). Teller én noemer incl. btw — de dagen-ratio is daardoor btw-neutraal.",
    basis: "Per categorie: extern-via-factoring / extern-niet-factoring / IC. De gebouwenverkoop (ES Finance) is uit de noemer gehouden.",
    waar: "Klanten & Cash, DSO-verloop + kop-KPI's",
  },
  {
    term: "DSO (countback)", cat: "DSO & betaalgedrag",
    wat: "Alternatieve DSO die robuust is bij schommelende omzet: vanaf het openstaande saldo maanden terugtellen tegen de werkelijke maandomzetten tot het saldo 'op' is.",
    formule: "tel terug: zolang saldo ≥ maandomzet → + dagen van die maand; laatste maand pro rata",
    bron: "Zelfde data als de balansmethode.",
    basis: "De methode die veel CFO's verkiezen bij seizoenschommelingen. Staat naast (niet in plaats van) de balansmethode.",
    waar: "Klanten & Cash, kop-KPI + Excel-blad DSO per maand",
  },
  {
    term: "DSO (factuurniveau)", cat: "DSO & betaalgedrag",
    wat: "Het werkelijke betaalgedrag, factuur per factuur: hoeveel dagen zat er tussen factuurdatum en betaling, gewogen op bedrag.",
    formule: "Σ(bedrag × dagen tot betaling) ÷ Σ(bedrag), enkel op volledig betaalde facturen",
    bron: "Gedetailleerde_klantenposten_Excel met Entry_Type = 'Application' — de enige plek in BC met de échte betaaldatum per factuur.",
    basis: "Survivorship-bias, bewust vermeld: alleen betaalde facturen tellen — een klant die al 200 dagen niet betaalt, zit er pas in als hij ooit betaalt. De werkelijke DSO ligt dus iets hoger.",
    waar: "Klanten & Cash, 'Hoe laat betalen klanten?'",
  },
  {
    term: "DPO", cat: "DSO & betaalgedrag",
    wat: "Hoeveel dagen wij er zelf over doen om leveranciers te betalen. Hoger = gunstig voor de cash, tot het de relatie schaadt.",
    formule: "open leveranciersschulden ÷ inkopen (klasse 60 + 61 + 64) × verstreken dagen",
    bron: "VendorLedgerEntries + grootboek.",
    basis: "Bezoldigingen (62) en afschrijvingen (63) zitten bewust niet in de noemer — die lopen niet via leveranciersfacturen. DPO op factuurniveau kan pas als BC 'Detailed Vendor Ledger Entries' publiceert (aangevraagd).",
    waar: "CFO-cockpit ratio-tegel + Klanten & Cash kop-KPI",
  },
  {
    term: "CEI (Collection Effectiveness Index)", cat: "DSO & betaalgedrag",
    wat: "Van al het geld dat we deze maand hádden kunnen innen, welk deel hebben we effectief geïnd? 100% = alles binnengehaald wat inbaar was. Eerlijker dan DSO bij groeiende omzet.",
    formule: "(begin-AR + omzet − eind-AR) ÷ (begin-AR + omzet − niet-vervallen eind-AR) × 100",
    bron: "Cust_LedgerEntries; de niet-vervallen stand per maandeinde wordt gereconstrueerd uit de vervaldatum per post.",
    basis: "Standaard van de Credit Research Foundation. Wij rekenen per maand (N=1) — vergelijk nooit met een jaar-CEI van een andere bron. Naast de maand-CEI staat een 12-maands gemiddelde.",
    waar: "Klanten & Cash, CRF-tegels (klikbaar)",
  },
  {
    term: "Best Possible DSO (BPDSO)", cat: "DSO & betaalgedrag",
    wat: "De DSO die we zouden hebben als élke klant exact op de vervaldag betaalde. Dit is de ondergrens die met de huidige betaalcondities haalbaar is.",
    formule: "niet-vervallen openstaand op maandeinde ÷ omzet van die maand × dagen",
    bron: "Cust_LedgerEntries, vervaldatum per open post.",
    basis: "CRF-standaard. BPDSO daalt alleen door kórtere condities af te spreken — niet door beter te innen.",
    waar: "Klanten & Cash, CRF-tegels",
  },
  {
    term: "ADD (Average Days Delinquent)", cat: "DSO & betaalgedrag",
    wat: "Het aantal dagen dat klanten gemiddeld TE LAAT zijn — het deel van de DSO dat je met bellen en aanmanen kan wegwerken.",
    formule: "DSO − Best Possible DSO",
    bron: "Beide over exact dezelfde maand en noemer.",
    waar: "Klanten & Cash, CRF-tegels",
  },
  {
    term: "Ouderdomsblokken (bellijst)", cat: "DSO & betaalgedrag",
    wat: "Open facturen gebucket op dagen sinds FACTUURDATUM: <30 / 30–45 / 45–60 / 60–90 / 90–180 / 180+. Boven 180 dagen is het dossierwerk (dispuut, jurist), geen belwerk.",
    bron: "Cust_LedgerEntries met Open = true, incl. btw, IC uitgesloten.",
    basis: "Bewust op factuurdatum (hoe lang zweeft het geld al), niet op vervaldag — de kolom 'waarvan vervallen' toont het contractueel te late deel apart. De AP/AR-aging op de cockpit gaat wél op vervaldag.",
    waar: "Klanten & Cash, bellijst + Excel-blad Bellijst",
  },
  {
    term: "Vastgezet kapitaal", cat: "DSO & betaalgedrag",
    wat: "Het bedrag dat gemiddeld extra uitstaat doordat een klant later betaalt dan de norm van 30 dagen — werkkapitaal dat die klant bij ons 'leent'.",
    formule: "gefactureerd 12m ÷ 365 × (gemiddelde betaaltermijn − 30)",
    bron: "Betaalgedrag per klant uit de toewijzingen (Application-posten).",
    basis: "De kostprijs erbij rekent 3,5%/jaar — een AANNAME (zie 'Financieringsrente').", aanname: true,
    waar: "Klanten & Cash, klantentabel + topCost",
  },
  {
    term: "Rijpheidsregel", cat: "DSO & betaalgedrag",
    wat: "Waarom recente maanden géén datapunt hebben: facturen van maand M worden tot diep in M+1 geboekt, dus de laatste 2–3 maanden zijn onvolledig en zouden een absurd hoge DSO tonen.",
    formule: "maand telt pas mee als hij ≥2–3 maanden oud is én de omzet ≥ 25% van de mediaan is",
    bron: "Eigen regel, afgeleid uit het waargenomen boekingsgedrag bij Gheeraert.",
    basis: "Liever géén punt dan een fout punt. De externe review suggereerde ophoogfactoren als verfijning — genoteerd.",
    waar: "Alle maandgrafieken op Klanten & Cash",
  },
  // ---- Factoring ----
  {
    term: "Factoring-label (de tag 'factor')", cat: "Factoring",
    wat: "Een klant heet factoring-klant wanneer minstens 40% van zijn betaald volume via een factor-dagboek is afgewikkeld. Er bestaat GEEN factoring-veld in Business Central — dit is afgeleid.",
    formule: "factorvolume ÷ totaal betaald volume ≥ 40%",
    bron: "Toewijzingen (Application-posten): de dagboekprefix van de afwikkeling — GTR: KBCF/BNPF · GDI: BELF · WHS: KBCC.",
    basis: "De 40% is een eigen drempel (aanname A4). Ex-aanname A7 is BEANTWOORD (finance 17/08/2026): het TDR-dagboek 'KBC' is een gewone KBC-zichtrekening, géén factor — TDR telt niet meer als factoring. Beter blijft: een veld op de klantenkaart — aangevraagd bij GMI.", aanname: true,
    waar: "Klanten & Cash, overal waar 'factor' als label staat",
  },
  {
    term: "Voorschot 85% / retentie 15%", cat: "Factoring",
    wat: "Bij factoring schiet de bank ~85% van de factuur voor zodra ze is ingediend; de resterende 15% (retentie) volgt als de eindklant betaalt. Sneller innen bij een factoring-klant levert dus alleen die 15% op.",
    bron: "Staat NIET in Business Central: elke factuur wordt daar in één keer op 100% afgewikkeld en rekening 499200 beweegt niet. Het percentage leeft volledig binnen de factorrelatie.",
    basis: "85% is BEVESTIGD (Cost-of-cash-analyse Peter, v2 31/07/2026): Belfius 85% · BNP 85% · KBC 85% voorschot. De retentie-vrijgave loopt via de 433-rekening als saldo (finance 17/08/2026): pas wanneer de bank 100% van de klant ontvangt en finance afpunt, zien we het — geen vaste kalenderdatum per factuur.", aanname: false,
    waar: "Klanten & Cash, kaart Cashpotentieel",
  },
  {
    term: "Recourse / terugnamerisico", cat: "Factoring",
    wat: "Bij factoring mét recourse kan de bank het voorschot terugvragen als de eindklant niet betaalt. Facturen van factoring-klanten die >90 dagen open staan zijn daar kandidaten voor.",
    formule: "terugnamerisico = bruto openstaand >90d bij factoring-klanten × 85%",
    bron: "Cust_LedgerEntries + het factor-label.",
    basis: "CBN-advies 2011/23: bij recourse blijven de vorderingen op de balans — precies wat de BC-data toont. Welke variant élke factor hanteert is een openstaande vraag.", aanname: true,
    waar: "Klanten & Cash, Cashpotentieel",
  },
  {
    term: "Factoringkost", cat: "Factoring",
    wat: "Wat factoring ons kost, in twee delen: de commissie (dienstverlening) en de rente/disconto (voor het voorschieten van het geld).",
    formule: "commissie op 613340 (klasse 61) + rente op 650000, beperkt tot de factorposten",
    bron: "Grootboekposten_Excel. Op 650000 staat óók gewone financieringsrente — daarom filteren we op de tegenpartij/omschrijving van de factor.",
    basis: "CBN 2011/23 zegt commissie in klasse 61, rente in klasse 65 (advies noemt 653 — die rekening bestaat niet in ons schema). Bekende inconsistentie: GDI boekt €54k factorloon op 650000 i.p.v. 613340.",
    waar: "Klanten & Cash, factoringkost-tegel + grafiek — gevalideerd op Laura's €119k",
  },
  {
    term: "Time-to-cash", cat: "Factoring",
    wat: "Bij factoring-klanten meet 'dagen tot betaling' de dag waarop de FACTOR afrekende, niet wanneer de eindklant betaalde. Die klanten lijken dus sneller dan ze zijn.",
    bron: "De afwikkelingsdatum in de toewijzingen.",
    basis: "Het gedrag van de eindklant richting de factor staat alleen in de factorportalen — openstaande vraag aan finance.",
    waar: "Klanten & Cash, overal bij factoring-klanten vermeld",
  },
  // ---- Cash ----
  {
    term: "Cashpotentieel / cash-vrijmaking", cat: "Cash",
    wat: "Hoeveel cash er EENMALIG vrijkomt als iedereen op 30 dagen betaalde. Bij factoring-klanten telt alleen de 15%-retentie (de 85% heb je al), bij niet-factoring de volle factuur.",
    formule: "Σ over open facturen ouder dan 30d: bedrag − (85% als factoring-klant)",
    bron: "Cust_LedgerEntries met Open = true + het factor-label.",
    basis: "EENMALIG, geen maandelijkse instroom — het terugkerende voordeel is de rentewinst. Hangt aan de 85%-aanname.", aanname: true,
    waar: "Klanten & Cash, kaart Cashpotentieel",
  },
  {
    term: "Beltarget vs dossierwerk", cat: "Cash",
    wat: "Het realistische beltarget is de vrijmaking in posten tot 180 dagen. Wat ouder is (tot 1.200+ dagen) is dispuut-, aanmanings- of juristenwerk — dat bij het target optellen maakt het onhaalbaar.",
    formule: "beltarget = vrijmaking in posten ≤ 180 dagen; dossier = rest",
    bron: "Zelfde berekening als het cashpotentieel, gesplitst op ouderdom.",
    waar: "Klanten & Cash, Cashpotentieel + bellijst",
  },
  {
    term: "Structurele vrijmaking", cat: "Cash",
    wat: "Een ánder cijfer dan de cash-vrijmaking, en dat hoort zo: dit is het bruto-balanseffect als de DSO structureel naar 30 dagen gaat. Het kent het factorvoorschot niet en rekent oude dossierschuld mee.",
    formule: "(DSO − 30) × dagomzet",
    bron: "DSO-reeks + rijpe maandomzet.",
    basis: "Gebruik de cash-vrijmaking voor 'hoeveel geld komt binnen' en dit cijfer voor 'hoeveel korter staat de balans uit'. De brug tussen beide staat op de kaart.",
    waar: "Klanten & Cash, Cashpotentieel",
  },
  {
    term: "Rentewinst per maand", cat: "Cash",
    wat: "Het terugkerende voordeel van sneller innen: de rente die je niet meer betaalt op het werkkapitaal dat vrijkomt.",
    formule: "cash-vrijmaking × 3,5%/jaar ÷ 12",
    bron: "Afgeleid van het cashpotentieel.",
    basis: "3,5% is een AANNAME — zie 'Financieringsrente'.", aanname: true,
    waar: "Klanten & Cash, Cashpotentieel",
  },
  {
    term: "Financieringsrente (3,5%)", cat: "Cash",
    wat: "De rentevoet waarmee we de kost van vastgezet kapitaal en de rentewinst rekenen. Een aanname — en we hebben geprobeerd hem te meten: dat kan niet uit BC.",
    bron: "Rekening 650000 mengt factoringrente, factorloon, provisies en afrekeningen; meetpogingen gaven 8% / 6,9% / 34% — geen rentevoeten. Zonder de kredietschema's van de bank blijft dit een aanname.",
    basis: "Verlaagd van 5,0% naar 3,5% na externe review. BEVESTIGD dicht bij de realiteit door de Cost-of-cash-analyse (Peter, v2 31/07/2026): factoring effectief BNP ≈3,10% · Belfius ≈3,45% · KBC ≈3,70% (E3M ≈2,35% + marge) — opname-gewogen ±3,4%. Alleen de straight-loanvoeten (KBC/BNP, R/C 433000) staan nog open. Instelbaar via Settings.", aanname: true,
    waar: "Klanten & Cash, Cashpotentieel + klantentabel",
  },
  {
    term: "13 weken vooruit (afwikkeling)", cat: "Cash",
    wat: "De afwikkeling van de BESTAANDE posten over 13 weken: elke open klant- en leveranciersfactuur op haar vervaldatum, plus loonlast, afgerold vanaf het huidige kassaldo.",
    formule: "saldo(w) = saldo(w−1) + vervallende AR − vervallende AP − loon",
    bron: "Open Cust_LedgerEntries + VendorLedgerEntries + banksaldo.",
    basis: "GEEN volledige cashprognose: toekomstige facturatie, nieuwe inkopen, btw-afdrachten, kredietaflossingen en leasingtermijnen zitten er niet in — de lijn oogt daardoor te gunstig naarmate je verder kijkt. Bewust zo gelabeld.",
    waar: "CFO-cockpit",
  },
  {
    term: "Verwachte inning", cat: "Cash",
    wat: "Dezelfde 13 weken, maar realistischer: elke open factuur ingepland op het historische betaalgedrag van díe klant in plaats van op de vervaldatum. Het verschil met de stippellijn is het verwachte uitstel.",
    formule: "verwachte betaaldag = factuurdatum + gemiddelde betaaltermijn van die klant (fallback: groepsmediaan)",
    bron: "Open posten + betaalgedrag uit de toewijzingen.",
    basis: "Prognose op gedrag uit het verleden, geen toezegging. Vervallen verwachtingen schuiven naar week 1.",
    waar: "Klanten & Cash, 'Verwachte inning — komende 13 weken'",
  },
  // ---- BTW ----
  {
    term: "BTW-saldo", cat: "BTW",
    wat: "Per aangifteperiode: de btw die we verschuldigd zijn op verkopen min de btw die we mogen aftrekken op aankopen. Positief = te betalen aan de Staat.",
    formule: "verschuldigde btw (verkopen) − aftrekbare btw (aankopen)",
    bron: "Btw_posten_Excel, gegroepeerd op VAT_Reporting_Date (de aangifteperiode, niet de boekingsdatum) — sluit dus aan op wat effectief aangegeven is.",
    waar: "Klanten & Cash, BTW-sectie",
  },
  {
    term: "BTW-voorfinanciering", cat: "BTW",
    wat: "Wat we gemiddeld per maand aan de Staat voorschieten: btw op een verkoopfactuur moet afgedragen worden zodra ze aangegeven is, ook al heeft de klant nog niet betaald.",
    formule: "gemiddelde van de maandelijkse nettosaldi over de afgesloten periodes",
    bron: "Btw_posten_Excel.",
    waar: "Klanten & Cash, BTW-tegels",
  },
  {
    term: "Btw-eenheid", cat: "BTW",
    wat: "De groep vormt een btw-eenheid: één geconsolideerde btw-aangifte, het saldo wordt op eenheidsniveau afgerekend. De cijfers per vennootschap zijn informatief.",
    bron: "De VAT-Group-module in BC bevat geen submissions (live gecheckt) — rapportering per vennootschap, afrekening op eenheidsniveau.",
    basis: "Openstaand: de perimeter documenteren (welke firma's zitten erin).",
    waar: "Klanten & Cash, BTW-sectie",
  },
  // ---- Spelregels ----
  {
    term: "Incl. of excl. btw?", cat: "Spelregels",
    wat: "Vaste conventie: alles uit de resultatenrekening (omzet, kosten, marges) is EXCL. btw; alles wat een klant moet overschrijven (open posten, aging, bellijst, cashprognose) is INCL. btw. Daarom is 'omzet per klant' lager dan 'openstaand per klant'.",
    bron: "Elk cijfer draagt dit label in de app.",
    waar: "Overal",
  },
  {
    term: "Momentopname vs periode", cat: "Spelregels",
    wat: "Een standcijfer (open posten, saldi, balans, aging) is een momentopname van één dag en beweegt niet mee met de periodekiezer. Een periodecijfer (omzet, kosten, DSO van een maand) gaat over een datumbereik. Elke kaart draagt een badge met exacte datums.",
    bron: "Periode-conventie sinds 04/08/2026 (vraag Laura): nooit alleen 'YTD' of een weeknummer, altijd exacte datums.",
    waar: "Elke kaart en tegel",
  },
  {
    term: "YTD eindigt vandaag, niet op 31/12", cat: "Spelregels",
    wat: "Vooruit-gedateerde boekingen (in het grootboek stonden posten tot 01/12/2026) tellen niet mee — anders zou de year-to-date vervalst zijn.",
    bron: "Alle YTD-berekeningen knippen op de dag van de datapull.",
    waar: "Overal",
  },
  {
    term: "Nooit $top (volledigheid)", cat: "Spelregels",
    wat: "BC-queries gebruiken nooit de $top-parameter: die kapt het TOTALE resultaat af, niet per pagina. In juli gaf één $top een schijnbare omzetdelta van €25M.",
    bron: "Paginering via @odata.nextLink tot de laatste pagina; bij >800 pagina's wordt een fout gegooid in plaats van stil af te kappen.",
    waar: "Alle datapulls",
  },
  {
    term: "AR/AP-aansluiting (Δ €0)", cat: "Spelregels",
    wat: "De ingebouwde controle die bewijst dat we geen posten dubbel of te weinig tellen: de som van de open posten moet exact aansluiten op de grootboek-controlerekeningen.",
    formule: "Σ open klantposten = saldo 400000+400001 · Σ open leveranciersposten = saldo 440000+440001",
    bron: "Draait live als verificatiepaneel; laatste onafhankelijke herverificatie: Δ €0 bij alle 11 vennootschappen. Daarnaast: vergelijking met BC's éigen aged-rapporten.",
    waar: "Klanten & Cash, verificatiepaneel onderaan",
  },
  {
    term: "Aanname (register A1–A8)", cat: "Spelregels",
    wat: "Cijfers die op een aanname steunen zijn overal als zodanig gelabeld. Op 17/08/2026 zijn er twee gesloten: het 85%-voorschot is bevestigd (Cost-of-cash-analyse) en het TDR-dagboek 'KBC' bleek een gewone bankrekening (géén factor). Open blijft vooral: de echte straight-loanrentes. Elk punt staat in het aannameregister van METHODIEK-FORMULES.md.",
    bron: "METHODIEK-FORMULES.md §13 + mails/2026-08-10-vragen-voor-accuraatheid.md (21 vragen aan finance/boekhouding/GMI).",
    waar: "Dit register — alle items met een geel driehoekje",
    aanname: true,
  },
];

export function Formularium() {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const hits = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return BEGRIPPEN.filter((b) =>
      (!cat || b.cat === cat) &&
      (!needle || `${b.term} ${b.wat} ${b.formule || ""} ${b.bron}`.toLowerCase().includes(needle)),
    );
  }, [q, cat]);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <a href="/cfo" className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground ring-1 ring-border hover:text-foreground"><ArrowLeft className="h-3 w-3" />CFO-cockpit</a>
              <a href="/cfo/klanten" className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground ring-1 ring-border hover:text-foreground">Klanten &amp; Cash →</a>
              <h1 className="flex items-center gap-2 text-lg font-bold text-foreground"><BookOpenText className="h-5 w-5 text-primary" />Formularium</h1>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Elk begrip op de CFO-pagina&apos;s: wat het betekent, de formule, de bron in Business Central en waarop het gebaseerd is.
              Items met <TriangleAlert className="inline h-3 w-3 text-warning" /> steunen op een aanname die nog niet door finance/de bank bevestigd is.
            </p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q} onChange={(e) => setQ(e.target.value)} placeholder="Zoek een begrip…"
              className="w-64 rounded-full border border-border bg-background py-1.5 pl-8 pr-3 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/50"
            />
          </div>
          <button onClick={() => setCat(null)} className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ring-1 transition ${!cat ? "bg-primary/15 text-primary ring-primary/40" : "bg-muted text-muted-foreground ring-border hover:text-foreground"}`}>
            alles ({BEGRIPPEN.length})
          </button>
          {CATS.map((c) => (
            <button key={c} onClick={() => setCat(cat === c ? null : c)} className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ring-1 transition ${cat === c ? "bg-primary/15 text-primary ring-primary/40" : "bg-muted text-muted-foreground ring-border hover:text-foreground"}`}>
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        {hits.map((b) => {
          const isOpen = open === b.term;
          return (
            <div key={b.term} className={`rounded-xl border bg-card shadow-sm transition ${isOpen ? "border-primary/40" : "border-border"}`}>
              <button
                onClick={() => setOpen(isOpen ? null : b.term)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
              >
                <span className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">{b.term}</span>
                  {b.aanname && <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-warning" aria-label="steunt op een aanname" />}
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">{b.cat}</span>
                </span>
                <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
              </button>
              {!isOpen && <p className="-mt-1 px-4 pb-3 text-[11px] leading-snug text-muted-foreground">{b.wat.split(".")[0]}.</p>}
              {isOpen && (
                <div className="space-y-2 border-t border-border px-4 py-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Wat betekent het</p>
                    <p className="mt-0.5 text-xs leading-snug text-foreground">{b.wat}</p>
                  </div>
                  {b.formule && (
                    <div className="rounded-lg border border-border bg-background/50 p-2.5">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Formule</p>
                      <p className="mt-0.5 font-mono text-[11px] leading-relaxed text-foreground">{b.formule}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Waar komt het vandaan</p>
                    <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{b.bron}</p>
                  </div>
                  {b.basis && (
                    <div className={`rounded-lg p-2.5 ${b.aanname ? "border border-warning/30 bg-warning/10" : "border border-border bg-background/50"}`}>
                      <p className={`text-[10px] font-semibold uppercase tracking-wide ${b.aanname ? "text-warning" : "text-muted-foreground"}`}>Waarop gebaseerd</p>
                      <p className="mt-0.5 text-[11px] leading-snug text-foreground">{b.basis}</p>
                    </div>
                  )}
                  {b.waar && <p className="text-[10px] text-muted-foreground">Staat op: {b.waar}</p>}
                </div>
              )}
            </div>
          );
        })}
        {!hits.length && <p className="py-8 text-center text-xs text-muted-foreground">Geen begrip gevonden voor &quot;{q}&quot; — zoek anders of kies een categorie.</p>}
      </div>

      <p className="pb-6 text-center text-[10px] text-muted-foreground">
        Canonieke bron: METHODIEK-FORMULES.md (volledige formules, aannameregister A1–A8 en de externe review van 05/08/2026).
      </p>
    </div>
  );
}
