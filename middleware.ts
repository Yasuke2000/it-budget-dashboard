export { auth as middleware } from "@/lib/auth";

export const config = {
  matcher: [
    // Protect all pages except auth routes, the self-authorizing import API
    // (it checks the cron secret / session itself), the MCP-endpoint (eigen
    // bearer-token-check, voor Claude Desktop van de CFO — 18/08/2026), and
    // static files.
    "/((?!api/auth|api/import|api/mcp|auth|_next/static|_next/image|favicon.ico).*)",
  ],
};
