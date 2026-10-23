/**
 * The picture a shared link shows (og:image, and Twitter's card through
 * Next's fallback) for every page: the Loupe wordmark, the headline and three
 * plain facts on the dark theme, set like the landing page: the headline in
 * Inter SemiBold (the display voice), the facts in Inter. Drawn when the
 * site is built, from the brand files, the fonts and the colour tokens on disk
 * (brand-art.ts); its one number, the industries, is counted from the
 * registry.
 */
import { ImageResponse } from "next/og";
import { DOMAINS } from "@/registry";
import { brandFont, brandImage, darkColours } from "./brand-art";

export const alt = "Loupe: analyst-grade dashboards, with the working shown. Runs entirely in your browser.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  const c = darkColours();
  const facts = [
    "KPIs with their SQL and DAX",
    `${DOMAINS.length} industries built in`,
    "Runs in your browser",
  ];
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "68px 80px",
        backgroundColor: c("bg"),
        backgroundImage: `radial-gradient(circle at 88% 6%, ${c("accent-soft")}, transparent 58%)`,
        color: c("fg"),
        fontFamily: "Inter",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- an image renderer, not a page */}
      <img src={brandImage("loupe-wordmark-dark.svg")} width={285} height={78} alt="" />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          fontFamily: "Inter",
          fontWeight: 600,
          fontSize: 80,
          lineHeight: 1.04,
          letterSpacing: "-0.034em",
        }}
      >
        <span>Analyst-grade dashboards,</span>
        <span style={{ color: c("accent") }}>with the working shown.</span>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 22,
          fontSize: 27,
          color: c("fg-muted"),
          borderTop: `1px solid ${c("border-strong")}`,
          paddingTop: 30,
        }}
      >
        {facts.map((fact, i) => (
          <div key={fact} style={{ display: "flex", alignItems: "center", gap: 22 }}>
            {i ? (
              <div style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c("accent") }} />
            ) : null}
            <span>{fact}</span>
          </div>
        ))}
      </div>
    </div>,
    {
      ...size,
      fonts: [
        { name: "Inter", data: brandFont("Inter-Regular.ttf"), weight: 400, style: "normal" },
        { name: "Inter", data: brandFont("Inter-SemiBold.ttf"), weight: 600, style: "normal" },
      ],
    },
  );
}
