// Autorisatie voor endpoints die zowel door een MENS in de browser als door een
// automatische job aangeroepen worden (sync, import, …).
//
// Drie geldige bewijzen van identiteit, in deze volgorde:
//   1. `Authorization: Bearer <SYNC_CRON_SECRET>` — cron/SFTP-jobs.
//   2. Een actieve NextAuth-sessie — als NextAuth geconfigureerd is.
//   3. Authelia's forward-auth-headers (`Remote-User`) — de homelab-opstelling.
//      De Traefik-middleware in `apps/authelia/manifests/middleware.yaml` zet
//      Remote-User/Remote-Groups/Remote-Email uit het auth-antwoord en OVERSCHRIJFT
//      daarbij wat de client meestuurde, dus via de ingress is de header niet te
//      spoofen. Wie rechtstreeks bij de pod kan (in-cluster) zou hem wél kunnen
//      zetten — daarom mag dit bewijs alleen gebruikt worden voor acties die niets
//      onherstelbaars doen. `/api/sync` verwarmt enkel caches; dat is aanvaardbaar.
//      Gebruik dit NOOIT voor het lezen of muteren van secrets.
//
// Zonder enige configuratie (geen cron-secret, geen NextAuth, geen Authelia) blijft
// het endpoint open — dat is de lokale ontwikkelmodus.

import { auth } from "./auth";

export interface OperatorIdentity {
  ok: boolean;
  /** Hoe de aanroeper zich bewees — gaat mee in de logging, niet naar de client. */
  via: "cron-secret" | "session" | "authelia" | "unprotected";
  /** E-mail of gebruikersnaam waar bekend; leeg voor cron. */
  user: string;
}

export async function authorizeOperator(request: Request): Promise<OperatorIdentity> {
  const secret = process.env.SYNC_CRON_SECRET;
  const header = request.headers.get("authorization");
  if (secret && header === `Bearer ${secret}`) {
    return { ok: true, via: "cron-secret", user: "" };
  }

  // Ingelogde gebruiker via NextAuth (Entra ID).
  const session = await auth().catch(() => null);
  if (session?.user) {
    return { ok: true, via: "session", user: session.user.email ?? "" };
  }

  // Ingelogde gebruiker via Authelia (homelab): de ingress zet deze headers.
  const remoteUser = request.headers.get("remote-user");
  if (remoteUser) {
    return { ok: true, via: "authelia", user: request.headers.get("remote-email") || remoteUser };
  }

  // Niets geconfigureerd → lokale ontwikkeling, endpoint open.
  if (!secret && !process.env.AUTH_MICROSOFT_ENTRA_ID_ID) {
    return { ok: true, via: "unprotected", user: "" };
  }

  return { ok: false, via: "unprotected", user: "" };
}
