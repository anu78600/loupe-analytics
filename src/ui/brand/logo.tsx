/**
 * Brand mark and wordmark as inline SVG. Colours come from currentColor and
 * the --accent token, so the logo follows the active theme with no image
 * assets.
 */
import { cn } from "@/lib/utils";

/**
 * The Loupe mark: a lens rim (neutral ring), a brass measurement arc that reads
 * as both light catching the rim and an instrument gauge, and the focal point.
 * On its own it is a labelled image (`title`); `decorative` hides it from
 * assistive technology where visible text already names it (the Wordmark).
 */
export function LoupeMark({
  className,
  title = "Loupe",
  decorative = false,
}: {
  className?: string;
  title?: string;
  decorative?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : title}
      aria-hidden={decorative ? true : undefined}
      className={cn("size-7", className)}
    >
      <circle cx="16" cy="16" r="12" stroke="currentColor" strokeOpacity="0.24" strokeWidth="1.6" />
      <path d="M16 4a12 12 0 1 1-11.32 8" stroke="var(--accent)" strokeWidth="1.9" strokeLinecap="round" />
      <circle cx="16" cy="16" r="3.4" fill="var(--accent)" />
      <circle cx="21.6" cy="10.4" r="1.15" fill="currentColor" fillOpacity="0.55" />
    </svg>
  );
}

/**
 * Mark plus the "Loupe" name in the display face, at three matched sizes. The
 * name is the accessible text, so the mark beside it is decorative and screen
 * readers hear "Loupe" once.
 */
export function Wordmark({ className, size = "md" }: { className?: string; size?: "sm" | "md" | "lg" }) {
  const text = size === "lg" ? "text-[34px]" : size === "sm" ? "text-[21px]" : "text-[25px]";
  const mark = size === "lg" ? "size-9" : size === "sm" ? "size-6" : "size-7";
  return (
    <span className={cn("inline-flex items-center gap-2 text-fg", className)}>
      <LoupeMark className={mark} decorative />
      <span className={cn("font-display leading-none tracking-[-0.02em]", text)}>Loupe</span>
    </span>
  );
}
