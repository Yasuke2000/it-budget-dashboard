// OAuth authorize-endpoint — het enige browser-facing stuk van de flow.
// Dit pad staat NIET in de ingress-bypass (it-finance-mcp) en zit dus achter
// Authelia: wie hier aankomt, is al ingelogd via SSO. Dat is het consent —
// we geven direct een getekende code terug aan de allowlisted redirect_uri.
import { maakCode, redirectUriToegestaan } from "@/lib/mcp-oauth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const redirectUri = q.get("redirect_uri") || "";
  const state = q.get("state");
  const gebruiker = (req.headers.get("remote-user") || "?").slice(0, 60);

  // Zonder geldige redirect_uri NOOIT redirecten (open-redirectbescherming).
  if (!redirectUriToegestaan(redirectUri)) {
    console.log(`[oauth] authorize geweigerd: redirect_uri="${redirectUri.slice(0, 120)}" user=${gebruiker}`);
    return new Response("redirect_uri niet toegestaan", { status: 400 });
  }
  const fout = (code: string) => {
    const doel = new URL(redirectUri);
    doel.searchParams.set("error", code);
    if (state) doel.searchParams.set("state", state);
    return Response.redirect(doel.toString(), 302);
  };
  if (q.get("response_type") !== "code") return fout("unsupported_response_type");
  const challenge = q.get("code_challenge") || "";
  if (!challenge || q.get("code_challenge_method") !== "S256") return fout("invalid_request");
  const secret = process.env.MCP_TOKEN;
  if (!secret) return new Response("MCP_TOKEN ontbreekt in omgeving", { status: 500 });

  console.log(`[oauth] authorize ok user=${gebruiker} client_id=${(q.get("client_id") || "?").slice(0, 40)}`);
  const doel = new URL(redirectUri);
  doel.searchParams.set("code", maakCode(challenge, redirectUri, secret));
  if (state) doel.searchParams.set("state", state);
  return Response.redirect(doel.toString(), 302);
}
