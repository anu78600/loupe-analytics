/**
 * Demo dataset entry point for the engine worker (session.ts): maps a
 * catalogue id to its seeded generator. UI code should import ./catalog
 * instead, which carries the same ids without the generator code. Demo data
 * is realistic but not real, and is labelled as such wherever it appears.
 */
import type { Dataset } from "@/engine/core/types";
import { generateEcommerce } from "./ecommerce";
import { generateFinance, generateHr, generateMarketing, generateSaas, generateSales } from "./small";

export { SAMPLES, type SampleInfo } from "./catalog";

/** Builds the demo dataset for a catalogue id (fixed default seeds); throws for an unknown id. */
export function generateSample(id: string): Dataset {
  switch (id) {
    case "ecommerce":
      return generateEcommerce();
    case "sales":
      return generateSales();
    case "marketing":
      return generateMarketing();
    case "saas":
      return generateSaas();
    case "finance":
      return generateFinance();
    case "hr":
      return generateHr();
    default:
      throw new Error(`Unknown sample "${id}"`);
  }
}
