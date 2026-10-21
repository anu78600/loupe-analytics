/**
 * Size limits for reading a file in the browser, in a module of their own
 * (no parser imports) so the upload screen can quote them without pulling
 * the CSV parser into the page bundle. csv.ts asks the user how to continue
 * above them (large-file mode); see LargeFileAssessment.
 */

/** Rows above which the user is asked how to proceed instead of loading everything. */
export const LARGE_ROW_LIMIT = 2_100_000;
/** File size above which the user is asked too, whatever the row estimate. */
export const LARGE_BYTE_LIMIT = 700 * 1024 * 1024;
/** Rows the "first rows" option of large-file mode keeps, and about what the recommended sample keeps. */
export const FIRST_ROWS_LIMIT = 1_000_000;
/**
 * Sheets with data a workbook may have and still be read as one joined model
 * (parse/relate.ts); every sheet is parsed to find the keys, so a workbook
 * with more goes straight to the sheet picker.
 */
export const MAX_MODEL_SHEETS = 12;
