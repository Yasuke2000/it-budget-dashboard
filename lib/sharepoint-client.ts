// SharePoint (Microsoft Graph) client — leest de contractdocumenten uit de map
// "Finance → IT → Dienstverleningsovereenkomsten" zodat het contractregister de
// brondocumenten kan tonen zonder handmatig zoeken.
//
// Vereist de Graph APPLICATION-machtiging `Sites.Read.All` (of `Sites.Selected`
// met een grant op de Finance-site) op dezelfde app-registratie als BC/Graph.
// Zonder die machtiging antwoordt Graph 403 — dat vertalen we naar een duidelijke
// SharePointPermissionError zodat de UI kan uitleggen wát er toegekend moet worden.

import { getGraphToken } from "./graph-client";
import { fetchWithRetry } from "./http";

// Drive van de Finance-site + pad naar de contractenmap. Overschrijfbaar via env
// zodat een verhuizing van de map geen deploy vergt.
const DRIVE_ID =
  process.env.SHAREPOINT_CONTRACTS_DRIVE_ID ||
  "b!3lk4YmbBs0yt0iLYYPsV7JcH-p4KcfNBm7bgAH57cIPTLCKyFPGQSp_Z2RrWOr-S";
const FOLDER_PATH =
  process.env.SHAREPOINT_CONTRACTS_PATH || "IT/Dienstverleningsovereenkomsten";

export class SharePointPermissionError extends Error {
  constructor() {
    super(
      "Graph-machtiging ontbreekt: ken 'Sites.Read.All' (Application) toe aan de app-registratie en geef admin consent."
    );
    this.name = "SharePointPermissionError";
  }
}

export interface ContractDocument {
  /** Leveranciers-submap (of "" voor bestanden in de hoofdmap). */
  folder: string;
  name: string;
  webUrl: string;
  lastModified: string;
  sizeBytes: number | null;
}

interface DriveItem {
  name?: string;
  webUrl?: string;
  lastModifiedDateTime?: string;
  size?: number;
  folder?: { childCount?: number };
}

async function listChildren(token: string, subPath: string): Promise<DriveItem[]> {
  const path = subPath ? `${FOLDER_PATH}/${subPath}` : FOLDER_PATH;
  const url =
    `https://graph.microsoft.com/v1.0/drives/${DRIVE_ID}/root:/${encodeURI(path)}:/children` +
    `?$select=name,webUrl,lastModifiedDateTime,size,folder&$top=200`;
  const res = await fetchWithRetry(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (res.status === 403) throw new SharePointPermissionError();
  if (!res.ok) throw new Error(`Graph drive listing failed: ${res.status}`);
  const data = (await res.json()) as { value?: DriveItem[] };
  return data.value || [];
}

/** Lichtgewicht probe voor /api/status: kan de app de contractenmap zien? */
export async function probeContractsFolder(): Promise<void> {
  const token = await getGraphToken();
  await listChildren(token, "");
}

/**
 * Alle documenten in de contractenmap, één niveau diep (de map is georganiseerd
 * als één submap per leverancier/overeenkomst).
 */
export async function fetchContractDocuments(): Promise<ContractDocument[]> {
  const token = await getGraphToken();
  const root = await listChildren(token, "");
  const docs: ContractDocument[] = [];
  const folders = root.filter((it) => it.folder);
  for (const it of root.filter((it) => !it.folder)) {
    docs.push({
      folder: "",
      name: it.name || "",
      webUrl: it.webUrl || "",
      lastModified: it.lastModifiedDateTime || "",
      sizeBytes: it.size ?? null,
    });
  }
  // Sequentieel is prima: het gaat om ~15 submappen, en zo blijven we ver onder
  // de Graph-throttlinglimieten.
  for (const f of folders) {
    const children = await listChildren(token, f.name || "");
    for (const it of children) {
      if (it.folder) continue; // dieper dan 1 niveau komt in deze map niet voor
      docs.push({
        folder: f.name || "",
        name: it.name || "",
        webUrl: it.webUrl || "",
        lastModified: it.lastModifiedDateTime || "",
        sizeBytes: it.size ?? null,
      });
    }
  }
  return docs;
}
