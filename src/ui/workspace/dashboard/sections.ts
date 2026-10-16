/**
 * The dashboard's sections, in the order analysts read them: trend →
 * breakdowns → drivers & segments → other columns → detail. The dashboard
 * groups its charts by them, the Customise step lists charts under them, and
 * the presentation slides take their titles and questions from them. Plain
 * data, so the slide plan (slidePlan.ts) and its tests can use it without
 * loading the dashboard.
 */
import type { ChartSection } from "@/engine/charts/types";

/** Dashboard sections in order (also the Customise step's chart groups and the slides' sections). */
export const SECTIONS: Array<{ id: ChartSection; title: string; blurb: string }> = [
  { id: "trend", title: "Trend", blurb: "How the headline numbers move over time." },
  { id: "breakdown", title: "Breakdowns", blurb: "Where the volume comes from." },
  { id: "drivers", title: "Drivers & segments", blurb: "What explains the differences." },
  {
    id: "columns",
    title: "From your other columns",
    blurb: "Columns in your file the template doesn't use, summarised from your data.",
  },
  { id: "detail", title: "Detail", blurb: "The rows behind the totals." },
];
