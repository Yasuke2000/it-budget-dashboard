// OAuth token-endpoint. Ruilt een door /oauth/authorize getekende code in voor
// het bestaande MCP_TOKEN als access token. Vereisten uit de claude.ai-docs:
// Content-Type application/x-www-form-urlencoded, antwoord < 10s, RFC 6749-
// foutcodes (invalid_grant). PKCE S256 is verplicht en wordt hier afgedwongen.
import { jsonResp, verifieerCode, corsPreflight, clientSecretVoor, maakRefreshToken, verifieerRefreshToken, maakAccessToken } from "@/lib/mcp-oauth";

export const dynamic = "force-dynamic";

// Browser-side code-exchange (SPA/PKCE) vereist een CORS-preflight-antwoord.
export async function OPTIONS() { return corsPreflight(); }

export async function POST(req: Request) {
  // Diagnose (connectorprobleem): komt de exchange uit de browser of van de broker?
  console.log(`[oauth] token-request ua="${(req.headers.get("user-agent") || "?").slice(0, 80)}" origin="${req.headers.get("origin") || "-"}"`);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonResp({ error: "invalid_request" }, 400);
  }
  const g = (k: string) => String(form.get(k) || "");
  const secret = process.env.MCP_TOKEN;
  if (!secret) {
    console.log("[oauth] token: MCP_TOKEN ontbreekt in omgeving");
    return jsonResp({ error: "server_error" }, 500);
  }
  // Client-authenticatie (EMAsphere-patroon 20/08): confidential clients sturen
  // hun secret via body (client_secret_post) of Basic-header. Als er een secret
  // meekomt, moet het kloppen; zonder secret blijven public clients (Claude
  // Code-loopback) gewoon werken — de echte bescherming is PKCE + Authelia.
  let clientId = g("client_id");
  let clientSecret = g("client_secret");
  const basic = (req.headers.get("authorization") || "").match(/^Basic\s+(.+)$/i);
  if (basic) {
    try {
      const [bu, bp] = Buffer.from(basic[1], "base64").toString().split(":");
      if (bu) clientId = clientId || decodeURIComponent(bu);
      if (bp) clientSecret = clientSecret || decodeURIComponent(bp);
    } catch { /* kapotte Basic-header → behandelen als afwezig */ }
  }
  if (clientSecret && clientId && clientSecret !== clientSecretVoor(clientId, secret)) {
    console.log(`[oauth] token geweigerd (invalid_client) client_id=${clientId.slice(0, 40)}`);
    return jsonResp({ error: "invalid_client" }, 401);
  }
  const grant = g("grant_type");
  if (grant === "refresh_token") {
    if (!verifieerRefreshToken(g("refresh_token"), secret)) {
      console.log(`[oauth] refresh geweigerd (invalid_grant) client_id=${clientId.slice(0, 40)}`);
      return jsonResp({ error: "invalid_grant" }, 400);
    }
    console.log(`[oauth] token vernieuwd (refresh) client_id=${clientId.slice(0, 40)}`);
    return jsonResp({ access_token: maakAccessToken(secret), token_type: "Bearer", expires_in: 31_536_000, scope: "mcp", refresh_token: maakRefreshToken(clientId, secret) });
  }
  if (grant !== "authorization_code") {
    return jsonResp({ error: "unsupported_grant_type" }, 400);
  }
  if (!verifieerCode(g("code"), g("code_verifier"), g("redirect_uri"), secret)) {
    console.log(`[oauth] token geweigerd (invalid_grant) client_id=${clientId.slice(0, 40)}`);
    return jsonResp({ error: "invalid_grant" }, 400);
  }
  console.log(`[oauth] token uitgegeven client_id=${clientId.slice(0, 40)} auth=${clientSecret ? "secret" : "public"}`);
  return jsonResp({ access_token: maakAccessToken(secret), token_type: "Bearer", expires_in: 31_536_000, scope: "mcp", refresh_token: maakRefreshToken(clientId, secret) });
}
