export { auth as middleware } from "@/lib/auth";

export const config = {
  matcher: [
    // Protect all pages except auth routes, API auth routes, and static files
    "/((?!api/auth|auth|_next/static|_next/image|favicon.ico).*)",
  ],
};
