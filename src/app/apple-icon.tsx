/**
 * The home-screen icon for iPhone and iPad (apple-touch-icon): the Loupe mark
 * on the dark theme's background, square and edge to edge (iOS rounds the
 * corners itself). Drawn when the site is built from public/brand and the
 * colour tokens (brand-art.ts).
 */
import { ImageResponse } from "next/og";
import { brandImage, darkColours } from "./brand-art";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  const c = darkColours();
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: c("bg"),
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- an image renderer, not a page */}
      <img src={brandImage("loupe-mark-dark.svg")} width={128} height={128} alt="" />
    </div>,
    size,
  );
}
