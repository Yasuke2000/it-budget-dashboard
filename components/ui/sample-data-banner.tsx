import { AlertCircle } from "lucide-react";

// Shown on a live deployment when a data source fell back to demo/sample data
// (e.g. Microsoft Graph returned 401/403, or HR credentials are missing) so we
// never present sample numbers as if they were real.
export function SampleDataBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
      <AlertCircle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
      <p className="text-sm text-amber-300">{message}</p>
    </div>
  );
}
