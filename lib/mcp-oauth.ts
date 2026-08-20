// Minimale stateless OAuth 2.1-laag rond het remote MCP-endpoint (20/08/2026).
// Waarom: claude.ai-web veronderstelt OAuth voor élke custom connector — de
// broker zoekt na initialize discovery-metadata op /.well-known/* en breekt
// zonder die metadata af met "Couldn't reach" (docs:
// claude.com/docs/connectors/building/troubleshooting, §4 "OAuth discovery
// fails"; bevestigd met traefik-logs 20/08). Deze laag geeft claude.ai het
// verwachte oppervlak: metadata, DCR-registratie, authorize en token.
// Ontwerp: /oauth/authorize staat bewust NIET in de ingress-bypass en zit dus
// achter Authelia — de SSO-login ís het consent-scherm. Het uitgegeven access
// token is het bestaande MCP_TOKEN, dus de MCP-route zelf blijft ongewijzigd
// en de capability-URL blijft werken. Autorisatiecodes zijn stateless:
// HMAC-getekend met MCP_TOKEN als sleutel, 10 min geldig, gebonden aan
// PKCE-challenge (S256, verplicht door claude.ai) én redirect_uri.
import { createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const ORIGIN = process.env.MCP_PUBLIC_ORIGIN || "https://itfinance.daviddelporte.com";
export const RESOURCE = `${ORIGIN}/api/mcp`;

// claude.ai/Desktop/mobiel gebruiken exact deze callback (docs: Callback URLs);
// Claude Code gebruikt een loopback-redirect waarvan de poort per sessie
// wisselt — RFC 8252 §7.3 verplicht poort-agnostisch matchen.
export function redirectUriToegestaan(uri: string): boolean {
  if (uri === "https://claude.ai/api/mcp/auth_callback") return true;
  if (uri === "https://claude.com/api/mcp/auth_callback") return true;
  try {
    const u = new URL(uri);
    return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1") && u.pathname === "/callback";
  } catch {
    return false;
  }
}

const b64url = (b: Buffer) => b.toString("base64url");

function hmac(data: string, secret: string): Buffer {
  // Domein-scheiding: nooit het kale MCP_TOKEN als HMAC-sleutel hergebruiken.
  return createHmac("sha256", `mcp-authcode:${secret}`).update(data).digest();
}

export function maakCode(challenge: string, redirectUri: string, secret: string): string {
  const payload = b64url(Buffer.from(JSON.stringify({ c: challenge, r: redirectUri, exp: Date.now() + 600_000 })));
  return `${payload}.${b64url(hmac(payload, secret))}`;
}

export function verifieerCode(code: string, verifier: string, redirectUri: string, secret: string): boolean {
  const [payload, sig] = String(code).split(".");
  if (!payload || !sig) return false;
  const verwacht = hmac(payload, secret);
  const geleverd = Buffer.from(sig, "base64url");
  if (geleverd.length !== verwacht.length || !timingSafeEqual(geleverd, verwacht)) return false;
  let p: { c?: string; r?: string; exp?: number };
  try {
    p = JSON.parse(Buffer.from(payload, "base64url").toString());
  } catch {
    return false;
  }
  if (!p.exp || Date.now() > p.exp) return false;
  if (p.r !== redirectUri) return false;
  return p.c === b64url(createHash("sha256").update(verifier).digest());
}

export function nieuwClientId(): string {
  return `cc-${randomBytes(12).toString("hex")}`;
}

// CORS op de OAuth-endpoints (fix 20/08 avond): als claude.ai de code-exchange
// in de BROWSER doet (standaard SPA/PKCE-patroon), dan bereikt het POST-verzoek
// ons wél (server logt "token uitgegeven") maar mag de browser het antwoord
// zonder Access-Control-Allow-Origin niet LEZEN → "Authorization failed" zonder
// dat er ooit nog een verzoek volgt — exact het waargenomen patroon. "*" is hier
// veilig: geen cookies/credentials, de echte bescherming is PKCE + de
// redirect-allowlist + Authelia op /oauth/authorize.
export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};
export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
export function jsonResp(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS_HEADERS },
  });
}
