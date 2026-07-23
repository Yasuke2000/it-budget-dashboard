import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  description?: string;
  /** Small uppercase eyebrow above the title (e.g. a section or entity name). */
  eyebrow?: string;
  /** Right-aligned actions (buttons, toggles, export controls). */
  actions?: React.ReactNode;
  className?: string;
}

/**
 * Consistent page masthead. An emerald accent bar, an optional eyebrow, a
 * tracking-tight title and a muted description — with an actions slot that wraps
 * gracefully on narrow screens.
 */
export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 pb-1 sm:flex-row sm:items-start sm:justify-between",
        className
      )}
    >
      <div className="flex items-start gap-3 min-w-0">
        <span
          aria-hidden
          className="mt-1 h-8 w-1 shrink-0 rounded-full bg-gradient-to-b from-primary to-gold/70"
        />
        <div className="min-w-0">
          {eyebrow && (
            <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary/80">
              {eyebrow}
            </p>
          )}
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          {description && (
            <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
          )}
        </div>
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
