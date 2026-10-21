/**
 * "What this data is about" on Detect (version 49.0): the words of the panel
 * (ui/workspace/understanding/aboutWords.ts) and the store behind it
 * (store/workspace.ts), with the worker client replaced by a real Session on
 * this thread.
 *
 * The words: what one row is with the counts and dates, the outcome select's
 * options (Loupe's choice, the other candidates, kept after the user picks
 * another or none, never a hidden column), each driver's statistic with a
 * true minus sign, the columns grouped by kind and folded on a wide table,
 * the "Read as …" kinds and the industry label.
 *
 * The store: the reading comes with the load; on Detect, before anything is
 * built, choosing the outcome, reading a column as another kind, hiding a
 * column or choosing an industry reads the table again and never builds the
 * analysis; once built, the analysis's own reading is the store's, and the
 * outcome goes with every configure. The outcome is saved with a config and
 * restored from it, and a new file starts with Loupe's choice again.
 */
import { describe, expect, it, vi } from "vitest";
import type { ContextRequest, UnderstandRequest } from "@/engine/session";
import type { IngestOptions } from "@/engine/core/types";
import type { ColumnUnderstanding, DataUnderstanding, Driver } from "@/engine/understand/types";
import { roleForKind, SETTABLE_KINDS } from "@/engine/understand/kinds";
import { parseConfig } from "@/engine/export/config";
import {
  FOLDED_PER_GROUP,
  KIND_ORDER,
  directionWords,
  groupColumns,
  industryWords,
  outcomeFromValue,
  outcomeOptions,
  outcomeValue,
  readAsKinds,
  rowLine,
  statLabel,
  strengthPct,
  timeSpan,
} from "@/ui/workspace/understanding/aboutWords";
import { useWorkspace } from "@/store/workspace";
import { rng } from "./helpers/layouts";

/** What the "worker" was asked, in order. */
const calls = vi.hoisted(() => ({
  configure: [] as ContextRequest[],
  understand: [] as UnderstandRequest[],
}));

// Hoisted above the imports by vitest, so the store talks to this instead of a Web Worker.
vi.mock("@/lib/engine-client", async () => {
  const { Session } = await import("@/engine/session");
  let session = new Session();
  const api = {
    ingest: async (file: File, opts: IngestOptions) => session.ingest(file, file.name, opts),
    ingestSample: async (id: string) => session.ingestSample(id),
    configure: async (req: ContextRequest) => {
      calls.configure.push(req);
      return session.configure(req);
    },
    understand: async (req: UnderstandRequest) => {
      calls.understand.push(req);
      return session.understand(req);
    },
    begin: async () => {},
    // Dashboard refreshes are not under test; report them as superseded.
    computeDashboard: async () => ({ aborted: true, ms: 0, rows: 0 }),
    insights: async () => [],
  };
  return {
    engine: () => api,
    resetEngine: () => {
      session = new Session();
    },
    Comlink: { proxy: <T>(f: T): T => f },
  };
});

// ---------------------------------------------------------------- the words

const col = (name: string, kind: ColumnUnderstanding["kind"], importance = 0.5): ColumnUnderstanding => ({
  name,
  kind,
  importance,
  why: `${name} is read as ${kind}.`,
});

/** A reading as the engine shapes one; the figures here only test the wording around them. */
function reading(over: Partial<DataUnderstanding> = {}): DataUnderstanding {
  return {
    subject: {
      noun: "wine sample",
      plural: "wine samples",
      rowMeaning: "One row per wine sample",
      rows: 4898,
      nounSource: "sheet name",
    },
    columns: [
      col("Id", "id", 0.05),
      col("alcohol", "measurement", 0.44),
      col("density", "measurement", 0.31),
      col("pH", "measurement", 0.1),
      col("quality", "outcome", 1),
      col("colour", "category", 0.2),
    ],
    outcome: {
      column: "quality",
      type: "ordinal",
      why: "A rating on a short scale.",
      alternatives: ["alcohol"],
    },
    drivers: [],
    relations: [],
    time: null,
    issues: [],
    industry: null,
    title: "Wine quality analysis",
    sentences: ["4,898 wine samples."],
    ...over,
  };
}

describe("the panel's words", () => {
  it("say what one row is, with the counts and the dates the rows span", () => {
    expect(rowLine(reading(), 13, "INTL")).toBe("One row per wine sample · 4,898 rows · 13 columns");
    expect(rowLine(reading({ subject: { ...reading().subject, rows: 1 } }), 1, "INTL")).toBe(
      "One row per wine sample · 1 row · 1 column",
    );
    const time = { column: "Order Date", from: Date.UTC(2023, 0, 4), to: Date.UTC(2025, 9, 30) };
    expect(timeSpan({ ...time, grain: "month" })).toBe("Order Date: Jan 2023 – Oct 2025");
    expect(timeSpan({ ...time, grain: "quarter" })).toBe("Order Date: Q1 2023 – Q4 2025");
    expect(timeSpan({ ...time, grain: "day" })).toBe("Order Date: 4 Jan 2023 – 30 Oct 2025");
    expect(timeSpan({ ...time, to: Date.UTC(2023, 0, 20), grain: "month" })).toBe("Order Date: Jan 2023");
    expect(timeSpan(null)).toBeNull();
    expect(rowLine(reading({ time: { ...time, grain: "year" } }), 13, "INTL")).toBe(
      "One row per wine sample · 4,898 rows · 13 columns · Order Date: 2023 – 2025",
    );
  });

  it("write each statistic as the analyst standards do, with a true minus sign", () => {
    const d = (method: Driver["method"], value: number) => ({ method, value });
    expect(statLabel(d("correlation", 0.4412), "INTL")).toBe("r = 0.44");
    expect(statLabel(d("correlation", -0.307), "INTL")).toBe("r = −0.31");
    expect(statLabel(d("correlation", -0.001), "INTL")).toBe("r = 0.00");
    expect(statLabel(d("group-means", 0.534), "INTL")).toBe("η = 0.53");
    expect(statLabel(d("association", 0.3), "INTL")).toBe("V = 0.30");
    expect(directionWords({ column: "alcohol", direction: "up" }, "quality")).toBe(
      "quality rises with alcohol",
    );
    expect(directionWords({ column: "density", direction: "down" }, "quality")).toBe(
      "quality falls as density rises",
    );
    expect(directionWords({ column: "Sex", direction: "mixed" }, "Survived")).toBe(
      "Survived differs across Sex",
    );
    expect([strengthPct(0.444), strengthPct(1.4), strengthPct(-1), strengthPct(Number.NaN)]).toEqual([
      44, 100, 0, 0,
    ]);
  });

  it("offer Loupe's choice, the other candidates and keep them after another pick", () => {
    const u = reading();
    // Loupe's choice is named while it is in effect; the alternatives and the load's candidates follow.
    expect(outcomeOptions(u, undefined, ["quality", "alcohol", "density"])).toEqual([
      { value: "auto", label: "quality", hint: "Loupe's choice" },
      { value: "col:alcohol", label: "alcohol" },
      { value: "col:density", label: "density" },
    ]);
    // With no outcome chosen, the reading has none: the candidates found on loading stay on offer.
    const none = reading({ outcome: null });
    expect(outcomeOptions(none, null, ["quality", "alcohol"])).toEqual([
      { value: "auto", label: "Let Loupe choose" },
      { value: "col:quality", label: "quality" },
      { value: "col:alcohol", label: "alcohol" },
    ]);
    // The user's own pick is listed, and a candidate no longer in the reading (hidden) is not.
    const picked = reading({
      columns: reading().columns.filter((c) => c.name !== "density"),
      outcome: { column: "alcohol", type: "amount", why: "", alternatives: ["quality"] },
    });
    expect(outcomeOptions(picked, "alcohol", ["quality", "alcohol", "density"]).map((o) => o.value)).toEqual([
      "auto",
      "col:alcohol",
      "col:quality",
    ]);
    expect(outcomeOptions(reading({ outcome: null }), undefined, [])[0]).toEqual({
      value: "auto",
      label: "None found",
      hint: "Loupe's choice",
    });
    for (const chosen of [undefined, null, "quality"])
      expect(outcomeFromValue(outcomeValue(chosen))).toBe(chosen);
  });

  it("group the columns by kind, the most important first, and fold a wide table", () => {
    const groups = groupColumns(reading().columns);
    expect(groups.map((g) => g.kind)).toEqual(["outcome", "measurement", "category", "id"]);
    expect(groups.find((g) => g.kind === "measurement")?.columns.map((c) => c.name)).toEqual([
      "alcohol",
      "density",
      "pH",
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Outcome", "Measurements", "Categories", "IDs"]);
    const wide = Array.from({ length: 20 }, (_, i) => col(`m${i}`, "measurement", 0.5));
    const folded = groupColumns(wide, FOLDED_PER_GROUP);
    expect(folded[0]?.columns).toHaveLength(FOLDED_PER_GROUP);
    expect(folded[0]?.more).toBe(20 - FOLDED_PER_GROUP);
    // Ties keep the file's order.
    expect(folded[0]?.columns.map((c) => c.name)).toEqual(["m0", "m1", "m2", "m3", "m4", "m5"]);
    expect(new Set(KIND_ORDER).size).toBe(11);
  });

  it("offer every kind that can be set, and show a date or the outcome as it is", () => {
    expect(readAsKinds("measurement").map((k) => k.kind)).toEqual([...SETTABLE_KINDS]);
    const forDate = readAsKinds("time");
    expect(forDate[0]).toEqual({ kind: "time", label: "Date", settable: false });
    expect(forDate.slice(1).every((k) => k.settable)).toBe(true);
    // Every kind offered stands for a role override.
    for (const kind of SETTABLE_KINDS) expect(roleForKind(kind), kind).not.toBeNull();
  });

  it("label the industry with its match and the columns it explains", () => {
    const fit = (mapped: number, weak: boolean) => ({ mapped, columns: 12, weak });
    const strong = industryWords(
      { id: "ecommerce", name: "E-commerce", confidence: 92, fit: fit(9, false) },
      "ecommerce",
      "INTL",
    );
    expect(strong).toMatchObject({
      name: "E-commerce",
      detail: "92% match · explains 9 of 12 columns",
      weak: false,
    });
    const weak = industryWords(
      { id: "pharma", name: "Pharma", confidence: 21, fit: fit(1, true) },
      "pharma",
      "INTL",
    );
    expect(weak.weak).toBe(true);
    expect(weak.full).toContain("designed from the data");
    expect(industryWords({ id: "x", name: "X", confidence: 40, fit: fit(0, true) }, "x", "INTL").detail).toBe(
      "40% match · explains none of 12 columns",
    );
    expect(industryWords(null, "ecommerce", "INTL").name).toBe("No industry fits");
    expect(industryWords(strong as never, "generic", "INTL").name).toBe("No industry");
  });
});

// ---------------------------------------------------------------- the store

/** A Titanic-like passenger list: survival planted on Sex, then class and age. Seeded, so it never changes. */
function passengers(n = 600): File {
  const r = rng(49);
  const lines = ["PassengerId,Survived,Pclass,Name,Sex,Age,SibSp,Parch,Fare,Embarked"];
  for (let i = 0; i < n; i++) {
    const female = r() < 0.36;
    const pclass = r() < 0.25 ? 1 : r() < 0.35 ? 2 : 3;
    const age = Math.round(2 + r() * 70);
    const p =
      (female ? 0.74 : 0.19) + (pclass === 1 ? 0.12 : pclass === 3 ? -0.08 : 0) - (age > 50 ? 0.06 : 0);
    const survived = r() < Math.min(0.97, Math.max(0.02, p)) ? 1 : 0;
    const fare = (pclass === 1 ? 60 : pclass === 2 ? 20 : 8) + Math.round(r() * 3000) / 100;
    lines.push(
      [
        i + 1,
        survived,
        pclass,
        `"Passenger ${i + 1}, Mr"`,
        female ? "female" : "male",
        age,
        Math.floor(r() * 3),
        Math.floor(r() * 3),
        fare.toFixed(2),
        ["S", "C", "Q"][Math.floor(r() * 3)],
      ].join(","),
    );
  }
  return new File([`${lines.join("\n")}\n`], "titanic.csv", { type: "text/csv" });
}

const ws = () => useWorkspace.getState();

/** Loads the passenger list and clears what the "worker" was asked so far. */
async function loadPassengers() {
  ws().startOver();
  await ws().loadFile(passengers());
  calls.configure.length = 0;
  calls.understand.length = 0;
  expect(ws().step).toBe("detect");
}

describe("the store behind the panel", () => {
  it("takes the reading that came with the file, with Loupe's choice of outcome", async () => {
    await loadPassengers();
    const u = ws().understanding;
    expect(u).not.toBeNull();
    expect(ws().outcome).toBeUndefined();
    expect(ws().outcomeChoices).toEqual(u?.outcome ? [u.outcome.column, ...u.outcome.alternatives] : []);
    expect(ws().context).toBeNull();
  });

  it("reads the table again on Detect, never building the analysis there", async () => {
    await loadPassengers();
    ws().setOutcome("Fare");
    await vi.waitFor(() => expect(ws().understandingPending).toBe(false));
    expect(calls.understand.at(-1)).toMatchObject({ outcome: "Fare", domainId: ws().domainId });
    expect(ws().understanding?.outcome?.column).toBe("Fare");

    // "Read as …": the kind travels with the role override it stands for.
    const o = roleForKind("category");
    if (!o) throw new Error("category has a role");
    ws().setRoleOverride("SibSp", o.role, o.additivity, o.kind);
    await vi.waitFor(() => expect(calls.understand).toHaveLength(2));
    expect(calls.understand[1]?.roleOverrides?.SibSp).toEqual({ role: "dimension", kind: "category" });

    ws().setColumnsHidden(["Fare"], true);
    await vi.waitFor(() => expect(calls.understand).toHaveLength(3));
    expect(calls.understand[2]?.hiddenColumns).toEqual(["Fare"]);
    expect(ws().understanding?.columns.some((c) => c.name === "Fare")).toBe(false);

    ws().chooseIndustry("generic", null);
    await vi.waitFor(() => expect(calls.understand).toHaveLength(4));
    expect(calls.understand[3]?.domainId).toBe("generic");
    await vi.waitFor(() => expect(ws().understandingPending).toBe(false));
    expect(ws().understanding?.industry).toBeNull();

    // Nothing was built behind the user's back.
    expect(calls.configure).toHaveLength(0);
    expect(ws().context).toBeNull();
    expect(ws().step).toBe("detect");
  });

  it("sends the outcome with every configure, and keeps the analysis's own reading", async () => {
    await loadPassengers();
    ws().setOutcome(null);
    await vi.waitFor(() => expect(ws().understandingPending).toBe(false));
    await ws().confirmDomain(ws().domainId as string, ws().subDomainId, { goTo: "dashboard" });
    expect(calls.configure.at(-1)?.outcome).toBeNull();
    expect(ws().understanding).toEqual(ws().context?.understanding);
    expect(ws().understanding?.outcome).toBeNull();

    // Once built, choosing the outcome rebuilds the analysis around it.
    ws().setOutcome("Survived");
    await vi.waitFor(() => expect(calls.configure.at(-1)?.outcome).toBe("Survived"));
    await vi.waitFor(() => expect(ws().configuring).toBe(false));
    expect(ws().understanding).toEqual(ws().context?.understanding);
    expect(ws().context?.understanding.outcome?.column).toBe("Survived");
  });

  it("lets Loupe choose again when the chosen outcome is hidden", async () => {
    await loadPassengers();
    ws().setOutcome("Fare");
    ws().setColumnsHidden(["Fare"], true);
    expect(ws().outcome).toBeUndefined();
    await vi.waitFor(() => expect(ws().understandingPending).toBe(false));
    expect(calls.understand.at(-1)?.outcome).toBeUndefined();
  });

  it("saves the outcome with a config, restores it, and starts a new file with Loupe's choice", async () => {
    await loadPassengers();
    ws().setOutcome("Survived");
    await ws().confirmDomain(ws().domainId as string, ws().subDomainId, { goTo: "dashboard" });
    const { buildConfig } = await import("@/ui/workspace/ExportStep");
    const cfg = buildConfig();
    expect(cfg?.outcome).toBe("Survived");
    const parsed = parseConfig(JSON.stringify(cfg));
    expect(parsed.config?.outcome).toBe("Survived");

    ws().setOutcome(null);
    await vi.waitFor(() => expect(calls.configure.at(-1)?.outcome).toBeNull());
    await ws().applyConfig(parsed.config as NonNullable<typeof parsed.config>);
    expect(ws().outcome).toBe("Survived");
    expect(calls.configure.at(-1)?.outcome).toBe("Survived");

    // A config saved before the outcome could be chosen: Loupe chooses.
    const { outcome: _omit, ...older } = cfg as NonNullable<typeof cfg>;
    const old = parseConfig(JSON.stringify(older)).config;
    expect(old?.outcome).toBeUndefined();
    await ws().applyConfig(old as NonNullable<typeof old>);
    expect(ws().outcome).toBeUndefined();

    // A new file: Loupe's choice again, and the reading it came with.
    await ws().loadFile(passengers(300));
    expect(ws().outcome).toBeUndefined();
    expect(ws().context).toBeNull();
    expect(ws().understanding?.subject.rows).toBe(300);
    ws().startOver();
    expect(ws().understanding).toBeNull();
  });
});
