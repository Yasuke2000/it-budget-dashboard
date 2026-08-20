import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    // OAuth-discovery voor de claude.ai MCP-connector (RFC 9728/8414): de
    // /.well-known-paden zijn door de spec vastgelegd, maar App Router-routes
    // kunnen niet in een dot-map wonen — dus herschrijven naar /api/oauth/*.
    // De pad-suffixvariant (…/oauth-protected-resource/api/mcp) hoort erbij.
    return [
      { source: "/.well-known/oauth-protected-resource", destination: "/api/oauth/prm" },
      { source: "/.well-known/oauth-protected-resource/:path*", destination: "/api/oauth/prm" },
      { source: "/.well-known/oauth-authorization-server", destination: "/api/oauth/asm" },
      { source: "/.well-known/oauth-authorization-server/:path*", destination: "/api/oauth/asm" },
    ];
  },
  async headers() {
    return [
      {
        // Defense-in-depth headers (independent of Cloudflare). No strict CSP
        // here — it would need careful testing against Recharts/Next inline
        // styles; these headers are safe and high-value on their own.
        source: "/:path*",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
