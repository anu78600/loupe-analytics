/**
 * Column kinds as the interface names and corrects them (version 49.0).
 *
 * understandData (understand.ts) reads each column's kind from its profiled
 * role; the Detect step shows the kind as a chip, and its "Read as …" menu
 * sets one. A kind is not stored on its own: the correction is the role
 * override it stands for (roleForKind), sent through the existing
 * ContextRequest.roleOverrides, so the profile, the KPIs, the charts and the
 * exports all follow it. The override also carries the kind itself, so a
 * score and a measurement (both averaged, never summed) read back as the one
 * the user chose; when an older saved override has no kind, understandData
 * reads it from the role and the column's values.
 *
 * The outcome and the time axis are not set here: the outcome has its own
 * select (ContextRequest.outcome), and a column becomes a date only when its
 * values parse as dates.
 */
import type { RoleOverride } from "@/engine/session";
import type { ColumnKind } from "./types";

/** Each kind's name on a chip and in the "Read as …" menu. */
export const KIND_LABEL: Record<ColumnKind, string> = {
  id: "ID",
  time: "Date",
  outcome: "Outcome",
  amount: "Amount",
  measurement: "Measurement",
  rate: "Rate",
  score: "Score",
  category: "Category",
  place: "Place",
  text: "Text",
  flag: "Yes/no",
};

/** The kinds a "Read as …" menu offers, in the order it lists them (outcome and time are set elsewhere). */
export const SETTABLE_KINDS: readonly ColumnKind[] = [
  "id",
  "category",
  "place",
  "amount",
  "measurement",
  "rate",
  "score",
  "flag",
  "text",
];

/**
 * The role override that reads a column as `kind`: an amount is a measure
 * that adds up, a measurement or a score is one that is averaged, never
 * summed, and so on. Null for "outcome" (chosen with the outcome select) and
 * "time" (a column is a date only when its values are dates).
 */
export function roleForKind(kind: ColumnKind): RoleOverride | null {
  switch (kind) {
    case "id":
      return { role: "identifier", kind };
    case "amount":
      return { role: "measure", additivity: "additive", kind };
    case "measurement":
    case "score":
      return { role: "measure", additivity: "non-additive", kind };
    case "rate":
      return { role: "rate", additivity: "non-additive", kind };
    case "category":
      return { role: "dimension", kind };
    case "place":
      return { role: "geo", kind };
    case "text":
      return { role: "text", kind };
    case "flag":
      return { role: "boolean", kind };
    case "outcome":
    case "time":
      return null;
  }
}
