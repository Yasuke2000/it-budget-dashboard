import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";

// Build the issuer URL from the tenant ID env var if provided.
// AUTH_MICROSOFT_ENTRA_ID_ISSUER can also be set directly.
// Falls back to "common" (any M365 org) when no tenant is specified.
const entraIssuer =
  process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER ??
  (process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID
    ? `https://login.microsoftonline.com/${process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID}/v2.0/`
    : undefined);

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    ...(process.env.AUTH_MICROSOFT_ENTRA_ID_ID
      ? [
          MicrosoftEntraID({
            clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
            clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET!,
            ...(entraIssuer ? { issuer: entraIssuer } : {}),
          }),
        ]
      : []),
  ],
  pages: {
    signIn: "/auth/signin",
  },
  callbacks: {
    authorized: async ({ auth: session }) => {
      // If no providers configured (demo mode), allow all
      if (!process.env.AUTH_MICROSOFT_ENTRA_ID_ID) return true;
      // Otherwise require sign-in
      return !!session;
    },
  },
});
