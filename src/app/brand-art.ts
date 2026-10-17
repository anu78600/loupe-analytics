/**
 * What the generated images share (opengraph-image.tsx, apple-icon.tsx): the
 * dark theme's colours, read from styles/tokens.css, and the Loupe mark,
 * wordmark and the type system's fonts (Inter, Instrument Serif) from
 * public/, so the images always match the app.
 * Everything is read from disk when the image is built; nothing is fetched.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Every path below names its folder literally, so the build traces only those folders (a path
// built from a variable makes the bundler include the whole project in the server output).

/**
 * The dark theme's tokens (the first block of tokens.css), looked up by name
 * without the leading dashes. "rgb(r g b / a)" is rewritten as
 * "rgba(r, g, b, a)", the form the image renderer reads. A missing token
 * fails the build rather than drawing invisible text.
 */
export function darkColours(): (name: string) => string {
  const colours = parseTokens();
  return (name) => {
    const value = colours[name];
    if (!value) throw new Error(`Colour token --${name} is missing from styles/tokens.css`);
    return value;
  };
}

function parseTokens(): Record<string, string> {
  // Comments go first: one of them quotes "--bg: 16.9 / 7.5 / 5.1".
  const css = readFileSync(join(process.cwd(), "src", "styles", "tokens.css"))
    .toString("utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const start = css.indexOf("{", css.indexOf(":root"));
  const block = css.slice(start + 1, css.indexOf("}", start));
  const colours: Record<string, string> = {};
  for (const [, name, value] of block.matchAll(/--([\w-]+):\s*([^;\n]+);/g)) {
    if (!name || !value) continue;
    colours[name] = value
      .trim()
      .replace(/^rgb\((\d+)\s+(\d+)\s+(\d+)\s*\/\s*([\d.]+)\)$/, "rgba($1, $2, $3, $4)");
  }
  return colours;
}

/** A drawing from public/brand as a data URI, for an <img> in an ImageResponse. */
export function brandImage(name: string): string {
  return `data:image/svg+xml;base64,${readFileSync(join(process.cwd(), "public", "brand", name)).toString("base64")}`;
}

/** A font from public/fonts (TrueType: the image renderer reads no WOFF2; the PDF exports embed the Inter files too). */
export function brandFont(name: string): Buffer {
  return readFileSync(join(process.cwd(), "public", "fonts", name));
}
