// RFC 9728 protected-resource-metadata. Bereikbaar als
// /.well-known/oauth-protected-resource[/api/mcp] via rewrites in
// next.config.ts; het pad zit in de Authelia-bypass van ingress it-finance-mcp.
import { ORIGIN, RESOURCE, jsonResp } from "@/lib/mcp-oauth";

export const dynamic = "force-dynamic";

export async function GET() {
  return jsonResp({
    // Moet exact overeenkomen met de URL zoals die in claude.ai wordt ingevuld.
    resource: RESOURCE,
    authorization_servers: [ORIGIN],
    bearer_methods_supported: ["header"],
    scopes_supported: ["mcp"],
  });
}
