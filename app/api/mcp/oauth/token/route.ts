// OAuth token-endpoint. Ruilt een door /oauth/authorize getekende code in voor
// het bestaande MCP_TOKEN als access token. Vereisten uit de claude.ai-docs:
// Content-Type application/x-www-form-urlencoded, antwoord < 10s, RFC 6749-
// foutcodes (invalid_grant). PKCE S256 is verplicht en wordt hier afgedwongen.
import { jsonResp, verifieerCode } from "@/lib/mcp-oauth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonResp({ error: "invalid_request" }, 400);
  }
  const g = (k: string) => String(form.get(k) || "");
  if (g("grant_type") !== "authorization_code") {
    return jsonResp({ error: "unsupported_grant_type" }, 400);
  }
  const secret = process.env.MCP_TOKEN;
  if (!secret) {
    console.log("[oauth] token: MCP_TOKEN ontbreekt in omgeving");
    return jsonResp({ error: "server_error" }, 500);
  }
  if (!verifieerCode(g("code"), g("code_verifier"), g("redirect_uri"), secret)) {
    console.log(`[oauth] token geweigerd (invalid_grant) client_id=${g("client_id").slice(0, 40)}`);
    return jsonResp({ error: "invalid_grant" }, 400);
  }
  console.log(`[oauth] token uitgegeven client_id=${g("client_id").slice(0, 40)}`);
  // Geen refresh token: het token verloopt praktisch nooit; bij een onverhoopte
  // 401 doorloopt claude.ai de (korte) OAuth-flow gewoon opnieuw.
  return jsonResp({ access_token: secret, token_type: "Bearer", expires_in: 31_536_000, scope: "mcp" });
}
