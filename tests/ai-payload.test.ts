/**
 * Privacy of the opt-in AI payload (Session.aiPayload): a file full of
 * personal data goes through the real pipeline (parse → profile), and the
 * serialised payload must not contain any email, phone number, web address,
 * street address, identifier or person's name verbatim, in the sample rows
 * or the top values, while low-cardinality categories, numbers, dates and
 * aggregates still arrive.
 */
import { describe, expect, it } from "vitest";
import { Session } from "@/engine/session";

const N = 60;
const REPS = ["Priya Sharma", "Arjun Nair", "Meera Iyer", "Kabir Singh", "Divya Reddy"];
const REGIONS = ["North", "South", "East", "West"];
const PLANS = ["Basic", "Pro", "Enterprise"];
// Low-cardinality columns that mix ordinary categories with personal data.
const ESCALATION = [
  "asha.k@example.com",
  "ravi.m@example.org",
  "+91 99887 76655",
  "(555) 123-4567",
  "Email support",
  "Phone support",
];
const REFERRERS = ["Direct", "Newsletter", "https://partner.example.net/ref?id=42"];
const PICKUP = ["Store counter", "Locker", "Flat 4B, Sunrise Apartments"];

const pad = (n: number, w: number) => String(n).padStart(w, "0");
const customerId = (i: number) => `CUST-${1001 + (i === 2 ? 0 : i)}`; // rows 0 and 2 are the same customer
const email = (i: number) => `user${i}.name@mailbox.example.com`;
const phone = (i: number) => `+91 98765 4${pad(i, 4)}`;
const website = (i: number) => `https://site${i}.example.org/profile`;
const address = (i: number) => `${10 + i} MG Road, Indiranagar, Bengaluru 5600${pad(i % 100, 2)}`;
const note = (i: number) => `Asked for a call back about invoice ${i} before the weekend`;
const altMobile = (i: number) => 9123456000 + i;
const signup = (i: number) => new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10);

function csv(): string {
  const header =
    "Customer ID,Email,Phone,Website,Shipping Address,Notes,Escalation,Referrer,Pickup Point,Alt Mobile,Sales Rep,Region,Plan,Amount,Signup Date";
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const rows = Array.from({ length: N }, (_, i) =>
    [
      customerId(i),
      email(i),
      q(phone(i)),
      website(i),
      q(address(i)),
      q(note(i)),
      q(ESCALATION[i % ESCALATION.length] as string),
      q(REFERRERS[i % REFERRERS.length] as string),
      q(PICKUP[i % PICKUP.length] as string),
      altMobile(i),
      REPS[i % REPS.length],
      REGIONS[i % REGIONS.length],
      PLANS[i % PLANS.length],
      100 + i,
      signup(i),
    ].join(","),
  );
  return [header, ...rows].join("\n");
}

interface PayloadColumn {
  name: string;
  values: string;
  distinct: number;
  blankPct: number;
  stats?: { min: number; max: number; mean: number };
  topValues?: string[];
}
interface Payload {
  privacy: string;
  rows: number;
  columns: PayloadColumn[];
  sample: Array<Record<string, string | null>>;
}

describe("AI payload", async () => {
  const session = new Session();
  const load = await session.ingest(new Blob([csv()]), "customers.csv", {});
  if (load.status !== "ok") throw new Error(load.status);
  const payload = session.aiPayload() as unknown as Payload;
  const json = JSON.stringify(payload);
  const column = (name: string) => payload.columns.find((c) => c.name === name) as PayloadColumn;

  it("contains no personal data verbatim", () => {
    const secrets: string[] = [];
    for (let i = 0; i < N; i++) {
      secrets.push(
        customerId(i),
        email(i),
        phone(i),
        phone(i).replace(/\D/g, ""),
        website(i),
        address(i),
        note(i),
      );
      // A number column is shown with digit grouping in the sample, so check both spellings.
      secrets.push(String(altMobile(i)), altMobile(i).toLocaleString("en-US"));
    }
    secrets.push(
      ...REPS,
      ...ESCALATION.slice(0, 4),
      REFERRERS[2] as string,
      PICKUP[2] as string,
      "example.com",
      "Sunrise Apartments",
      "MG Road",
    );
    for (const s of secrets) expect(json, s).not.toContain(s);
  });

  it("keeps low-cardinality categories, numbers, dates and aggregates", () => {
    expect(payload.rows).toBe(N);
    for (const v of [
      ...REGIONS,
      ...PLANS,
      "Email support",
      "Phone support",
      "Direct",
      "Newsletter",
      "Store counter",
      "Locker",
    ])
      expect(json, v).toContain(v);
    expect(column("Region").values).toBe("kept");
    expect(column("Region").distinct).toBe(4);
    expect(column("Region").blankPct).toBe(0);
    expect(column("Referrer").topValues).toEqual(expect.arrayContaining(["Direct", "Newsletter", "«url»"]));
    expect(column("Pickup Point").topValues).toEqual(
      expect.arrayContaining(["Store counter", "Locker", "«address»"]),
    );
    expect(column("Escalation").topValues).toEqual(
      expect.arrayContaining(["«email»", "«phone»", "Email support"]),
    );
    expect(column("Amount").stats).toEqual({ min: 100, max: 100 + N - 1, mean: 100 + (N - 1) / 2 });
    expect(payload.sample[1]?.Amount).toBe("101");
    expect(payload.sample[0]?.["Signup Date"]).toBe("2025-01-01");
    expect(payload.sample.length).toBe(8);
  });

  it("gives identifiers stable pseudonyms and masks free text", () => {
    const ids = payload.sample.map((r) => r["Customer ID"]);
    expect(ids.slice(0, 3)).toEqual(["ID-1", "ID-2", "ID-1"]);
    for (const name of ["Customer ID", "Email", "Phone", "Alt Mobile", "Sales Rep"]) {
      expect(column(name).values, name).toBe("pseudonymised");
      expect(column(name).stats, name).toBeUndefined();
      expect(column(name).topValues, name).toBeUndefined();
    }
    for (const name of ["Website", "Shipping Address", "Notes"])
      expect(column(name).values, name).toBe("masked");
    expect(payload.sample[0]?.Notes).toBe("«text»");
    expect(payload.sample[0]?.Website).toBe("«url»");
    expect(payload.privacy).toMatch(/pseudonyms/);
  });
});
