import { auth } from "./auth";

// Shared authorization for the self-hosted /api/import/* endpoints.
// These are excluded from the auth middleware so they can serve two callers:
//   • Automated jobs (cron / SFTP-drop) pass `Authorization: Bearer <SYNC_CRON_SECRET>`.
//   • Manual uploads from the Import page rely on the signed-in session.
// When app auth is disabled (internal/homelab demo) the endpoints are open.
export async function authorizeImport(request: Request): Promise<boolean> {
  const secret = process.env.SYNC_CRON_SECRET;
  const header = request.headers.get("authorization");
  // Automated jobs (cron, SFTP-drop) use a static bearer token.
  if (secret && header === `Bearer ${secret}`) return true;
  // Manual browser uploads require an active session.
  // In homelab mode (Authelia gating, no NextAuth configured) this always
  // returns null — import API is then only reachable via the cron secret.
  const session = await auth();
  return !!session;
}
