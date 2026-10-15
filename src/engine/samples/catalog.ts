/**
 * Demo dataset catalogue (metadata only; generators live in the worker bundle).
 *
 * The UI (upload step, command palette) imports this file directly so the
 * generators stay out of the page bundle; the worker builds data through
 * samples/index.ts. Ids must match the cases in generateSample.
 */
export interface SampleInfo {
  /** Key passed to generateSample. */
  id: string;
  name: string;
  description: string;
  /** Registry domain the demo showcases (src/registry/domains). */
  domain: string;
  /** Display text only; not computed from the generator. */
  approxRows: string;
  /** Featured as the main demo on the upload screen. */
  flagship?: boolean;
}

export const SAMPLES: SampleInfo[] = [
  {
    id: "ecommerce",
    name: "D2C e-commerce orders",
    description:
      "Two years of order lines from a multi-category Indian D2C brand: COD and RTO, couriers, coupons, returns.",
    domain: "ecommerce",
    approxRows: "≈49k rows · 28 columns",
    flagship: true,
  },
  {
    id: "sales",
    name: "B2B sales invoices",
    description: "Invoice lines by region, rep, segment and product.",
    domain: "sales",
    approxRows: "≈6k rows",
  },
  {
    id: "marketing",
    name: "Campaign performance",
    description: "Daily spend, clicks and conversions across 12 campaigns.",
    domain: "marketing",
    approxRows: "≈4.4k rows",
  },
  {
    id: "saas",
    name: "SaaS MRR movements",
    description: "Account-month MRR with new, expansion, contraction and churn.",
    domain: "saas",
    approxRows: "≈9k rows",
  },
  {
    id: "finance",
    name: "P&L ledger vs budget",
    description: "Monthly actuals and budget by account and cost center.",
    domain: "finance",
    approxRows: "≈450 rows",
  },
  {
    id: "hr",
    name: "Employee roster",
    description: "Headcount, attrition, salary and engagement by department.",
    domain: "hr",
    approxRows: "≈1.2k rows",
  },
];
