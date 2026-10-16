/**
 * Landing page ("/").
 *
 * Statically prerendered: buildLandingData() runs the real engine on the demo
 * dataset during `next build`, so the hero preview and every example on the
 * page are genuine engine output, and the page ships as plain HTML plus a
 * small client bundle (no engine, no ECharts). The motion is Framer Motion
 * and CSS; a <noscript> rule shows everything that would have animated in,
 * and PauseOffscreen holds the CSS loops still while they are off screen.
 */
import { PauseOffscreen } from "@/ui/landing/motion";
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
import { CreditBar } from "@/ui/site/CreditBar";
import { SiteHeader } from "@/ui/site/SiteHeader";

export const dynamic = "force-static";

/**
 * Without JavaScript, everything that would animate into view is simply shown. Framer Motion
 * serves those elements with their starting opacity, offset and blur as inline styles, so only
 * inline styles are undone: a decorative glow keeps its own softness.
 */
const NO_SCRIPT_CSS = [
  '[data-reveal],[data-reveal] [style*="opacity"]{opacity:1!important}',
  '[data-reveal],[data-reveal] [style*="transform"]{transform:none!important}',
  '[data-reveal],[data-reveal] [style*="filter"]{filter:none!important}',
].join("");

export default function LandingPage() {
  const data = buildLandingData();
  return (
    <>
      <noscript>
        <style>{NO_SCRIPT_CSS}</style>
      </noscript>
      <CreditBar />
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
      <PauseOffscreen />
    </>
  );
}
