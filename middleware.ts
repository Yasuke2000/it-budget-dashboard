export { auth as middleware } from "@/lib/auth";

export const config = {
  matcher: [
    // Protect all pages except auth routes, the self-authorizing import API
    // (it checks the cron secret / session itself), and static files.
    "/((?!api/auth|api/import|auth|_next/static|_next/image|favicon.ico).*)",
  ],
};
