"use client";

// Catches errors thrown anywhere in the root layout/render. Without this a
// client-side error freezes the page on its server HTML (e.g. stuck "Loading…"
// with dead buttons). This surfaces the real message so it can be acted on.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ background: "#020617", color: "#e2e8f0", fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
        <div style={{ maxWidth: 720, margin: "3rem auto" }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "#fff" }}>Something went wrong</h1>
          <p style={{ color: "#94a3b8", marginTop: 8 }}>
            A client-side error stopped the app from loading. Details:
          </p>
          <pre style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, padding: 16, marginTop: 12, whiteSpace: "pre-wrap", color: "#fca5a5", fontSize: 13 }}>
            {String(error?.message || error)}{error?.digest ? `\n\ndigest: ${error.digest}` : ""}
          </pre>
          <button
            onClick={() => reset()}
            style={{ marginTop: 16, background: "#0d9488", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 14, cursor: "pointer" }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
