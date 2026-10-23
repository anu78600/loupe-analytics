/**
 * The cell classes Check & map's tables share (the review table and the
 * Fields view's field mapping), so both read as one design: a quiet header
 * on the sunken step of the card (12 px labels, the table-header size), and
 * rows divided by the subtle hairline, the body text at the control size.
 */

/** A header cell. */
export const TH =
  "h-10 border-b border-border bg-surface-2 px-4 text-left align-middle text-xs font-medium whitespace-nowrap text-fg-muted";

/** A body cell. */
export const TD = "border-b border-border-subtle px-4 py-3 align-middle";
