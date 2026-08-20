// RFC 8414 authorization-server-metadata. Bereikbaar als
// /.well-known/oauth-authorization-server via rewrites in next.config.ts.
// token/register staan onder /api/mcp/oauth/* zodat ze in de bestaande
// Authelia-bypass (PathPrefix /api/mcp) vallen — Anthropic roept ze
// server-naar-server aan. /oauth/authorize valt er bewust BUITEN: browser-
// verkeer, dus Authelia-login vereist.
import { ORIGIN, jsonResp } from "@/lib/mcp-oauth";

export const dynamic = "force-dynamic";

export async function GET() {
  return jsonResp({
    issuer: ORIGIN,
    authorization_endpoint: `${ORIGIN}/oauth/authorize`,
    token_endpoint: `${ORIGIN}/api/mcp/oauth/token`,
    registration_endpoint: `${ORIGIN}/api/mcp/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    // Confidential clients eerst (EMAsphere-patroon 20/08); "none" blijft voor
    // public clients zoals de Claude Code-loopback.
    token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic", "none"],
    scopes_supported: ["mcp"],
  });
}
