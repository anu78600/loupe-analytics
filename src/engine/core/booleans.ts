/**
 * Yes/no columns as they leave Loupe.
 *
 * Inside the engine a yes/no column is stored as 1/0 (BooleanColumn), with
 * the file's own spelling of each value kept as `trueLabel`/`falseLabel`.
 * Exports must give the user back their data as they wrote it: a file that
 * says "Yes"/"No" must not come out as TRUE/FALSE. So:
 *
 * - When the file spelled the values TRUE/FALSE (any case), the column stays
 *   a true/false column everywhere: BOOLEAN in SQL, boolean in Power BI.
 * - When it used words or codes (Yes/No, Y/N, 1/0…), every export keeps them
 *   as text: the CSV writes the labels, the SQL table and the Power BI model
 *   declare text, and the SQL and DAX conditions compare with the labels
 *   (`"Return_Flag" = 'Yes'`), so they run on the user's own table too. That
 *   includes yes/no words in other languages (Sim/Não, Oui/Non) and the
 *   TRUE/FALSE a localised Excel writes (VERDADERO/FALSO, VRAI/FAUX), which
 *   parse/values.yesNoPairOf reads: they are the user's words, not TRUE/FALSE.
 *
 * Everything that writes or describes a column for export asks these two
 * helpers, so the data, the schema and the formulas always agree.
 */
import type { BooleanColumn, Column, StorageType } from "./types";

/** The column's own spellings when they aren't TRUE/FALSE ("Yes"/"No"); null when they are. */
export function wordLabels(col: BooleanColumn): { true: string; false: string } | null {
  const plain = col.trueLabel.toLowerCase() === "true" && col.falseLabel.toLowerCase() === "false";
  return plain ? null : { true: col.trueLabel, false: col.falseLabel };
}

/** How a column is typed in exports: a yes/no column spelled with words is text. */
export function exportKind(col: Column): StorageType {
  return col.kind === "boolean" && wordLabels(col) ? "string" : col.kind;
}
