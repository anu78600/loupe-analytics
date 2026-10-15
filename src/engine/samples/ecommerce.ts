/**
 * Deterministic Indian D2C e-commerce demo (~50k order lines, Oct 2024 – Sep 2026).
 * Behaviour is modelled, not random noise: festive seasonality and sale days,
 * a growing repeat-customer base, tier-dependent COD and RTO, category return
 * rates that rise with discount depth, courier-specific transit times.
 * Clearly labelled as demo data everywhere it appears.
 *
 * One row per order line: order-level fields (date, customer, channel,
 * payment, courier, outcome) repeat across an order's lines, and the shipping
 * fee sits on the first line only. Amounts are GST-inclusive INR. Realistic
 * but not real: customers, orders and amounts are all generated from the
 * seeded Rng.
 */
import { Rng } from "@/engine/core/random";
import { DAY_MS, HOUR_MS, utc } from "@/engine/core/dates";
import type { Dataset } from "@/engine/core/types";
import { round2, SampleBuilder, shuffle } from "./builder";

interface StateDef {
  name: string;
  /** Relative share of new customers. */
  w: number;
  /** City tier (1 = metro … 3); drives COD propensity, RTO risk and transit time. */
  tier: 1 | 2 | 3;
  /** North-East: slower transit. */
  ne?: boolean;
  /** [city, first three digits of its PIN codes]. */
  cities: Array<[string, string]>;
}

const STATES: StateDef[] = [
  {
    name: "Maharashtra",
    w: 16,
    tier: 1,
    cities: [
      ["Mumbai", "400"],
      ["Pune", "411"],
      ["Nagpur", "440"],
      ["Nashik", "422"],
      ["Thane", "400"],
    ],
  },
  {
    name: "Karnataka",
    w: 11,
    tier: 1,
    cities: [
      ["Bengaluru", "560"],
      ["Mysuru", "570"],
      ["Mangaluru", "575"],
      ["Hubli", "580"],
    ],
  },
  { name: "Delhi", w: 10, tier: 1, cities: [["New Delhi", "110"]] },
  {
    name: "Uttar Pradesh",
    w: 9,
    tier: 3,
    cities: [
      ["Lucknow", "226"],
      ["Noida", "201"],
      ["Kanpur", "208"],
      ["Varanasi", "221"],
      ["Agra", "282"],
    ],
  },
  {
    name: "Tamil Nadu",
    w: 8,
    tier: 1,
    cities: [
      ["Chennai", "600"],
      ["Coimbatore", "641"],
      ["Madurai", "625"],
    ],
  },
  {
    name: "Telangana",
    w: 6,
    tier: 1,
    cities: [
      ["Hyderabad", "500"],
      ["Warangal", "506"],
    ],
  },
  {
    name: "Gujarat",
    w: 6,
    tier: 2,
    cities: [
      ["Ahmedabad", "380"],
      ["Surat", "395"],
      ["Vadodara", "390"],
    ],
  },
  {
    name: "West Bengal",
    w: 6,
    tier: 2,
    cities: [
      ["Kolkata", "700"],
      ["Howrah", "711"],
      ["Siliguri", "734"],
    ],
  },
  {
    name: "Rajasthan",
    w: 4,
    tier: 3,
    cities: [
      ["Jaipur", "302"],
      ["Jodhpur", "342"],
      ["Udaipur", "313"],
    ],
  },
  {
    name: "Haryana",
    w: 4,
    tier: 2,
    cities: [
      ["Gurugram", "122"],
      ["Faridabad", "121"],
    ],
  },
  {
    name: "Kerala",
    w: 3.5,
    tier: 2,
    cities: [
      ["Kochi", "682"],
      ["Thiruvananthapuram", "695"],
    ],
  },
  {
    name: "Madhya Pradesh",
    w: 3,
    tier: 3,
    cities: [
      ["Indore", "452"],
      ["Bhopal", "462"],
    ],
  },
  {
    name: "Bihar",
    w: 2.5,
    tier: 3,
    cities: [
      ["Patna", "800"],
      ["Gaya", "823"],
    ],
  },
  {
    name: "Punjab",
    w: 2.5,
    tier: 2,
    cities: [
      ["Ludhiana", "141"],
      ["Amritsar", "143"],
    ],
  },
  {
    name: "Andhra Pradesh",
    w: 2.5,
    tier: 2,
    cities: [
      ["Visakhapatnam", "530"],
      ["Vijayawada", "520"],
    ],
  },
  {
    name: "Odisha",
    w: 1.8,
    tier: 3,
    cities: [
      ["Bhubaneswar", "751"],
      ["Cuttack", "753"],
    ],
  },
  { name: "Assam", w: 1.5, tier: 3, ne: true, cities: [["Guwahati", "781"]] },
  {
    name: "Jharkhand",
    w: 1.2,
    tier: 3,
    cities: [
      ["Ranchi", "834"],
      ["Jamshedpur", "831"],
    ],
  },
  { name: "Chhattisgarh", w: 1, tier: 3, cities: [["Raipur", "492"]] },
  { name: "Uttarakhand", w: 1, tier: 3, cities: [["Dehradun", "248"]] },
  { name: "Goa", w: 0.8, tier: 2, cities: [["Panaji", "403"]] },
  { name: "Chandigarh", w: 0.6, tier: 1, cities: [["Chandigarh", "160"]] },
  { name: "Himachal Pradesh", w: 0.6, tier: 3, cities: [["Shimla", "171"]] },
  {
    name: "Jammu and Kashmir",
    w: 0.5,
    tier: 3,
    cities: [
      ["Srinagar", "190"],
      ["Jammu", "180"],
    ],
  },
];

interface SubDef {
  name: string;
  /** SKU segment, e.g. "KUR" in APP-KUR-001. */
  code: string;
  items: string[];
  /** [low, high] list-price band in ₹. */
  price: [number, number];
}
interface CatDef {
  name: string;
  code: string;
  /** Relative share of demand. */
  w: number;
  /** Base probability that a delivered line is returned. */
  returnP: number;
  /** Cost of goods as a share of the line's gross value (±8% noise). */
  costRatio: number;
  /** GST rate already included in prices. */
  gst: number;
  brands: string[];
  subs: SubDef[];
  /** Return reasons with relative weights. */
  reasons: Array<[string, number]>;
}

const APPAREL_REASONS: Array<[string, number]> = [
  ["Size too small", 30],
  ["Size too large", 22],
  ["Quality not as expected", 18],
  ["Colour different from image", 12],
  ["Changed my mind", 10],
  ["Received damaged", 4],
  ["Wrong item delivered", 4],
];
const GOODS_REASONS: Array<[string, number]> = [
  ["Defective / not working", 30],
  ["Quality not as expected", 22],
  ["Received damaged", 18],
  ["Not as described", 14],
  ["Changed my mind", 10],
  ["Wrong item delivered", 6],
];

const CATEGORIES: CatDef[] = [
  {
    name: "Apparel",
    code: "APP",
    w: 30,
    returnP: 0.15,
    costRatio: 0.42,
    gst: 0.05,
    brands: ["Urban Loom", "Saanvi", "Kosha"],
    reasons: APPAREL_REASONS,
    subs: [
      {
        name: "Kurtas",
        code: "KUR",
        items: ["Cotton Kurta", "Printed Kurta", "Anarkali Kurta", "Linen Kurta"],
        price: [599, 1899],
      },
      {
        name: "T-Shirts",
        code: "TEE",
        items: ["Crew Neck Tee", "Polo T-Shirt", "Oversized Tee", "Graphic Tee"],
        price: [349, 999],
      },
      {
        name: "Jeans",
        code: "JNS",
        items: ["Slim Fit Jeans", "Straight Jeans", "Relaxed Jeans"],
        price: [999, 2499],
      },
      {
        name: "Dresses",
        code: "DRS",
        items: ["Wrap Dress", "Maxi Dress", "Shirt Dress"],
        price: [899, 2799],
      },
    ],
  },
  {
    name: "Footwear",
    code: "FTW",
    w: 13,
    returnP: 0.12,
    costRatio: 0.45,
    gst: 0.12,
    brands: ["Stride", "Paadukaa"],
    reasons: APPAREL_REASONS,
    subs: [
      {
        name: "Sneakers",
        code: "SNK",
        items: ["Running Sneakers", "Canvas Sneakers", "Court Sneakers"],
        price: [1299, 3999],
      },
      {
        name: "Sandals",
        code: "SND",
        items: ["Leather Sandals", "Kolhapuri Chappals", "Sports Sandals"],
        price: [499, 1499],
      },
      { name: "Formal Shoes", code: "FRM", items: ["Oxford Shoes", "Derby Shoes"], price: [1499, 3499] },
    ],
  },
  {
    name: "Beauty & Personal Care",
    code: "BPC",
    w: 18,
    returnP: 0.03,
    costRatio: 0.32,
    gst: 0.18,
    brands: ["Nimbus Naturals", "Glow Theory"],
    reasons: GOODS_REASONS,
    subs: [
      {
        name: "Skincare",
        code: "SKN",
        items: ["Vitamin C Serum", "Daily Moisturiser", "Sunscreen SPF 50", "Face Wash"],
        price: [249, 999],
      },
      {
        name: "Haircare",
        code: "HAR",
        items: ["Onion Hair Oil", "Repair Shampoo", "Hair Mask"],
        price: [199, 799],
      },
      { name: "Fragrance", code: "FRG", items: ["Eau de Parfum", "Body Mist"], price: [499, 1999] },
      { name: "Makeup", code: "MKP", items: ["Matte Lipstick", "Kajal", "BB Cream"], price: [199, 899] },
    ],
  },
  {
    name: "Home & Kitchen",
    code: "HMK",
    w: 16,
    returnP: 0.05,
    costRatio: 0.48,
    gst: 0.12,
    brands: ["Terra Home", "Kitchenary"],
    reasons: GOODS_REASONS,
    subs: [
      {
        name: "Cookware",
        code: "CKW",
        items: ["Cast Iron Kadai", "Non-stick Tawa", "Pressure Cooker"],
        price: [699, 3499],
      },
      {
        name: "Bedding",
        code: "BED",
        items: ["Cotton Bedsheet Set", "Quilt", "Pillow Pair"],
        price: [799, 2999],
      },
      { name: "Decor", code: "DEC", items: ["Ceramic Vase", "Wall Clock", "Table Lamp"], price: [299, 1499] },
      { name: "Storage", code: "STG", items: ["Glass Jar Set", "Storage Basket"], price: [249, 1199] },
    ],
  },
  {
    name: "Electronics Accessories",
    code: "ELA",
    w: 12,
    returnP: 0.07,
    costRatio: 0.58,
    gst: 0.18,
    brands: ["Voltix", "Pulse"],
    reasons: GOODS_REASONS,
    subs: [
      { name: "Earbuds", code: "EAR", items: ["Wireless Earbuds", "Neckband Earphones"], price: [999, 3999] },
      {
        name: "Chargers",
        code: "CHG",
        items: ["65W Fast Charger", "Car Charger", "USB-C Cable"],
        price: [299, 1299],
      },
      {
        name: "Power Banks",
        code: "PWB",
        items: ["10000mAh Power Bank", "20000mAh Power Bank"],
        price: [799, 2199],
      },
      {
        name: "Smartwatches",
        code: "SWT",
        items: ["Fitness Smartwatch", "AMOLED Smartwatch"],
        price: [1999, 5999],
      },
    ],
  },
  {
    name: "Sports & Fitness",
    code: "SPF",
    w: 11,
    returnP: 0.055,
    costRatio: 0.45,
    gst: 0.12,
    brands: ["Flexa", "Kinetic"],
    reasons: GOODS_REASONS,
    subs: [
      { name: "Yoga Mats", code: "YOG", items: ["6mm Yoga Mat", "Cork Yoga Mat"], price: [499, 1499] },
      {
        name: "Dumbbells",
        code: "DMB",
        items: ["PVC Dumbbell Pair", "Adjustable Dumbbell"],
        price: [599, 2499],
      },
      {
        name: "Activewear",
        code: "ACT",
        items: ["Training Shorts", "Sports Bra", "Track Pants"],
        price: [499, 1799],
      },
    ],
  },
];

/** Colour variants appended to apparel, footwear and sports product names. */
const VARIANTS = ["Indigo", "Black", "Ivory", "Olive", "Rust", "Charcoal", "Sage", "Maroon"];

interface Product {
  sku: string;
  name: string;
  brand: string;
  cat: CatDef;
  sub: SubDef;
  /** Selling (list) price in ₹. */
  price: number;
  /** Printed maximum retail price, roughly 25–75% above the selling price. */
  mrp: number;
  /** Popularity weight within its category, set after the catalogue is built. */
  weight: number;
}

/**
 * 2–3 variants per item. Prices lean towards the low end of the band and end
 * in 49 or 99; MRPs end in 9. Popularity within each category is Zipf-like.
 */
function buildCatalogue(rng: Rng): Product[] {
  const products: Product[] = [];
  for (const cat of CATEGORIES) {
    let seq = 1;
    for (const sub of cat.subs) {
      for (const item of sub.items) {
        const nVariants = rng.int(2, 3);
        for (let v = 0; v < nVariants; v++) {
          const brand = rng.pick(cat.brands);
          const [lo, hi] = sub.price;
          const raw = lo + (hi - lo) * Math.pow(rng.next(), 1.3);
          const price = Math.max(lo, Math.round(raw / 50) * 50 - 1);
          const variant =
            cat.code === "APP" || cat.code === "FTW" || cat.code === "SPF" ? ` – ${rng.pick(VARIANTS)}` : "";
          products.push({
            sku: `${cat.code}-${sub.code}-${String(seq++).padStart(3, "0")}`,
            name: `${brand} ${item}${variant}`,
            brand,
            cat,
            sub,
            price,
            mrp: Math.round((price * rng.float(1.25, 1.75)) / 10) * 10 - 1,
            weight: 0,
          });
        }
      }
    }
  }
  // Zipf-like popularity within each category: a few hero SKUs, a long tail. Ranks are a seeded
  // shuffle, so every engine draws the same random numbers in the same order.
  for (const cat of CATEGORIES) {
    const ps = products.filter((p) => p.cat === cat);
    const ranks = shuffle(
      rng,
      ps.map((_, i) => i),
    );
    ps.forEach((p, i) => (p.weight = 1 / Math.pow((ranks[i] as number) + 1, 0.95)));
  }
  return products;
}

/** w = share of shipments, transit = mean days in transit, rto = multiplier on RTO risk. */
const COURIERS: Array<{ name: string; w: number; transit: number; rto: number }> = [
  { name: "Delhivery", w: 30, transit: 3.4, rto: 1.0 },
  { name: "Xpressbees", w: 18, transit: 3.8, rto: 1.05 },
  { name: "Blue Dart", w: 15, transit: 2.4, rto: 0.82 },
  { name: "Ecom Express", w: 15, transit: 4.2, rto: 1.18 },
  { name: "Shadowfax", w: 12, transit: 3.1, rto: 1.08 },
  { name: "DTDC", w: 10, transit: 4.8, rto: 1.22 },
];

const CHANNELS: Array<[string, number]> = [
  ["Website", 42],
  ["Mobile App", 33],
  ["Amazon", 11],
  ["Flipkart", 8],
  ["Instagram Shop", 6],
];

const PREPAID: Array<[string, number]> = [
  ["UPI", 50],
  ["Credit Card", 13],
  ["Debit Card", 9],
  ["Net Banking", 8],
  ["Wallet", 12],
  ["EMI", 8],
];

// Demand multipliers: by month (Jan … Dec, October–November festive peak) and weekday (Mon … Sun,
// weekend uplift); HOUR_W weights the hour of day (late-evening peak).
const MONTH_MULT = [0.95, 0.86, 0.96, 0.9, 0.94, 1.0, 1.06, 1.0, 1.08, 1.45, 1.33, 1.1];
const DOW_MULT = [0.93, 0.9, 0.93, 0.97, 1.03, 1.14, 1.1];
const HOUR_W = [
  0.6, 0.35, 0.2, 0.15, 0.15, 0.25, 0.5, 0.9, 1.3, 1.6, 1.8, 2, 2.3, 2.4, 2.1, 1.9, 1.9, 2, 2.3, 2.7, 3.2,
  3.4, 2.8, 1.6,
];
const HOURS = HOUR_W.map((_, i) => i);

interface SaleEvent {
  /** First and last day of the sale (midnight starts, both inclusive). */
  from: number;
  to: number;
  /** Demand multiplier. */
  mult: number;
  /** Sale coupon and its discount fraction; sales without one cut list prices by 5% instead. */
  coupon?: string;
  pct?: number;
}

// Indian retail calendar: festive-season and Diwali sales, end-of-season sales (EOSS), and short sales
// around Republic Day (26 Jan) and Independence Day (15 Aug).
const SALES: SaleEvent[] = [
  { from: utc(2024, 10, 1), to: utc(2024, 10, 8), mult: 1.9, coupon: "FESTIVE20", pct: 0.2 },
  { from: utc(2024, 10, 28), to: utc(2024, 11, 2), mult: 1.6, coupon: "DIWALI25", pct: 0.25 },
  { from: utc(2025, 1, 10), to: utc(2025, 1, 19), mult: 1.35, coupon: "EOSS15", pct: 0.15 },
  { from: utc(2025, 1, 24), to: utc(2025, 1, 26), mult: 1.3 },
  { from: utc(2025, 6, 20), to: utc(2025, 7, 4), mult: 1.4, coupon: "EOSS15", pct: 0.15 },
  { from: utc(2025, 8, 13), to: utc(2025, 8, 15), mult: 1.3 },
  { from: utc(2025, 9, 23), to: utc(2025, 10, 2), mult: 2.0, coupon: "FESTIVE20", pct: 0.2 },
  { from: utc(2025, 10, 17), to: utc(2025, 10, 21), mult: 1.7, coupon: "DIWALI25", pct: 0.25 },
  { from: utc(2026, 1, 9), to: utc(2026, 1, 18), mult: 1.35, coupon: "EOSS15", pct: 0.15 },
  { from: utc(2026, 1, 24), to: utc(2026, 1, 26), mult: 1.3 },
  { from: utc(2026, 6, 19), to: utc(2026, 7, 3), mult: 1.4, coupon: "EOSS15", pct: 0.15 },
  { from: utc(2026, 8, 13), to: utc(2026, 8, 15), mult: 1.3 },
  { from: utc(2026, 9, 22), to: utc(2026, 9, 30), mult: 2.0, coupon: "FESTIVE20", pct: 0.2 },
];

interface Customer {
  id: string;
  state: StateDef;
  city: string;
  pincode: string;
  /** Weight in the returning-customer draw: 0.5, 1.6 or 4.2 (60/30/10% of customers). */
  loyalty: number;
  /** Personal tilt on COD probability (±0.12). */
  codBias: number;
  /** Favourite category: 55% of basket lines come from it. */
  favCat: CatDef;
  /** Day of the latest order (wall-clock ms). */
  last: number;
  orders: number;
}

/** Knuth's multiplication method for small λ; a normal approximation above 60, where it would need ~λ draws. */
function poisson(rng: Rng, lambda: number): number {
  if (lambda > 60) return Math.max(0, Math.round(rng.normal(lambda, Math.sqrt(lambda))));
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng.next();
  } while (p > L);
  return k - 1;
}

/** First and last order day, inclusive: 1 Oct 2024 – 30 Sep 2026. */
export const ECOMMERCE_START = utc(2024, 10, 1);
export const ECOMMERCE_END = utc(2026, 9, 30);

/**
 * Generates the flagship demo. The same seed gives the same rows in every
 * JavaScript engine: all randomness comes from the seeded Rng, drawn in a
 * fixed order (no engine-dependent sorts). Only a last-bit difference in an
 * engine's Math.exp or Math.log landing exactly on a rounding boundary could
 * change a value. `scale` multiplies the daily order volume.
 */
export function generateEcommerce(opts: { seed?: number; scale?: number } = {}): Dataset {
  const rng = new Rng(opts.seed ?? 20241001);
  const scale = opts.scale ?? 1;
  const products = buildCatalogue(rng);
  const catWeights = CATEGORIES.map((c) => c.w);
  const byCat = new Map(CATEGORIES.map((c) => [c, products.filter((p) => p.cat === c)]));

  const b = new SampleBuilder();
  const cOrderId = b.string("Order ID");
  const cOrderDate = b.date("Order Date", true);
  const cCustomer = b.string("Customer ID");
  const cCity = b.string("Customer City");
  const cState = b.string("Customer State");
  const cPin = b.string("Pincode");
  const cChannel = b.string("Channel");
  const cCategory = b.string("Category");
  const cSub = b.string("Sub Category");
  const cBrand = b.string("Brand");
  const cSku = b.string("SKU");
  const cProduct = b.string("Product Name");
  const cQty = b.number("Quantity", { integer: true, decimals: 0 });
  const cMrp = b.number("MRP", { currency: "INR", integer: true, decimals: 0 });
  const cPrice = b.number("Unit Price", { currency: "INR", integer: true, decimals: 0 });
  const cGross = b.number("Gross Amount", { currency: "INR" });
  const cDiscount = b.number("Discount", { currency: "INR" });
  const cCoupon = b.string("Coupon Code");
  const cNet = b.number("Net Amount", { currency: "INR" });
  const cShip = b.number("Shipping Fee", { currency: "INR", integer: true, decimals: 0 });
  const cGst = b.number("GST Amount", { currency: "INR" });
  const cCost = b.number("Cost", { currency: "INR" });
  const cPay = b.string("Payment Method");
  const cStatus = b.string("Order Status");
  const cReason = b.string("Return Reason");
  const cCourier = b.string("Courier");
  const cShipDate = b.date("Ship Date", false);
  const cDelDate = b.date("Delivery Date", false);

  const customers: Customer[] = [];
  const stateWeights = STATES.map((s) => s.w);
  let orderSeq = 4_210_000;
  const totalDays = Math.round((ECOMMERCE_END - ECOMMERCE_START) / DAY_MS) + 1;
  // Continuous daily rate for about 45% more orders per year.
  const growth = Math.log(1.45) / 365;

  for (let day = 0; day < totalDays; day++) {
    const t0 = ECOMMERCE_START + day * DAY_MS;
    const d = new Date(t0);
    const sale = SALES.find((s) => t0 >= s.from && t0 <= s.to);
    // Expected orders today: base × growth × month × weekday × sale × ±10% day-to-day noise.
    const lambda =
      25.6 *
      scale *
      Math.exp(growth * day) *
      (MONTH_MULT[d.getUTCMonth()] as number) *
      (DOW_MULT[(d.getUTCDay() + 6) % 7] as number) *
      (sale?.mult ?? 1) *
      rng.float(0.9, 1.1);
    const n = poisson(rng, lambda);
    const daysLeft = totalDays - 1 - day;

    for (let o = 0; o < n; o++) {
      // Customer: new or returning (tournament pick favouring loyal, recently active customers).
      // Until 50 customers exist every order brings a new one; after that the new-customer share falls
      // from 66% to a 42% floor as the base matures. A returning customer must have last ordered
      // before today; the newest customer is the fallback.
      const pNew = Math.max(0.42, 0.66 - day / 2600);
      let cust: Customer;
      if (customers.length < 50 || rng.chance(pNew)) {
        const state = rng.weighted(STATES, stateWeights);
        const [city, prefix] = rng.pick(state.cities);
        const r = rng.next();
        cust = {
          id: `CUST-${String(10001 + customers.length).padStart(6, "0")}`,
          state,
          city,
          pincode: `${prefix}${String(rng.int(1, 99)).padStart(3, "0")}`,
          loyalty: r < 0.6 ? 0.5 : r < 0.9 ? 1.6 : 4.2,
          codBias: rng.float(-0.12, 0.12),
          favCat: rng.weighted(CATEGORIES, catWeights),
          last: t0,
          orders: 0,
        };
        customers.push(cust);
      } else {
        let best: Customer | null = null;
        let bestScore = -1;
        for (let k = 0; k < 8; k++) {
          const c = customers[Math.floor(rng.next() * customers.length)] as Customer;
          const recency = Math.exp(-(t0 - c.last) / (110 * DAY_MS)) + 0.12;
          const score = c.loyalty * recency * rng.next();
          if (score > bestScore && c.last < t0) {
            best = c;
            bestScore = score;
          }
        }
        cust = best ?? (customers[customers.length - 1] as Customer);
      }
      const firstOrder = cust.orders === 0;
      cust.orders++;
      cust.last = t0;

      const hour = rng.weighted(HOURS, HOUR_W);
      const ts = t0 + hour * HOUR_MS + rng.int(0, 59) * 60_000 + rng.int(0, 59) * 1000;
      const orderId = `OD${orderSeq++}`;
      const channel = rng.weighted(
        CHANNELS.map((c) => c[0]),
        CHANNELS.map((c) => c[1]),
      );

      // Basket: 1–5 lines, 55% from the favourite category. A repeated product is skipped, not
      // redrawn, so some baskets end up smaller.
      const lines: Array<{ p: Product; qty: number; price: number }> = [];
      const nLines = Math.min(5, rng.geometric(0.38));
      for (let l = 0; l < nLines; l++) {
        const cat = rng.chance(0.55) ? cust.favCat : rng.weighted(CATEGORIES, catWeights);
        const pool = byCat.get(cat) as Product[];
        const p = rng.weighted(
          pool,
          pool.map((x) => x.weight),
        );
        if (lines.some((x) => x.p === p)) continue;
        const qty = rng.chance(0.82) ? 1 : rng.chance(0.75) ? 2 : 3;
        const price = sale ? Math.round((p.price * (sale.pct ? 1 : 0.95)) / 1) : p.price;
        lines.push({ p, qty, price });
      }
      const gross = lines.reduce((s, x) => s + x.qty * x.price, 0);

      // Coupon: WELCOME10 on 55% of first orders, the sale coupon on 42% of sale orders, FLAT200 on 14% of
      // baskets from ₹1,499, else FREESHIP 4% of the time; discounts are capped per coupon. Orders under
      // ₹499 after discount pay ₹49 shipping unless FREESHIP.
      let coupon: string | null = null;
      let couponPct = 0;
      if (firstOrder && rng.chance(0.55)) {
        coupon = "WELCOME10";
        couponPct = 0.1;
      } else if (sale?.coupon && rng.chance(0.42)) {
        coupon = sale.coupon;
        couponPct = sale.pct ?? 0;
      } else if (gross >= 1499 && rng.chance(0.14)) {
        coupon = "FLAT200";
        couponPct = 200 / gross;
      } else if (rng.chance(0.04)) coupon = "FREESHIP";
      const maxDisc = coupon === "WELCOME10" ? 300 : coupon === "DIWALI25" ? 750 : 600;
      const orderDiscount = Math.min(gross * couponPct, maxDisc);
      const shipping = gross - orderDiscount < 499 && coupon !== "FREESHIP" ? 49 : 0;

      // Payment: COD propensity by city tier, higher on first orders, lower on marketplaces, plus the
      // customer's own bias, clamped to 8–85%. EMI needs a basket of at least ₹3,000.
      const codP = Math.min(
        0.85,
        Math.max(0.08, [0, 0.32, 0.48, 0.62][cust.state.tier] as number) +
          (firstOrder ? 0.08 : -0.04) +
          cust.codBias +
          (channel === "Amazon" || channel === "Flipkart" ? -0.1 : 0),
      );
      let payment = rng.chance(codP)
        ? "COD"
        : rng.weighted(
            PREPAID.map((p) => p[0]),
            PREPAID.map((p) => p[1]),
          );
      if (payment === "EMI" && gross < 3000) payment = "UPI";
      const isCod = payment === "COD";
      const courier = rng.weighted(
        COURIERS,
        COURIERS.map((c) => c.w),
      );

      // Outcome at order level: cancellation (likelier for COD), then RTO (return to origin: undelivered
      // parcels, far likelier for COD in lower tiers, scaled by courier); orders from the last 6 days are
      // still in transit.
      let outcome: "cancelled" | "rto" | "delivered" | "transit" = "delivered";
      const cancelP = (isCod ? 0.07 : 0.025) + (isCod && gross > 4000 ? 0.03 : 0);
      if (rng.chance(cancelP)) outcome = "cancelled";
      else {
        const baseRto = isCod ? ([0, 0.095, 0.16, 0.23][cust.state.tier] as number) : 0.024;
        if (rng.chance(baseRto * courier.rto)) outcome = "rto";
        else if (daysLeft < 6) outcome = "transit";
      }
      // Orders placed from 16:00 ship a day later, plus 0–1 handling days; transit = courier mean plus
      // North-East and tier-3 delays and noise, at least one day. Dates are date-only (midnight).
      const shipDay =
        outcome === "cancelled" ? NaN : t0 + (hour >= 16 ? 1 : 0) * DAY_MS + rng.int(0, 1) * DAY_MS;
      const transit = Math.max(
        1,
        Math.round(
          courier.transit +
            (cust.state.ne ? 2.2 : 0) +
            (cust.state.tier === 3 ? 0.9 : 0) +
            rng.normal(0, 0.9),
        ),
      );
      const deliveryDay = outcome === "delivered" ? shipDay + transit * DAY_MS : NaN;

      // Per line: the order discount is split pro rata to line value; GST is backed out of the
      // GST-inclusive net; returns are decided per delivered line and rise with discount depth and COD.
      // The shipping fee goes on the first line only (shipLeft), so summing the column gives order shipping.
      let shipLeft = shipping;
      for (const line of lines) {
        const lineGross = line.qty * line.price;
        const disc = gross > 0 ? round2((orderDiscount * lineGross) / gross) : 0;
        const net = round2(lineGross - disc);
        const discShare = lineGross > 0 ? disc / lineGross : 0;
        let status: string;
        let reason: string | null = null;
        if (outcome === "cancelled") status = "Cancelled";
        else if (outcome === "rto") status = "RTO";
        else if (outcome === "transit") status = daysLeft < 2 ? "Shipped" : "In Transit";
        else {
          const returnP = line.p.cat.returnP * (1 + 2.2 * discShare) * (isCod ? 1.15 : 1);
          if (rng.chance(returnP)) {
            status = "Returned";
            reason = rng.weighted(
              line.p.cat.reasons.map((r) => r[0]),
              line.p.cat.reasons.map((r) => r[1]),
            );
          } else status = "Delivered";
        }
        const gstRate = line.p.cat.gst;
        cOrderId(orderId);
        cOrderDate(ts);
        cCustomer(cust.id);
        cCity(cust.city);
        cState(cust.state.name);
        cPin(cust.pincode);
        cChannel(channel);
        cCategory(line.p.cat.name);
        cSub(line.p.sub.name);
        cBrand(line.p.brand);
        cSku(line.p.sku);
        cProduct(line.p.name);
        cQty(line.qty);
        cMrp(line.p.mrp);
        cPrice(line.price);
        cGross(lineGross);
        cDiscount(disc);
        cCoupon(coupon);
        cNet(net);
        cShip(shipLeft);
        shipLeft = 0;
        cGst(round2(net - net / (1 + gstRate)));
        cCost(round2(lineGross * line.p.cat.costRatio * rng.float(0.92, 1.08)));
        cPay(payment);
        cStatus(status);
        cReason(reason);
        cCourier(outcome === "cancelled" ? null : courier.name);
        cShipDate(Number.isNaN(shipDay) ? null : shipDay);
        cDelDate(Number.isNaN(deliveryDay) ? null : deliveryDay);
      }
    }
  }
  return b.finish({
    id: "sample_ecommerce",
    name: "Demo · D2C e-commerce orders",
    fileName: "demo-ecommerce-orders.csv",
    sampleId: "ecommerce",
  });
}
