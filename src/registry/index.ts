/**
 * Domain registry: JSON files validated with Zod plus a reference check
 * (fields, classes, KPI refs and chart measures must all resolve).
 * To add an industry, drop a JSON file in ./domains and list it below.
 *
 * Loading never throws. A file that fails the schema is skipped; one with
 * reference problems is still loaded. Both are only logged to the console,
 * so check it (and run tests/registry.test.ts) after adding a domain.
 */
import { domainSchema, type DomainDef } from "./schema";
import { validateDomainRefs } from "./validate";
import ecommerce from "./domains/ecommerce.json";
import sales from "./domains/sales.json";
import marketing from "./domains/marketing.json";
import saas from "./domains/saas.json";
import finance from "./domains/finance.json";
import hr from "./domains/hr.json";
import healthcare from "./domains/healthcare.json";
import logistics from "./domains/logistics.json";
import manufacturing from "./domains/manufacturing.json";
import banking from "./domains/banking.json";
import education from "./domains/education.json";
import realEstate from "./domains/real_estate.json";
import hospitality from "./domains/hospitality.json";
import telecom from "./domains/telecom.json";
import insurance from "./domains/insurance.json";
import support from "./domains/support.json";

const RAW: unknown[] = [
  ecommerce,
  sales,
  marketing,
  saas,
  finance,
  hr,
  healthcare,
  logistics,
  manufacturing,
  banking,
  education,
  realEstate,
  hospitality,
  telecom,
  insurance,
  support,
];

function load(): DomainDef[] {
  const out: DomainDef[] = [];
  for (const raw of RAW) {
    const parsed = domainSchema.safeParse(raw);
    if (!parsed.success) {
      const id = (raw as { id?: string }).id ?? "unknown";
      // A broken registry entry must never take the app down; it is skipped and reported.
      console.error(`[registry] domain "${id}" failed validation`, parsed.error.issues.slice(0, 5));
      continue;
    }
    const problems = validateDomainRefs(parsed.data);
    if (problems.length)
      console.error(`[registry] domain "${parsed.data.id}" has reference problems`, problems.slice(0, 10));
    out.push(parsed.data);
  }
  return out;
}

/** Every domain that passed the schema, in the order listed above; parsed once at module load. */
export const DOMAINS: readonly DomainDef[] = load();

export const DOMAIN_BY_ID: ReadonlyMap<string, DomainDef> = new Map(DOMAINS.map((d) => [d.id, d]));

export function getDomain(id: string): DomainDef | undefined {
  return DOMAIN_BY_ID.get(id);
}

export { validateDomainRefs };
export type {
  DomainDef,
  KpiDef,
  ChartTemplate,
  FieldDef,
  SubDomainDef,
  ValueClassDef,
  KpiFormat,
} from "./schema";
