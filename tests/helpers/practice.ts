/**
 * Practice tables with planted relationships, for the data-first tests
 * (tests/understand.test.ts, tests/data-first-dashboards.test.ts): the
 * well-known layouts analysts learn on (wine quality, Titanic, Telco churn,
 * IBM HR attrition, house prices, iris, weather in Australia), an order-line
 * table and a lookup of country codes, each drawn from a seeded generator so
 * every run builds the same file. What moves each outcome is planted on
 * purpose (alcohol lifts a wine's quality, a month-to-month contract
 * churns), so the tests can check that Loupe finds it; every figure they
 * check is then worked out again from the rows.
 */
import { rng } from "./layouts";

type Cell = string | number;

/** CSV text of a header row and data rows (values with commas or quotes are quoted). */
export function csvOf(rows: Cell[][]): string {
  return rows
    .map((r) =>
      r
        .map((c) => (typeof c === "string" && /[,"]/.test(c) ? `"${c.replace(/"/g, '""')}"` : String(c)))
        .join(","),
    )
    .join("\n");
}

/** A standard normal draw (Box–Muller) from a uniform generator. */
function normal(r: () => number): number {
  const u = Math.max(1e-12, r());
  const v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
const fixed = (v: number, d: number) => v.toFixed(d);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** A practice table: its file name and rows. */
export interface Practice {
  fileName: string;
  rows: Cell[][];
  csv: string;
}

const make = (fileName: string, rows: Cell[][]): Practice => ({ fileName, rows, csv: csvOf(rows) });

/** White wines: quality (3–9) rises with alcohol and falls with density and volatile acidity. */
export function wine(n = 1600, fileName = "winequality-white.csv"): Practice {
  const r = rng(101);
  const rows: Cell[][] = [
    [
      "fixed acidity",
      "volatile acidity",
      "citric acid",
      "residual sugar",
      "chlorides",
      "free sulfur dioxide",
      "total sulfur dioxide",
      "density",
      "pH",
      "sulphates",
      "alcohol",
      "quality",
    ],
  ];
  for (let i = 0; i < n; i++) {
    const z = normal(r);
    const alcohol = clamp(10.5 + 1.2 * z + 0.4 * normal(r), 8, 14.2);
    const density = 0.994 - 0.0022 * z + 0.0012 * normal(r);
    const volatile = clamp(0.28 - 0.03 * normal(r) - 0.02 * z, 0.08, 1.1);
    const quality = clamp(Math.round(5.9 + 0.45 * z + 0.45 * normal(r) - 2 * (volatile - 0.28)), 3, 9);
    rows.push([
      fixed(6.8 + 0.8 * normal(r), 1),
      fixed(volatile, 2),
      fixed(clamp(0.33 + 0.12 * normal(r), 0, 1.2), 2),
      fixed(clamp(6 + 5 * normal(r) - 2 * z, 0.6, 30), 1),
      fixed(clamp(0.045 + 0.02 * normal(r), 0.01, 0.3), 3),
      Math.round(clamp(35 + 15 * normal(r), 2, 120)),
      Math.round(clamp(138 + 40 * normal(r) - 10 * z, 9, 400)),
      fixed(density, 5),
      fixed(3.19 + 0.15 * normal(r), 2),
      fixed(clamp(0.49 + 0.11 * normal(r), 0.2, 1.1), 2),
      fixed(alcohol, 1),
      quality,
    ]);
  }
  return make(fileName, rows);
}

/** Titanic passengers: Sex drives survival, then the class (1st best) and age (children first). */
export function titanic(n = 891): Practice {
  const r = rng(202);
  const rows: Cell[][] = [
    [
      "PassengerId",
      "Survived",
      "Pclass",
      "Name",
      "Sex",
      "Age",
      "SibSp",
      "Parch",
      "Ticket",
      "Fare",
      "Cabin",
      "Embarked",
    ],
  ];
  for (let i = 0; i < n; i++) {
    const female = r() < 0.36;
    const pclass = r() < 0.24 ? 1 : r() < 0.27 ? 2 : 3;
    const age = clamp(Math.round(29 + 13 * normal(r) + (pclass === 1 ? 8 : 0)), 1, 80);
    const p =
      (female ? 0.72 : 0.18) + (pclass === 1 ? 0.18 : pclass === 2 ? 0.05 : -0.08) + (age < 12 ? 0.2 : 0);
    const survived = r() < clamp(p, 0.02, 0.97) ? 1 : 0;
    const fare = pclass === 1 ? 60 + 60 * r() : pclass === 2 ? 15 + 15 * r() : 7 + 9 * r();
    rows.push([
      i + 1,
      survived,
      pclass,
      `Passenger ${i + 1}, ${female ? "Mrs." : "Mr."} Test`,
      female ? "female" : "male",
      r() < 0.2 ? "" : age,
      r() < 0.7 ? 0 : 1 + Math.floor(r() * 3),
      r() < 0.75 ? 0 : 1 + Math.floor(r() * 2),
      `T${100000 + Math.floor(r() * 899999)}`,
      fixed(fare, 4),
      r() < 0.77 ? "" : `C${Math.floor(r() * 120)}`,
      r() < 0.72 ? "S" : r() < 0.7 ? "C" : "Q",
    ]);
  }
  return make("titanic.csv", rows);
}

/** Telco customers: the contract drives churn (month-to-month churns), then tenure (long tenure stays). */
export function telco(n = 1500): Practice {
  const r = rng(303);
  const rows: Cell[][] = [
    [
      "customerID",
      "gender",
      "SeniorCitizen",
      "Partner",
      "Dependents",
      "tenure",
      "PhoneService",
      "InternetService",
      "Contract",
      "PaperlessBilling",
      "PaymentMethod",
      "MonthlyCharges",
      "TotalCharges",
      "Churn",
    ],
  ];
  for (let i = 0; i < n; i++) {
    const contract = r() < 0.55 ? "Month-to-month" : r() < 0.5 ? "One year" : "Two year";
    const tenure = Math.round(
      clamp(
        contract === "Month-to-month"
          ? 14 + 14 * r() * 2
          : contract === "One year"
            ? 30 + 30 * r()
            : 45 + 27 * r(),
        0,
        72,
      ),
    );
    const internet = r() < 0.44 ? "Fiber optic" : r() < 0.6 ? "DSL" : "No";
    const monthly = (internet === "Fiber optic" ? 80 : internet === "DSL" ? 55 : 22) + 15 * r();
    const base = contract === "Month-to-month" ? 0.44 : contract === "One year" ? 0.11 : 0.03;
    const churn = r() < clamp(base + (tenure < 6 ? 0.12 : 0) - tenure * 0.002, 0.01, 0.9);
    rows.push([
      `${1000 + i}-ABCDE`,
      r() < 0.5 ? "Female" : "Male",
      r() < 0.16 ? 1 : 0,
      r() < 0.48 ? "Yes" : "No",
      r() < 0.3 ? "Yes" : "No",
      tenure,
      r() < 0.9 ? "Yes" : "No",
      internet,
      contract,
      r() < 0.59 ? "Yes" : "No",
      pick(r, ["Electronic check", "Mailed check", "Bank transfer (automatic)", "Credit card (automatic)"]),
      fixed(monthly, 2),
      fixed(monthly * Math.max(1, tenure), 2),
      churn ? "Yes" : "No",
    ]);
  }
  return make("WA_Fn-UseC_-Telco-Customer-Churn.csv", rows);
}

/**
 * IBM HR employees: overtime drives attrition, then the job level (juniors
 * leave). With `hired`, each employee also has a hire date (an attribute, not
 * a timeline), so the HR template fits strongly, and frequent travellers
 * leave far more often: a driver no HR chart shows.
 */
export function hrAttrition(n = 1470, hired = false): Practice {
  const r = rng(404);
  const rows: Cell[][] = [
    [
      ...(hired ? ["Hire Date"] : []),
      "Age",
      "Attrition",
      "BusinessTravel",
      "Department",
      "DistanceFromHome",
      "Education",
      "EmployeeNumber",
      "EnvironmentSatisfaction",
      "Gender",
      "JobLevel",
      "JobRole",
      "JobSatisfaction",
      "MaritalStatus",
      "MonthlyIncome",
      "OverTime",
      "TotalWorkingYears",
      "YearsAtCompany",
    ],
  ];
  for (let i = 0; i < n; i++) {
    const level = r() < 0.37 ? 1 : r() < 0.6 ? 2 : r() < 0.6 ? 3 : r() < 0.6 ? 4 : 5;
    const overtime = r() < 0.28;
    const travel = pick(r, ["Travel_Rarely", "Travel_Frequently", "Non-Travel"]);
    const age = Math.round(clamp(26 + level * 4 + 6 * normal(r), 18, 60));
    const p =
      (overtime ? 0.31 : 0.08) +
      (level === 1 ? 0.12 : level === 2 ? 0.02 : -0.03) +
      (hired && travel === "Travel_Frequently" ? 0.45 : 0);
    const left = r() < clamp(p, 0.01, 0.9);
    const years = Math.round(clamp(level * 3 + 4 * r(), 0, 40));
    const hire = Date.UTC(2026, 0, 1) - (years * 365 + Math.floor(r() * 300)) * 86_400_000;
    rows.push([
      ...(hired ? [new Date(hire).toISOString().slice(0, 10)] : []),
      age,
      left ? "Yes" : "No",
      travel,
      pick(r, ["Research & Development", "Sales", "Human Resources"]),
      Math.round(1 + 28 * r()),
      1 + Math.floor(r() * 5),
      i + 1 + Math.floor(i / 3),
      1 + Math.floor(r() * 4),
      r() < 0.6 ? "Male" : "Female",
      level,
      pick(r, [
        "Sales Executive",
        "Research Scientist",
        "Laboratory Technician",
        "Manager",
        "Healthcare Representative",
      ]),
      1 + Math.floor(r() * 4),
      pick(r, ["Single", "Married", "Divorced"]),
      Math.round(2000 + level * 3500 + 1500 * r()),
      overtime ? "Yes" : "No",
      years + Math.round(4 * r()),
      years,
    ]);
  }
  return make("WA_Fn-UseC_-HR-Employee-Attrition.csv", rows);
}

const NEIGHBOURHOODS = [
  "NAmes",
  "CollgCr",
  "OldTown",
  "Edwards",
  "Somerst",
  "Gilbert",
  "NridgHt",
  "Sawyer",
  "NWAmes",
  "SawyerW",
  "BrkSide",
  "Crawfor",
  "Mitchel",
  "NoRidge",
  "Timber",
];

/** Houses: the sale price rises with living area and overall quality, and differs by neighbourhood. */
export function housePrices(n = 1460): Practice {
  const r = rng(505);
  const rows: Cell[][] = [
    [
      "Id",
      "MSZoning",
      "LotArea",
      "Neighborhood",
      "OverallQual",
      "YearBuilt",
      "GrLivArea",
      "GarageCars",
      "SalePrice",
    ],
  ];
  for (let i = 0; i < n; i++) {
    const hood = NEIGHBOURHOODS[i % NEIGHBOURHOODS.length] as string;
    const premium =
      hood === "NoRidge" || hood === "NridgHt"
        ? 60000
        : hood === "OldTown" || hood === "Edwards"
          ? -30000
          : 0;
    const qual = clamp(Math.round(6 + 1.4 * normal(r)), 1, 10);
    const area = Math.round(clamp(1500 + 450 * normal(r) + 120 * (qual - 6), 500, 4500));
    const price = Math.round(
      clamp(20000 + 60 * area + 14000 * (qual - 6) + premium + 25000 * normal(r), 35000, 700000),
    );
    rows.push([
      i + 1,
      pick(r, ["RL", "RM", "FV", "RH"]),
      Math.round(clamp(10000 + 4000 * normal(r), 1300, 50000)),
      hood,
      qual,
      Math.round(1900 + 110 * r()),
      area,
      Math.floor(r() * 4),
      price,
    ]);
  }
  return make("house_prices.csv", rows);
}

/** Order lines of a shop over a year: date, region, category and amount (a table of transactions). */
export function orderLines(n = 1200): Practice {
  const r = rng(606);
  const rows: Cell[][] = [
    ["Order ID", "Order Date", "Region", "Category", "Product", "Quantity", "Unit Price", "Amount"],
  ];
  const CATS: Array<[string, number]> = [
    ["Electronics", 900],
    ["Furniture", 450],
    ["Office Supplies", 40],
    ["Clothing", 60],
  ];
  for (let i = 0; i < n; i++) {
    const [cat, price] = pick(r, CATS);
    const qty = 1 + Math.floor(r() * 4);
    const unit = Math.round(price * (0.7 + 0.6 * r()));
    const day = Date.UTC(2025, 0, 1) + Math.floor(r() * 365) * 86_400_000;
    rows.push([
      `SO-${10000 + Math.floor(i / 2)}`,
      new Date(day).toISOString().slice(0, 10),
      pick(r, ["North", "South", "East", "West"]),
      cat,
      `${cat} item ${1 + Math.floor(r() * 12)}`,
      qty,
      unit,
      qty * unit,
    ]);
  }
  return make("orders.csv", rows);
}

/** Iris flowers: petal length separates the three species. */
export function iris(perSpecies = 100): Practice {
  const r = rng(707);
  const rows: Cell[][] = [["sepal_length", "sepal_width", "petal_length", "petal_width", "species"]];
  const SPECIES: Array<[string, number, number, number, number]> = [
    ["setosa", 5.0, 3.4, 1.46, 0.25],
    ["versicolor", 5.9, 2.8, 4.26, 1.33],
    ["virginica", 6.6, 3.0, 5.55, 2.03],
  ];
  for (const [name, sl, sw, pl, pw] of SPECIES)
    for (let i = 0; i < perSpecies; i++)
      rows.push([
        fixed(sl + 0.4 * normal(r), 1),
        fixed(sw + 0.35 * normal(r), 1),
        fixed(pl + 0.3 * normal(r), 1),
        fixed(Math.max(0.1, pw + 0.15 * normal(r)), 1),
        name,
      ]);
  return make("iris.csv", rows);
}

const PLACES = [
  "Albury",
  "Sydney",
  "Perth",
  "Darwin",
  "Hobart",
  "Cairns",
  "Melbourne",
  "Brisbane",
  "Adelaide",
  "Canberra",
];

/** Weather in Australia: rain tomorrow follows afternoon humidity, and sunshine keeps it away. */
export function weather(days = 200): Practice {
  const r = rng(808);
  const rows: Cell[][] = [
    [
      "Date",
      "Location",
      "MinTemp",
      "MaxTemp",
      "Rainfall",
      "Humidity3pm",
      "Sunshine",
      "RainToday",
      "RainTomorrow",
    ],
  ];
  for (let d = 0; d < days; d++)
    for (const place of PLACES) {
      const wet = normal(r);
      const humidity = Math.round(clamp(50 + 18 * wet + 8 * normal(r), 5, 100));
      const sunshine = clamp(7.5 - 2.5 * wet + 1.5 * normal(r), 0, 13.5);
      const minT = 12 + 6 * normal(r);
      const tomorrow = r() < clamp(0.22 + 0.2 * wet, 0.01, 0.95);
      const today = r() < clamp(0.2 + 0.12 * wet, 0.01, 0.95);
      rows.push([
        new Date(Date.UTC(2016, 0, 1) + d * 86_400_000).toISOString().slice(0, 10),
        place,
        fixed(minT, 1),
        fixed(minT + 10 + 3 * normal(r), 1),
        today ? fixed(1 + 8 * r(), 1) : "0",
        humidity,
        fixed(sunshine, 1),
        today ? "Yes" : "No",
        tomorrow ? "Yes" : "No",
      ]);
    }
  return make("weatherAUS.csv", rows);
}

/** A lookup of country codes: one row per country, with nothing to measure. */
export function countryCodes(): Practice {
  const rows: Cell[][] = [["ISO2", "ISO3", "Country", "Region", "Subregion"]];
  const REGIONS: Array<[string, string]> = [
    ["Asia", "Southern Asia"],
    ["Europe", "Western Europe"],
    ["Africa", "Eastern Africa"],
    ["Americas", "South America"],
    ["Oceania", "Australia and New Zealand"],
  ];
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (let i = 0; i < 240; i++) {
    const a = letters[Math.floor(i / 26) % 26] as string;
    const b = letters[i % 26] as string;
    const [region, sub] = REGIONS[i % REGIONS.length] as [string, string];
    rows.push([`${a}${b}`, `${a}${b}${letters[(i * 7) % 26]}`, `Country ${a}${b}`, region, sub]);
  }
  return make("country_codes.csv", rows);
}
