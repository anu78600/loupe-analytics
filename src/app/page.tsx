/**
 * Landing page ("/").
 *
 * Statically prerendered: buildLandingData() runs the real engine on the demo
 * dataset during `next build`, so the hero preview and every example on the
 * page are genuine engine output, and the page ships as plain HTML plus a
 * small client bundle (no engine, no ECharts). The motion is Framer Motion
 * and CSS; a <noscript> rule shows everything that would have animated in.
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

/** Without JavaScript, everything that would animate into view is simply shown. */
const NO_SCRIPT_CSS =
  "[data-reveal],[data-reveal] *{opacity:1!important;transform:none!important;filter:none!important}";

export default function LandingPage() {
  const data = buildLandingData();
  return (
    <>
      <noscript>
        <style>{NO_SCRIPT_CSS}</style>
      </noscript>
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
