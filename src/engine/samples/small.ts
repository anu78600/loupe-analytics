/**
 * Smaller deterministic demo datasets: Sales, HR, Finance, Marketing, SaaS.
 *
 * Each generator has its own fixed default seed, so datasets are independent
 * and reproducible. Dates are wall-clock UTC and every series ends in
 * September 2026, like the e-commerce demo. Realistic but not real data.
 */
import { Rng } from "@/engine/core/random";
import { addMonths, DAY_MS, utc } from "@/engine/core/dates";
import type { Dataset } from "@/engine/core/types";
import { round2, SampleBuilder } from "./builder";

/**
 * B2B invoice lines on weekdays, 1 Jan 2025 – 30 Sep 2026: a quarter-end push
 * (×1.6 after the 18th of Mar/Jun/Sep/Dec), slow growth, and order sizes and
 * discounts by customer segment. "Discount %" holds fractions (0.05) with a
 * percent format; Revenue is net of discount.
 */
export function generateSales(seed = 7): Dataset {
  const rng = new Rng(seed);
  const b = new SampleBuilder();
  const inv = b.string("Invoice No");
  const date = b.date("Invoice Date");
  const region = b.string("Region");
  const rep = b.string("Sales Rep");
  const customer = b.string("Customer");
  const segment = b.string("Customer Segment");
  const product = b.string("Product");
  const category = b.string("Category");
  const qty = b.number("Quantity", { integer: true, decimals: 0 });
  const price = b.number("Unit Price", { currency: "INR", integer: true, decimals: 0 });
  const disc = b.number("Discount %", { percent: true, decimals: 1 });
  const revenue = b.number("Revenue", { currency: "INR" });
  const cost = b.number("Cost", { currency: "INR" });

  // [region, sales reps]
  const REGIONS: Array<[string, string[]]> = [
    ["North", ["Aarav Mehta", "Kabir Singh", "Ishita Rao"]],
    ["South", ["Meera Iyer", "Arjun Nair", "Divya Reddy"]],
    ["East", ["Rohan Das", "Ananya Ghosh"]],
    ["West", ["Vikram Shah", "Neha Joshi", "Siddharth Patil"]],
  ];
  // [product, category, unit price ₹, cost ratio]
  const PRODUCTS: Array<[string, string, number, number]> = [
    ["Office Chair Pro", "Furniture", 8999, 0.55],
    ["Standing Desk", "Furniture", 24999, 0.6],
    ["Filing Cabinet", "Furniture", 6499, 0.58],
    ["Laser Printer", "Electronics", 15999, 0.72],
    ['27" Monitor', "Electronics", 18999, 0.74],
    ["Wireless Keyboard Set", "Electronics", 2499, 0.6],
    ["A4 Paper (Box)", "Supplies", 1299, 0.68],
    ["Toner Cartridge", "Supplies", 3499, 0.5],
    ["Whiteboard", "Supplies", 2999, 0.52],
    ["Conference Phone", "Electronics", 21999, 0.65],
  ];
  // [segment, share of customers, median quantity per line]
  const SEGMENTS: Array<[string, number, number]> = [
    ["Enterprise", 0.2, 6],
    ["SMB", 0.45, 3],
    ["Retail", 0.35, 1.3],
  ];
  const customers = Array.from({ length: 180 }, (_, i) => ({
    name: `${rng.pick(["Apex", "Blue Ridge", "Crescent", "Delta", "Evergreen", "Fusion", "Granite", "Horizon", "Indus", "Jade", "Kestrel", "Lotus"])} ${rng.pick(["Traders", "Systems", "Enterprises", "Industries", "Solutions", "Retail", "Labs", "Holdings"])} ${i + 1}`,
    seg: rng.weighted(
      SEGMENTS,
      SEGMENTS.map((s) => s[1]),
    ),
    region: rng.weighted(REGIONS, [3, 3, 1.6, 2.6]),
    // A third of the book exists at the start; the rest are won evenly through to the last month, so
    // "new customers" and repeat rates behave like a real sales ledger.
    since: i < 60 ? 0 : Math.round(((i - 60 + rng.float(0, 1)) / 120) * 630),
  }));
  const start = utc(2025, 1, 1);
  let seq = 10001;
  for (let day = 0; day < 638; day++) {
    const t = start + day * DAY_MS;
    const dow = (new Date(t).getUTCDay() + 6) % 7;
    if (dow >= 5) continue;
    const m = new Date(t).getUTCMonth();
    const quarterEnd = m % 3 === 2 && new Date(t).getUTCDate() > 18 ? 1.6 : 1;
    const n = Math.max(0, Math.round(rng.normal(6.5 * quarterEnd * (1 + day / 1500), 2.2)));
    const active = customers.filter((c) => c.since <= day);
    for (let k = 0; k < n; k++) {
      const c = rng.pick(active);
      const [regionName, reps] = c.region;
      const salesRep = rng.pick(reps);
      const invoice = `INV-${seq++}`;
      const lines = Math.min(4, rng.geometric(0.35));
      for (let l = 0; l < lines; l++) {
        const [pName, pCat, pPrice, costRatio] = rng.pick(PRODUCTS);
        const q = Math.max(1, Math.round(rng.logNormal(c.seg[2], 0.6)));
        const d =
          c.seg[0] === "Enterprise"
            ? rng.pick([0.05, 0.1, 0.12, 0.15])
            : c.seg[0] === "SMB"
              ? rng.pick([0, 0.05, 0.08])
              : rng.pick([0, 0, 0.03]);
        const gross = q * pPrice;
        inv(invoice);
        date(t);
        region(regionName);
        rep(salesRep);
        customer(c.name);
        segment(c.seg[0]);
        product(pName);
        category(pCat);
        qty(q);
        price(pPrice);
        disc(d);
        revenue(round2(gross * (1 - d)));
        cost(round2(gross * costRatio * rng.float(0.95, 1.05)));
      }
    }
  }
  return b.finish({
    id: "sample_sales",
    name: "Demo · B2B sales invoices",
    fileName: "demo-sales.csv",
    sampleId: "sales",
  });
}

/**
 * Employee roster as of a fixed "today" (30 Sep 2026), so the output never
 * depends on the real date. Attrition rises with tenure, low engagement
 * (below 60) and overtime; salaries include a modelled 4% gender pay gap.
 */
export function generateHr(seed = 11): Dataset {
  const rng = new Rng(seed);
  const b = new SampleBuilder();
  const id = b.string("Employee ID");
  const gender = b.string("Gender");
  const age = b.number("Age", { integer: true, decimals: 0 });
  const dept = b.string("Department");
  const level = b.string("Job Level");
  const location = b.string("Location");
  const hire = b.date("Hire Date");
  const exit = b.date("Exit Date");
  const status = b.string("Status");
  const reason = b.string("Exit Reason");
  const salary = b.number("Annual Salary", { currency: "INR", integer: true, decimals: 0 });
  const rating = b.number("Performance Rating", { decimals: 1 });
  const engagement = b.number("Engagement Score", { decimals: 0, integer: true });
  const training = b.number("Training Hours", { integer: true, decimals: 0 });
  const overtime = b.string("Overtime");

  // [department, headcount weight, base salary ₹, attrition propensity]
  const DEPTS: Array<[string, number, number, number]> = [
    ["Engineering", 30, 1_800_000, 0.14],
    ["Sales", 22, 1_100_000, 0.24],
    ["Customer Support", 16, 520_000, 0.3],
    ["Operations", 12, 700_000, 0.18],
    ["Marketing", 8, 1_200_000, 0.17],
    ["Finance", 6, 1_300_000, 0.11],
    ["People & HR", 6, 950_000, 0.13],
  ];
  // [job level, headcount weight, salary multiplier]
  const LEVELS: Array<[string, number, number]> = [
    ["L1 Associate", 40, 0.75],
    ["L2 Senior", 30, 1],
    ["L3 Lead", 18, 1.45],
    ["L4 Manager", 9, 2.1],
    ["L5 Director", 3, 3.4],
  ];
  const LOCS = ["Bengaluru", "Pune", "Gurugram", "Hyderabad", "Remote"];
  const today = utc(2026, 9, 30);
  for (let i = 0; i < 1240; i++) {
    const [d, , base, attr] = rng.weighted(
      DEPTS,
      DEPTS.map((x) => x[1]),
    );
    const [lvl, , mult] = rng.weighted(
      LEVELS,
      LEVELS.map((x) => x[1]),
    );
    const g = rng.weighted(
      ["Female", "Male", "Non-binary"],
      [d === "Engineering" ? 30 : 45, d === "Engineering" ? 69 : 54, 1],
    );
    const hireT = utc(2016, 1, 1) + rng.int(0, 3830) * DAY_MS;
    const tenureYears = (today - hireT) / (365 * DAY_MS);
    const eng = Math.round(Math.min(100, Math.max(20, rng.normal(72, 12))));
    const ot = rng.chance(d === "Customer Support" || d === "Operations" ? 0.38 : 0.18);
    const perf = Math.round(Math.min(5, Math.max(1, rng.normal(3.4, 0.8))) * 2) / 2;
    // Leaving probability: department propensity × tenure factor (capped at 2.2) × low-engagement and
    // overtime effects, capped at 75%. Exits fall between 120 days after hire and "today".
    const leaveP = attr * Math.min(2.2, tenureYears / 2.5) * (eng < 60 ? 1.7 : 1) * (ot ? 1.35 : 1);
    const exited = rng.chance(Math.min(0.75, leaveP));
    const exitT = exited
      ? Math.min(today, hireT + rng.int(120, Math.max(121, Math.round((today - hireT) / DAY_MS))) * DAY_MS)
      : NaN;
    id(`E${String(10001 + i)}`);
    gender(g);
    age(Math.round(Math.min(60, Math.max(21, 23 + tenureYears + rng.normal(4, 4) + (mult - 1) * 6))));
    dept(d);
    level(lvl);
    location(rng.pick(LOCS));
    hire(hireT);
    exit(exited ? exitT : null);
    status(exited ? "Exited" : "Active");
    reason(
      exited
        ? rng.weighted(
            [
              "Resigned",
              "Better Opportunity",
              "Relocation",
              "Higher Studies",
              "Terminated",
              "Layoff",
              "Retired",
            ],
            [26, 34, 10, 6, 12, 8, 4],
          )
        : null,
    );
    salary(Math.round((base * mult * rng.float(0.85, 1.2) * (g === "Female" ? 0.96 : 1)) / 1000) * 1000);
    rating(perf);
    engagement(eng);
    training(Math.max(0, Math.round(rng.normal(24, 10))));
    overtime(ot ? "Yes" : "No");
  }
  return b.finish({
    id: "sample_hr",
    name: "Demo · employee roster",
    fileName: "demo-hr.csv",
    sampleId: "hr",
  });
}

/**
 * Monthly P&L lines, Oct 2024 – Sep 2026, by account and cost centre. Budget
 * follows seasonality and planned growth; revenue and COGS actuals grow 1.2%
 * a month against a 1% plan, so they drift above budget, and advertising
 * overspends by 35% in October and November. All amounts are positive;
 * Account Type gives the P&L direction.
 */
export function generateFinance(seed = 13): Dataset {
  const rng = new Rng(seed);
  const b = new SampleBuilder();
  const month = b.date("Month");
  const account = b.string("Account");
  const type = b.string("Account Type");
  const cc = b.string("Cost Center");
  const actual = b.number("Actual", { currency: "INR" });
  const budget = b.number("Budget", { currency: "INR" });
  // [account, account type, monthly base ₹, cost centres (base split evenly)]
  const ACCOUNTS: Array<[string, string, number, string[]]> = [
    ["Product Revenue", "Revenue", 4_200_000, ["Sales"]],
    ["Services Revenue", "Revenue", 1_100_000, ["Sales"]],
    ["Subscription Revenue", "Revenue", 900_000, ["Sales"]],
    ["Materials", "COGS", 1_700_000, ["Operations"]],
    ["Direct Labour", "COGS", 650_000, ["Operations"]],
    ["Freight In", "COGS", 180_000, ["Operations"]],
    ["Salaries", "Operating Expense", 380_000, ["Sales", "Marketing", "Technology", "Administration"]],
    ["Rent", "Operating Expense", 95_000, ["Administration"]],
    ["Software Subscriptions", "Operating Expense", 60_000, ["Technology"]],
    ["Advertising", "Operating Expense", 210_000, ["Marketing"]],
    ["Travel", "Operating Expense", 45_000, ["Sales", "Administration"]],
    ["Utilities", "Operating Expense", 30_000, ["Administration"]],
    ["Professional Fees", "Operating Expense", 55_000, ["Administration"]],
    ["Interest Income", "Other Income", 25_000, ["Administration"]],
    ["Income Tax", "Tax", 260_000, ["Administration"]],
  ];
  let t = utc(2024, 10, 1);
  for (let i = 0; i < 24; i++) {
    const m = new Date(t).getUTCMonth();
    const season = [0.92, 0.88, 1.02, 0.95, 0.97, 1.0, 1.0, 0.98, 1.04, 1.18, 1.14, 1.06][m] as number;
    const trend = 1 + i * 0.012;
    for (const [name, typ, base, centers] of ACCOUNTS) {
      for (const center of centers) {
        const share = 1 / centers.length;
        const revLike = typ === "Revenue" || typ === "COGS";
        // Budget: seasonal with 1%/month growth for revenue and COGS; non-seasonal 0.6%/month for other lines.
        // Actual: revenue/COGS re-based to 1.2%/month growth, then −10%…+12% noise and the Oct/Nov ad overspend.
        const plan = base * share * (revLike ? season * (1 + i * 0.01) : 1 + i * 0.006);
        const act =
          plan *
          (revLike ? trend / (1 + i * 0.01) : 1) *
          rng.float(0.9, 1.12) *
          (typ === "Operating Expense" && name === "Advertising" && (m === 9 || m === 10) ? 1.35 : 1);
        month(t);
        account(name);
        type(typ);
        cc(center);
        actual(round2(act));
        budget(round2(plan));
      }
    }
    t = addMonths(t, 1);
  }
  return b.finish({
    id: "sample_finance",
    name: "Demo · P&L ledger vs budget",
    fileName: "demo-finance.csv",
    sampleId: "finance",
  });
}

/**
 * Daily results for 12 campaigns, 1 Oct 2025 – 30 Sep 2026. Seasonal uplift
 * in Oct/Nov (×1.4) and Dec/Jan (×1.1); LinkedIn dips at weekends while other
 * channels rise slightly; the prospecting video fatigues (CTR down by up to
 * 35% over the year). Leads are derived from conversions (×3.5 on LinkedIn,
 * ×1.8 elsewhere), and revenue from conversions × a channel order value.
 */
export function generateMarketing(seed = 17): Dataset {
  const rng = new Rng(seed);
  const b = new SampleBuilder();
  const date = b.date("Date");
  const campaign = b.string("Campaign");
  const channel = b.string("Channel");
  const impressions = b.number("Impressions", { integer: true, decimals: 0 });
  const clicks = b.number("Clicks", { integer: true, decimals: 0 });
  const spend = b.number("Spend", { currency: "INR" });
  const leads = b.number("Leads", { integer: true, decimals: 0 });
  const conversions = b.number("Conversions", { integer: true, decimals: 0 });
  const revenue = b.number("Revenue", { currency: "INR" });
  const CAMPAIGNS: Array<[string, string, number, number, number, number]> = [
    // name, channel, daily impressions, ctr, cpc, conversion rate (of clicks)
    ["Brand Search", "Google Ads", 9000, 0.085, 9, 0.09],
    ["Generic Search", "Google Ads", 26000, 0.031, 22, 0.035],
    ["Shopping Feed", "Google Ads", 34000, 0.018, 14, 0.042],
    ["Prospecting Video", "Meta", 120000, 0.008, 11, 0.012],
    ["Retargeting Carousel", "Meta", 42000, 0.015, 13, 0.05],
    ["Lookalike Audiences", "Meta", 80000, 0.009, 12, 0.018],
    ["Decision Makers", "LinkedIn", 15000, 0.006, 85, 0.04],
    ["Webinar Promotion", "LinkedIn", 9000, 0.009, 70, 0.06],
    ["Newsletter", "Email", 18000, 0.034, 1.2, 0.03],
    ["Win-back Sequence", "Email", 6000, 0.05, 1.5, 0.045],
    ["Partner Network", "Affiliate", 22000, 0.012, 7, 0.028],
    ["Coupon Sites", "Affiliate", 14000, 0.02, 6, 0.04],
  ];
  const start = utc(2025, 10, 1);
  for (let day = 0; day < 365; day++) {
    const t = start + day * DAY_MS;
    const dow = (new Date(t).getUTCDay() + 6) % 7;
    const m = new Date(t).getUTCMonth();
    const season = m === 9 || m === 10 ? 1.4 : m === 11 || m === 0 ? 1.1 : 1;
    for (const [name, ch, imp, ctr, cpc, cvr] of CAMPAIGNS) {
      const fatigue = name.includes("Prospecting") ? 1 - Math.min(0.35, day / 900) : 1;
      const i = Math.round(
        imp * season * (dow >= 5 ? (ch === "LinkedIn" ? 0.45 : 1.08) : 1) * rng.float(0.8, 1.2),
      );
      const c = Math.round(i * ctr * fatigue * rng.float(0.85, 1.15));
      const s = round2(c * cpc * rng.float(0.9, 1.1));
      const conv = Math.round(c * cvr * rng.float(0.7, 1.3));
      const aov = ch === "LinkedIn" ? 42000 : ch === "Email" ? 1900 : 2300;
      date(t);
      campaign(name);
      channel(ch);
      impressions(i);
      clicks(c);
      spend(s);
      leads(Math.round(conv * (ch === "LinkedIn" ? 3.5 : 1.8) * rng.float(0.8, 1.2)));
      conversions(conv);
      revenue(round2(conv * aov * rng.float(0.8, 1.2)));
    }
  }
  return b.finish({
    id: "sample_marketing",
    name: "Demo · campaign performance",
    fileName: "demo-marketing.csv",
    sampleId: "marketing",
  });
}

/**
 * Account-month MRR snapshots, Oct 2024 – Sep 2026, in USD. Every live account
 * has one row per month, and each row satisfies Opening + New + Expansion −
 * Contraction − Churned = MRR. A churned account's final row has Seats and
 * MRR 0, and it has no rows after that.
 */
export function generateSaas(seed = 19): Dataset {
  const rng = new Rng(seed);
  const b = new SampleBuilder();
  const month = b.date("Month");
  const account = b.string("Account ID");
  const plan = b.string("Plan");
  const region = b.string("Region");
  const seats = b.number("Seats", { integer: true, decimals: 0 });
  const opening = b.number("Opening MRR", { currency: "USD" });
  const mrr = b.number("MRR", { currency: "USD" });
  const newMrr = b.number("New MRR", { currency: "USD" });
  const expansion = b.number("Expansion MRR", { currency: "USD" });
  const contraction = b.number("Contraction MRR", { currency: "USD" });
  const churned = b.number("Churned MRR", { currency: "USD" });
  const churnFlag = b.string("Churned");
  const signup = b.date("Signup Date");
  // [plan, $ per seat per month, monthly churn probability, median seats]
  const PLANS: Array<[string, number, number, number]> = [
    ["Starter", 29, 0.035, 2],
    ["Growth", 49, 0.018, 8],
    ["Enterprise", 79, 0.007, 45],
  ];
  const REGIONS = ["North America", "Europe", "India", "APAC", "LATAM"];
  interface Acc {
    id: string;
    plan: (typeof PLANS)[number];
    region: string;
    seats: number;
    signup: number;
    alive: boolean;
  }
  const accounts: Acc[] = [];
  const start = utc(2024, 10, 1);
  let seq = 1;
  for (let i = 0; i < 24; i++) {
    const t = addMonths(start, i);
    const newCount = Math.round(rng.normal(22 + i * 0.9, 4));
    for (let k = 0; k < newCount; k++) {
      const p = rng.weighted(PLANS, [55, 33, 12]);
      accounts.push({
        id: `ACC-${String(seq++).padStart(5, "0")}`,
        plan: p,
        region: rng.weighted(REGIONS, [34, 26, 18, 14, 8]),
        seats: Math.max(1, Math.round(rng.logNormal(p[3], 0.5))),
        signup: t + rng.int(0, 27) * DAY_MS,
        alive: true,
      });
    }
    // Signups land in the first 28 days of their month, which makes that month's row the "new" one
    // (Opening 0). Afterwards each month: churn (plan-specific), else 7% expansion (+10–40% seats),
    // else 3.5% contraction (−10–30% seats, only above one seat).
    for (const a of accounts) {
      if (!a.alive) continue;
      const isNew = a.signup >= t && a.signup < addMonths(t, 1);
      const open = isNew ? 0 : a.seats * a.plan[1];
      let nMrr = 0;
      let exp = 0;
      let con = 0;
      let ch = 0;
      let churnedNow = false;
      if (isNew) nMrr = a.seats * a.plan[1];
      else if (rng.chance(a.plan[2])) {
        churnedNow = true;
        ch = open;
        a.alive = false;
      } else if (rng.chance(0.07)) {
        const add = Math.max(1, Math.round(a.seats * rng.float(0.1, 0.4)));
        a.seats += add;
        exp = add * a.plan[1];
      } else if (rng.chance(0.035) && a.seats > 1) {
        const cut = Math.max(1, Math.round(a.seats * rng.float(0.1, 0.3)));
        a.seats -= cut;
        con = cut * a.plan[1];
      }
      const close = churnedNow ? 0 : a.seats * a.plan[1];
      month(t);
      account(a.id);
      plan(a.plan[0]);
      region(a.region);
      seats(churnedNow ? 0 : a.seats);
      opening(open);
      mrr(close);
      newMrr(nMrr);
      expansion(exp);
      contraction(con);
      churned(ch);
      churnFlag(churnedNow ? "Yes" : "No");
      signup(a.signup);
    }
  }
  return b.finish({
    id: "sample_saas",
    name: "Demo · SaaS MRR by account-month",
    fileName: "demo-saas.csv",
    sampleId: "saas",
  });
}
