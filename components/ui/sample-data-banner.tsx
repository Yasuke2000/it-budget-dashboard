import { AlertCircle } from "lucide-react";

// Shown on a live deployment when a data source fell back to demo/sample data
// (e.g. Microsoft Graph returned 401/403, or HR credentials are missing) so we
// never present sample numbers as if they were real.
export function SampleDataBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3">
      <AlertCircle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
      <p className="text-sm text-warning">{message}</p>
    </div>
  );
}
