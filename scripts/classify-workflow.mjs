export const meta = {
  name: 'it-completeness-classify',
  description: 'Classify each vendor on an uncaptured G/L account as IT/non-IT, then adversarially verify every IT verdict',
  phases: [
    { title: 'Classify', detail: 'batch-classify candidate vendors as IT vs non-IT' },
    { title: 'Verify', detail: 'skeptic tries to refute each IT classification' },
  ],
}

const cands = (args && args.candidates) || [];
if (!cands.length) { return { error: 'no candidates passed in args.candidates' }; }

// Gheeraert is a Belgian transport & logistics group. Define IT precisely for this context.
const IT_DEF = `
You are auditing the general ledger of GHEERAERT, a Belgian road-transport & logistics group
(trucks, warehousing, garage, real estate). Decide whether a VENDOR's spend on a given G/L
account is INFORMATION-TECHNOLOGY spend.

COUNTS AS IT (isIT=true):
- Computers, laptops, servers, monitors, peripherals, networking gear (switches/wifi/firewalls), printers/copiers (e.g. Canon)
- Software licenses, SaaS subscriptions, cloud & hosting, domains, websites
- Telephony / VoIP / mobile / internet / telecom (e.g. Telenet, Proximus, Orange, 3CX/Connectify)
- External IT services: MSP, helpdesk, IT consultancy, development, system integration, IT support
- IT security: cybersecurity tools, pentests, AND cyber-insurance / cyber-compliance (e.g. CyberContract)
- Fleet/transport OPERATIONAL SOFTWARE & telematics PLATFORMS (TMS, route planning, tachograph DATA systems,
  fleet-management SOFTWARE): e.g. Transics, PTV, Eurotracs, FleetMate, Trimble, Fleetgo. (These are "Operational Software".)

NOT IT (isIT=false):
- Trucks, trailers, tyres, vehicle parts, vehicle maintenance/garage work, truck-mounted hardware
  (reversing cameras, physical tachograph units installed in cabs), AdBlue, fuel/diesel, fuel cards (DKV)
- Physical building security: doors, fire doors, locks, gates, access barriers (e.g. Winlock)
- Office furniture & non-computer supplies, cleaning, catering
- Professional services that are NOT IT: legal, accounting/audit, notary, HR/payroll bureau, management fees, consultancy that is not IT
- Insurance (except cyber), utilities (electricity/gas/water, e.g. Fluvius), banking fees, leasing/rent
- Transport subcontracting / charter, staffing/interim, driver training, marketing/events
- Industrial/workshop consumables (gloves, welding, tools, e.g. Technolit)

When the vendor name + sample line descriptions are ambiguous, set confidence "low" and explain.
Be strict: if it is plausibly vehicle/garage/physical/insurance/professional-services, it is NOT IT.`;

const BATCH_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['verdicts'],
  properties: { verdicts: { type: 'array', items: {
    type: 'object', additionalProperties: false,
    required: ['vendor', 'account', 'isIT', 'category', 'confidence', 'reason'],
    properties: {
      vendor: { type: 'string' }, account: { type: 'string' },
      isIT: { type: 'boolean' },
      category: { type: 'string', description: 'one of: Hardware (Purchases), Software & Licenses, Cloud & Hosting, Telecom, External IT Services, Security, Operational Software, or "n/a" if not IT' },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      reason: { type: 'string' },
    } } } },
};

function batchPrompt(b) {
  const list = b.map((c, i) => `${i + 1}. VENDOR="${c.vendor}" | account=${c.account} (${c.accountName}) | €${c.spend}/yr | sample lines: ${(c.samples || []).join(' ; ') || '(none)'}`).join('\n');
  return `${IT_DEF}\n\nClassify EACH of these ${b.length} vendor/account rows. Return one verdict per row, echoing vendor and account exactly.\n\n${list}`;
}

phase('Classify');
const BATCH = 8;
const batches = [];
for (let i = 0; i < cands.length; i += BATCH) batches.push(cands.slice(i, i + BATCH));
const classified = (await parallel(batches.map((b, idx) => () =>
  agent(batchPrompt(b), { label: `classify:b${idx}`, phase: 'Classify', schema: BATCH_SCHEMA })
))).filter(Boolean).flatMap((r) => r.verdicts || []);

// Re-attach spend/samples (agents may not echo them) by matching vendor+account.
const byKey = {};
for (const c of cands) byKey[`${c.account}|${c.vendor}`] = c;
const flaggedIT = classified.filter((v) => v.isIT).map((v) => ({ ...v, ...(byKey[`${v.account}|${v.vendor}`] || {}), isIT: true }));

phase('Verify');
const SKEPTIC_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['refuted', 'reason'],
  properties: { refuted: { type: 'boolean', description: 'true if this is NOT really IT spend' }, reason: { type: 'string' } },
};
const verified = await parallel(flaggedIT.map((v) => () =>
  agent(`${IT_DEF}\n\nAnother auditor classified this as IT spend. Try HARD to REFUTE that — could it be vehicle/garage, physical security, insurance, professional services, utilities, or transport instead? Default to refuted=true if genuinely uncertain.\n\nVENDOR="${v.vendor}" | account=${v.account} (${v.accountName || '?'}) | €${v.spend || '?'}/yr | sample lines: ${(v.samples || []).join(' ; ') || '(none)'}\n\nClaimed IT category: ${v.category}. Reason given: ${v.reason}`,
    { label: `verify:${(v.vendor || '').slice(0, 18)}`, phase: 'Verify', schema: SKEPTIC_SCHEMA })
    .then((s) => ({ ...v, refuted: s.refuted, skepticReason: s.reason }))
)).then((a) => a.filter(Boolean));

const confirmedIT = verified.filter((v) => !v.refuted).sort((a, b) => (b.spend || 0) - (a.spend || 0));
const rejectedBySkeptic = verified.filter((v) => v.refuted);

return {
  totalCandidates: cands.length,
  classifiedIT: flaggedIT.length,
  confirmedITcount: confirmedIT.length,
  confirmedIT: confirmedIT.map((v) => ({ vendor: v.vendor, account: v.account, accountName: v.accountName, spend: v.spend, category: v.category, confidence: v.confidence, reason: v.reason })),
  rejectedBySkeptic: rejectedBySkeptic.map((v) => ({ vendor: v.vendor, account: v.account, spend: v.spend, why: v.skepticReason })),
};
