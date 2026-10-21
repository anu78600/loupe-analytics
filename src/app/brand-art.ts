/**
 * What the generated images share (opengraph-image.tsx, apple-icon.tsx): the
 * dark theme's colours, read from styles/theme-dark.css with its aliases
 * resolved through styles/primitives.css, and the Loupe mark, wordmark and the
 * type system's fonts (Inter, Instrument Serif) from public/, so the images
 * always match the app.
 * Everything is read from disk when the image is built; nothing is fetched.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Every path below names its folder literally, so the build traces only those folders (a path
// built from a variable makes the bundler include the whole project in the server output).

/**
 * The dark theme's tokens, looked up by name without the leading dashes, with
 * every var() alias resolved to its value (the semantic tokens point at the
 * --base-* primitives). "rgb(r g b / a)" is rewritten as "rgba(r, g, b, a)",
 * the form the image renderer reads. A missing token fails the build rather
 * than drawing invisible text.
 */
export function darkColours(): (name: string) => string {
  const colours = parseTokens();
  return (name) => {
    const value = colours[name];
    if (!value) throw new Error(`Colour token --${name} is missing from styles/theme-dark.css`);
    return value;
  };
}

/** A stylesheet from src/styles without its comments (they quote values, such as "16.8:1 (Lc 96.6)"). */
function readStyles(file: string): string {
  return readFileSync(join(process.cwd(), "src", "styles", file))
    .toString("utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

/** The custom properties declared in a block of CSS, by name, values on one line. */
function declarations(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [, name, value] of css.matchAll(/--([\w-]+):\s*([^;]+);/g))
    if (name && value) out[name] = value.replace(/\s+/g, " ").trim();
  return out;
}

function parseTokens(): Record<string, string> {
  const primitives = declarations(readStyles("primitives.css"));
  // theme-dark.css is one rule: the dark theme, which is also the default.
  const dark = readStyles("theme-dark.css");
  const start = dark.indexOf("{");
  const tokens = { ...primitives, ...declarations(dark.slice(start + 1, dark.lastIndexOf("}"))) };
  const resolve = (value: string, depth = 0): string =>
    depth > 8
      ? value
      : value.replace(/var\(--([\w-]+)\)/g, (whole, name: string) =>
          tokens[name] ? resolve(tokens[name], depth + 1) : whole,
        );
  const colours: Record<string, string> = {};
  for (const [name, value] of Object.entries(tokens)) {
    const resolved = resolve(value);
    // An alias that points nowhere is left out, so darkColours() reports it as missing.
    if (resolved.includes("var(")) continue;
    colours[name] = resolved.replace(
      /^rgb\((\d+)\s+(\d+)\s+(\d+)\s*\/\s*([\d.]+)\)$/,
      "rgba($1, $2, $3, $4)",
    );
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
