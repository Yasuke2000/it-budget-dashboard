import { auth, signIn } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Building2 } from "lucide-react";

export default async function SignInPage() {
  const session = await auth();
  if (session) redirect("/");

  const isAuthConfigured = !!process.env.AUTH_MICROSOFT_ENTRA_ID_ID;

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 w-full max-w-md text-center space-y-6">
        <div className="space-y-2">
          <Building2 className="h-12 w-12 text-teal-400 mx-auto" />
          <h1 className="text-2xl font-bold text-white">IT Finance Dashboard</h1>
          <p className="text-slate-400 text-sm">
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
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
              <p className="text-amber-400 text-sm font-medium">Demo Mode</p>
              <p className="text-slate-400 text-xs mt-1">
                Authentication is not configured. Set AUTH_MICROSOFT_ENTRA_ID_ID
                and AUTH_MICROSOFT_ENTRA_ID_SECRET to enable Entra ID sign-in.
              </p>
            </div>
            <a
              href="/"
              className="inline-block w-full bg-teal-600 hover:bg-teal-500 text-white font-medium py-3 px-4 rounded-lg transition-colors"
            >
              Continue to Dashboard
            </a>
          </div>
        )}

        <p className="text-slate-600 text-xs">
          Sign in with your organization&apos;s Microsoft account
        </p>
      </div>
    </div>
  );
}
