/**
 * The owner's credit and copyright, in one place: shown in the credit bar
 * above the site header, in the site footer and in the page metadata.
 *
 * The copyright year is the year of the latest release in the version log,
 * so it moves forward with the next release instead of being typed in.
 */
export const AUTHOR = "Anupam Mishra";

/** "© 2026 Anupam Mishra. All rights reserved." for a release date such as "2026-10-16T…Z". */
export function copyrightLine(releaseDate: string): string {
  return `© ${releaseDate.slice(0, 4)} ${AUTHOR}. All rights reserved.`;
}
