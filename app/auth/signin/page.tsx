import { auth, signIn } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Building2 } from "lucide-react";

export default async function SignInPage() {
  const session = await auth();
  if (session) redirect("/");

  const isAuthConfigured = !!process.env.AUTH_MICROSOFT_ENTRA_ID_ID;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="bg-card border border-border rounded-2xl p-8 w-full max-w-md text-center space-y-6 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_24px_60px_-32px_rgba(0,0,0,0.4)]">
        <div className="space-y-2">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/25 to-gold/15 ring-1 ring-primary/30">
            <Building2 className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">IT Finance Dashboard</h1>
          <p className="text-muted-foreground text-sm">
            Budget management &amp; cost analysis
          </p>
        </div>

        {isAuthConfigured ? (
          <form
            action={async () => {
              "use server";
              await signIn("microsoft-entra-id", { redirectTo: "/" });
            }}
          >
            <button
              type="submit"
              className="w-full flex items-center justify-center gap-3 bg-[#0078d4] hover:bg-[#106ebe] text-white font-medium py-3 px-4 rounded-lg transition-colors"
            >
              <svg className="h-5 w-5" viewBox="0 0 21 21" fill="none">
                <rect x="1" y="1" width="9" height="9" fill="#f25022" />
                <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
                <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
                <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
              </svg>
              Sign in with Microsoft
            </button>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="bg-warning/10 border border-warning/20 rounded-lg p-4">
              <p className="text-warning text-sm font-medium">Demo Mode</p>
              <p className="text-muted-foreground text-xs mt-1">
                Authentication is not configured. Set AUTH_MICROSOFT_ENTRA_ID_ID
                and AUTH_MICROSOFT_ENTRA_ID_SECRET to enable Entra ID sign-in.
              </p>
            </div>
            <Link
              href="/"
              className="inline-block w-full bg-primary hover:bg-primary/90 text-primary-foreground font-medium py-3 px-4 rounded-lg transition-colors"
            >
              Continue to Dashboard
            </Link>
          </div>
        )}

        <p className="text-muted-foreground/70 text-xs">
          Sign in with your organization&apos;s Microsoft account
        </p>
      </div>
    </div>
  );
}
