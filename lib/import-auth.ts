import { authorizeOperator } from "./api-auth";

// Autorisatie voor de self-hosted /api/import/*-endpoints. Deze staan buiten de
// auth-middleware zodat ze twee aanroepers kunnen bedienen:
//   • automatische jobs (cron / SFTP-drop) met `Authorization: Bearer <SYNC_CRON_SECRET>`;
//   • handmatige uploads vanaf de Import-pagina door een ingelogde gebruiker.
// Sinds 05/08/2026 gaat dat via de gedeelde helper `authorizeOperator`, die óók
// Authelia's Remote-User erkent — in de homelab-opstelling is er geen NextAuth-
// sessie, waardoor handmatige uploads voordien alleen met het cron-secret lukten.
export async function authorizeImport(request: Request): Promise<boolean> {
  const who = await authorizeOperator(request);
  return who.ok;
}
