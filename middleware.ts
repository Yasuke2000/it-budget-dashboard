export { auth as middleware } from "@/lib/auth";

export const config = {
  matcher: [
    // Protect all pages except auth routes, the self-authorizing import API
    // (it checks the cron secret / session itself), the MCP-endpoint (eigen
    // bearer-token-check, voor Claude Desktop van de CFO — 18/08/2026), and
    // static files. Ook uitgesloten (19/08): OAuth-discovery-paden en /register —
    // de claude.ai-connector probet die en moet een schone 404 zien, géén
    // login-redirect (anders denkt hij dat er een sign-in service is en
    // probeert hij zich daar als OAuth-client te registreren → "ofid"-fout).
    "/((?!api/auth|api/import|api/mcp|auth|\\.well-known|register|_next/static|_next/image|favicon.ico).*)",
  ],
};
