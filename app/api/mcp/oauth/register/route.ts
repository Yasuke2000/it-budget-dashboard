// RFC 7591 dynamic client registration. claude.ai registreert bij elke verse
// verbinding een nieuwe (publieke) client; wij bewaren niets — het client_id is
// puur cosmetisch, de echte controle zit in de redirect-allowlist + Authelia op
// /oauth/authorize + PKCE op het token-endpoint.
import { jsonResp, nieuwClientId, redirectUriToegestaan, corsPreflight } from "@/lib/mcp-oauth";

export const dynamic = "force-dynamic";

export async function OPTIONS() { return corsPreflight(); }

export async function POST(req: Request) {
  console.log(`[oauth] register-request ua="${(req.headers.get("user-agent") || "?").slice(0, 80)}" origin="${req.headers.get("origin") || "-"}"`);
  let body: { redirect_uris?: unknown; client_name?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonResp({ error: "invalid_client_metadata" }, 400);
  }
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : [];
  if (!uris.length || !uris.every(redirectUriToegestaan)) {
    console.log(`[oauth] register geweigerd: redirect_uris=${JSON.stringify(uris).slice(0, 200)}`);
    return jsonResp({ error: "invalid_redirect_uri" }, 400);
  }
  const clientId = nieuwClientId();
  console.log(`[oauth] register ok client_id=${clientId} naam="${String(body.client_name || "?").slice(0, 60)}"`);
  return jsonResp(
    {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: uris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
    },
    201,
  );
}
