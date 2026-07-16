// Access gate for the CFO cockpit. Financial statements are sensitive, so /cfo is
// restricted to an allowlist (CFO_ALLOWED_EMAILS, comma/semicolon/space-separated).
// When the env var is UNSET the tab is open to any signed-in user — so nothing
// breaks on existing deploys until the allowlist is deliberately configured.

export function cfoAllowed(email: string | null | undefined): boolean {
  const raw = process.env.CFO_ALLOWED_EMAILS?.trim();
  if (!raw) return true; // not configured → open
  if (!email) return false;
  const list = raw.split(/[,;\s]+/).map((s) => s.toLowerCase()).filter(Boolean);
  return list.includes(email.toLowerCase());
}
