/**
 * Landing page ("/").
 *
 * Statically prerendered: buildLandingData() runs the real engine on the demo
 * dataset during `next build`, so the hero preview and every example on the
 * page are genuine engine output, and the page ships as plain HTML plus a
 * small client bundle (no engine, no ECharts).
 */
import { buildLandingData } from "@/ui/landing/preview-data";
import {
  ClosingCta,
  Faq,
  Features,
  Hero,
  HowItWorks,
  Industries,
  Privacy,
  Samples,
} from "@/ui/landing/sections";
import { SiteFooter } from "@/ui/site/SiteFooter";
import { SiteHeader } from "@/ui/site/SiteHeader";

export const dynamic = "force-static";

export default function LandingPage() {
  const data = buildLandingData();
  return (
    <>
      <SiteHeader />
      <main id="main">
        <Hero data={data} />
        <HowItWorks data={data} />
        <Features data={data} />
        <Industries data={data} />
        <Privacy />
        <Samples data={data} />
        <Faq />
        <ClosingCta />
      </main>
      <SiteFooter />
    </>
  );
}
