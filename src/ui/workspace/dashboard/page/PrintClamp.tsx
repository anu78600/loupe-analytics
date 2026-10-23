"use client";

/**
 * Text kept to a number of lines with an ellipsis, for the one-page
 * download. When the page is turned into a picture (html-to-image), CSS
 * line-clamp still cuts the text but draws no ellipsis, so a takeaway or an
 * insight ended mid-sentence with nothing to say it went on. Here the words
 * that don't fit are dropped before the picture is taken and "…" is added,
 * measured in the page's own font and width; the whole text stays in the
 * element's title. The live page uses ClampText (ui/primitives/reveal.tsx),
 * which opens the rest on hover, focus or a long press.
 */
import * as React from "react";

export function PrintClamp({ text, lines, className }: { text: string; lines: number; className?: string }) {
  const ref = React.useRef<HTMLParagraphElement>(null);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // The page is drawn once, so the text is set on the element itself rather than through state.
    el.textContent = text;
    const limit = parseFloat(getComputedStyle(el).lineHeight) * lines + 1;
    if (!(limit > 0) || el.scrollHeight <= limit) return;
    const words = text.split(/\s+/);
    // The most words that fit with the ellipsis, found by halving.
    let lo = 1;
    let hi = words.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      el.textContent = `${words.slice(0, mid).join(" ")}…`;
      if (el.scrollHeight <= limit) lo = mid;
      else hi = mid - 1;
    }
    el.textContent = `${words
      .slice(0, lo)
      .join(" ")
      .replace(/[\s,;:–—-]+$/, "")}…`;
  }, [text, lines]);
  return (
    <p ref={ref} className={className} title={text}>
      {text}
    </p>
  );
}
