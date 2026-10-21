/**
 * Learning from corrections (store/learned.ts, engine/detect/learned.ts and
 * the workspace store's use of them): header signatures match the same file
 * and similar ones but not different ones; a rule applies as overrides,
 * skips columns the file lacks and never beats the session's own choices;
 * learned words improve detection on a header no field knew and change
 * nothing when there are none; the store keeps at most MAX_RULES rules and
 * MAX_WORDS words; and what is learned survives an export and import, while
 * a malformed file is rejected whole. The last block runs the workspace
 * store end to end on a real Session (the worker client replaced, as in
 * workspace-store.test.ts): a correction is learned, the next load of a file
 * like it applies it, and Undo and Forget take it back.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ContextRequest } from "@/engine/session";
import type { IngestOptions } from "@/engine/core/types";
import type { IngestProgress } from "@/engine/parse";
import { tokenize } from "@/engine/profile/names";
import { detectDomain } from "@/engine/detect/detect";
import { assignFields } from "@/engine/detect/match";
import { withLearnedSynonyms, type LearnedSynonym } from "@/engine/detect/learned";
import { DOMAINS, getDomain } from "@/registry";
import type { DomainDef } from "@/registry/schema";
import {
  applyRule,
  appliedNothing,
  describeApplied,
  describeRule,
  exportLearned,
  findRule,
  keepWords,
  MAX_RULES,
  MAX_WORDS,
  mergeLearned,
  newRule,
  parseLearned,
  signatureOf,
  similarity,
  teachClass,
  teachField,
  teachHidden,
  teachIndustry,
  teachRole,
  undoApplied,
  useLearned,
  withRule,
  withWord,
  type LearnedChoices,
  type LearnedRule,
  type LearnedWord,
} from "@/store/learned";
import { useWorkspace } from "@/store/workspace";
import { parseCsv, detect } from "./helpers/layouts";

// Hoisted above the imports by vitest, so the store talks to this instead of a Web Worker.
vi.mock("@/lib/engine-client", async () => {
  const { Session } = await import("@/engine/session");
  let session = new Session();
  const api = {
    ingest: async (
      file: File,
      opts: IngestOptions,
      onProgress?: (p: IngestProgress) => void,
      learned?: LearnedSynonym[],
    ) => session.ingest(file, file.name, opts, onProgress, learned),
    ingestSample: async (id: string) => session.ingestSample(id),
    configure: async (req: ContextRequest) => session.configure(req),
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

/** Column-like objects from header names, read the way the profile reads them. */
const columnsOf = (names: readonly string[]) => names.map((name) => ({ name, tokens: tokenize(name) }));
const sig = (names: readonly string[]) => signatureOf(columnsOf(names));

const ORDER_HEADERS = [
  "Order ID",
  "Order Date",
  "Customer ID",
  "Product Name",
  "Category",
  "Quantity",
  "Unit Price",
  "Discount",
  "Status",
  "Internal Notes",
];

/** No choices yet: what a freshly loaded file starts with. */
const fresh = (domainId = "ecommerce", subDomainId: string | null = "orders"): LearnedChoices => ({
  domainId,
  subDomainId,
  mappingOverrides: {},
  classOverrides: {},
  roleOverrides: {},
  hiddenColumns: [],
});

/** A rule as the workspace would build it, learned on ORDER_HEADERS. */
function orderRule(now = 1_000): LearnedRule {
  let r = newRule(sig(ORDER_HEADERS), ORDER_HEADERS, now);
  r = teachIndustry(r, { domainId: "sales", subDomainId: null, name: "Sales", shape: null });
  r = teachField(r, "sales", "deal_value", { column: "Unit Price", label: "Deal value" });
  r = teachClass(r, "sales", "stage.won", { values: ["Closed"], label: "Stage · Won" });
  r = teachRole(r, "Customer ID", { role: "dimension" });
  r = teachRole(r, "Legacy Code", { role: "identifier" });
  r = teachHidden(r, ["Internal Notes", "Old Notes"], true);
  return r;
}

beforeEach(() => {
  useLearned.setState({ rules: [], words: [] });
});

describe("header signatures", () => {
  it("are the normalised header names, de-duplicated and sorted", () => {
    const a = sig(["Order ID", "Order Date", "Net Amount"]);
    expect(a).toEqual([...a].sort());
    // Case, separators and order don't change what a header is.
    expect(sig(["net_amount", "ORDER DATE", "order id"])).toEqual(a);
    expect(sig(["Order ID", "Order ID", ""])).toEqual(sig(["Order ID"]));
  });

  it("match the same file exactly", () => {
    const rule = orderRule();
    const found = findRule([rule], sig([...ORDER_HEADERS].reverse()));
    expect(found?.rule.id).toBe(rule.id);
    expect(found?.similarity).toBe(1);
  });

  it("match a similar file (Jaccard at least 0.8) and pick the closest rule", () => {
    // One header renamed out of ten: 9 shared of 11 in all.
    const similar = [...ORDER_HEADERS.slice(0, 9), "Coupon Code"];
    expect(similarity(sig(ORDER_HEADERS), sig(similar))).toBeCloseTo(9 / 11, 5);
    const rule = orderRule();
    const exact = { ...newRule(sig(similar), similar, 2_000), hidden: ["Coupon Code"] };
    expect(findRule([rule], sig(similar))?.rule.id).toBe(rule.id);
    expect(findRule([rule, exact], sig(similar))?.rule.id).toBe(exact.id);
  });

  it("do not match a different file", () => {
    const rule = orderRule();
    // Half the headers in common.
    const half = [...ORDER_HEADERS.slice(0, 5), "Ticket ID", "Agent", "Priority", "Opened At", "Channel"];
    expect(similarity(sig(ORDER_HEADERS), sig(half))).toBeLessThan(0.8);
    expect(findRule([rule], sig(half))).toBeNull();
    expect(findRule([rule], sig(["Employee ID", "Department", "Salary"]))).toBeNull();
    expect(findRule([rule], [])).toBeNull();
  });
});

describe("applying a rule", () => {
  const file = { columns: ORDER_HEADERS, domains: ["ecommerce", "sales", "generic"] };

  it("produces the overrides the user would have set", () => {
    const { choices, applied } = applyRule(orderRule(), file, fresh());
    expect(choices.domainId).toBe("sales");
    expect(choices.subDomainId).toBeNull();
    expect(choices.mappingOverrides).toEqual({ deal_value: "Unit Price" });
    expect(choices.classOverrides).toEqual({ "stage.won": ["Closed"] });
    expect(choices.roleOverrides).toEqual({ "Customer ID": { role: "dimension" } });
    expect(choices.hiddenColumns).toEqual(["Internal Notes"]);
    expect(describeApplied(applied)).toBe(
      "industry Sales, 1 field mapping, 1 value meaning, 1 column role, 1 hidden column",
    );
  });

  it("skips what names a column the file lacks, and an industry it doesn't know", () => {
    const { choices, applied } = applyRule(orderRule(), file, fresh());
    expect(choices.roleOverrides).not.toHaveProperty("Legacy Code");
    expect(choices.hiddenColumns).not.toContain("Old Notes");
    expect(applied.hidden).toEqual(["Internal Notes"]);
    // A mapping to a column that isn't there is skipped; so is everything once nothing fits.
    const moved = teachField(orderRule(), "sales", "deal_value", {
      column: "Deal Amount",
      label: "Deal value",
    });
    expect(applyRule(moved, file, fresh()).choices.mappingOverrides).toEqual({});
    const unknown = applyRule(orderRule(), { ...file, domains: ["ecommerce"] }, fresh());
    expect(unknown.applied.industry).toBeNull();
    expect(unknown.choices.domainId).toBe("ecommerce");
    // Mappings and value meanings belong to the industry they were learned for.
    expect(unknown.choices.mappingOverrides).toEqual({});
    // The learned industry with its shape left to detection (Auto) is no change on a file detected so.
    const auto = applyRule(orderRule(), file, fresh("sales", "invoices"));
    expect(auto.applied.industry).toBeNull();
    expect(auto.choices.subDomainId).toBe("invoices");
    const elsewhere = applyRule(
      orderRule(),
      { columns: ["Ticket ID", "Agent"], domains: ["support"] },
      fresh(),
    );
    expect(appliedNothing(elsewhere.applied)).toBe(true);
  });

  it("never beats the session's own choices", () => {
    const session: LearnedChoices & { industryChosen: boolean } = {
      ...fresh("ecommerce"),
      industryChosen: true,
      roleOverrides: { "Customer ID": { role: "identifier" } },
      hiddenColumns: ["Discount"],
    };
    const { choices, applied } = applyRule(orderRule(), file, session);
    expect(choices.domainId).toBe("ecommerce");
    expect(applied.industry).toBeNull();
    expect(choices.roleOverrides["Customer ID"]).toEqual({ role: "identifier" });
    expect(applied.roles).toEqual({});
    expect(choices.hiddenColumns).toEqual(["Discount", "Internal Notes"]);
    // With the industry left to detection, the session's mapping of a field still wins.
    const mapped = applyRule(orderRule(), file, { ...fresh(), mappingOverrides: { deal_value: "Discount" } });
    expect(mapped.choices.mappingOverrides).toEqual({ deal_value: "Discount" });
  });

  it("is taken back by Undo, keeping what the user changed since", () => {
    const { choices, applied } = applyRule(orderRule(), file, fresh());
    const later = { ...choices, roleOverrides: { "Customer ID": { role: "text" as const } } };
    const back = undoApplied(later, applied, { domainId: "ecommerce", subDomainId: "orders" });
    expect(back.domainId).toBe("ecommerce");
    expect(back.subDomainId).toBe("orders");
    expect(back.mappingOverrides).toEqual({});
    expect(back.classOverrides).toEqual({});
    expect(back.hiddenColumns).toEqual([]);
    expect(back.roleOverrides).toEqual({ "Customer ID": { role: "text" } });
    // A shape learned as Auto is resolved once built; Undo still returns to what detection picked.
    const built = { ...choices, subDomainId: "invoices" };
    expect(undoApplied(built, applied, { domainId: "ecommerce", subDomainId: "orders" }).domainId).toBe(
      "ecommerce",
    );
  });

  it("reads back in words for Settings", () => {
    expect(describeRule(orderRule())).toEqual([
      "Sales",
      "Unit Price → Deal value",
      "Stage · Won: Closed",
      "Customer ID as Dimension",
      "Legacy Code as Identifier",
      "Internal Notes, Old Notes hidden",
    ]);
  });
});

describe("learned words", () => {
  // A table whose headers no registry field knows: the order ID and date are in a made-up house style.
  const csv = [
    "Zorblax Ref,Zorblax When,Product Name,Quantity,Unit Price,Customer City",
    ...Array.from({ length: 60 }, (_, i) => {
      const day = String((i % 28) + 1).padStart(2, "0");
      const month = String((i % 6) + 1).padStart(2, "0");
      return `ZX-${1001 + i},2025-${month}-${day},${["Kettle", "Mug", "Lamp", "Rug"][i % 4]},${(i % 5) + 1},${(199 + i * 7) % 900},${["Pune", "Delhi", "Mumbai"][i % 3]}`;
    }),
  ].join("\n");
  const words: LearnedSynonym[] = [
    { domainId: "ecommerce", fieldId: "order_id", header: "Zorblax Ref" },
    { domainId: "ecommerce", fieldId: "order_date", header: "Zorblax When" },
  ];

  it("fill the field and add evidence for its industry on a header the field didn't know", async () => {
    const { profile, detection } = detect(await parseCsv(csv, "house-style"));
    const ecommerce = getDomain("ecommerce") as DomainDef;
    const before = assignFields(ecommerce, profile.columns);
    expect(before.find((a) => a.fieldId === "order_id")?.column).not.toBe("Zorblax Ref");
    const [taught] = withLearnedSynonyms([ecommerce], words);
    const after = assignFields(taught as DomainDef, profile.columns);
    expect(after.find((a) => a.fieldId === "order_id")?.column).toBe("Zorblax Ref");
    expect(after.find((a) => a.fieldId === "order_date")?.column).toBe("Zorblax When");

    const confidence = (d: typeof detection) =>
      d.candidates.find((c) => c.domainId === "ecommerce")?.confidence ?? 0;
    const learned = detectDomain(withLearnedSynonyms([...DOMAINS], words), profile);
    expect(confidence(learned)).toBeGreaterThan(confidence(detection));
    const evidence = learned.candidates.find((c) => c.domainId === "ecommerce")?.evidence ?? [];
    expect(evidence.map((e) => e.column)).toContain("Zorblax Ref");
  });

  it("change nothing when there are none, and never touch the registry", async () => {
    const domains = [...DOMAINS];
    const same = withLearnedSynonyms(domains, []);
    expect(same).toHaveLength(domains.length);
    same.forEach((d, i) => expect(d).toBe(domains[i]));
    const { profile, detection } = detect(await parseCsv(csv, "house-style"));
    expect(detectDomain(withLearnedSynonyms([...DOMAINS], []), profile)).toEqual(detection);
    // Words only make copies: the registry's own field keeps its synonyms.
    const synonyms = [...(getDomain("ecommerce")?.fields.find((f) => f.id === "order_id")?.synonyms ?? [])];
    withLearnedSynonyms([...DOMAINS], words);
    expect(getDomain("ecommerce")?.fields.find((f) => f.id === "order_id")?.synonyms).toEqual(synonyms);
  });

  it("reach detection and mapping through the session", async () => {
    const { Session } = await import("@/engine/session");
    const session = new Session();
    const res = await session.ingest(new Blob([csv]), "house-style.csv", {}, undefined, words);
    if (res.status !== "ok") throw new Error("expected a dataset");
    const ecommerce = res.detection.candidates.find((c) => c.domainId === "ecommerce");
    expect(ecommerce?.evidence.map((e) => e.column)).toContain("Zorblax Ref");
    const ctx = session.configure({ domainId: "ecommerce", numberLocale: "IN", currency: null });
    expect(ctx.mapping.fields.order_id).toBe("Zorblax Ref");
    // A demo never reads them.
    const demo = session.ingestSample("ecommerce");
    const plain = new Session().ingestSample("ecommerce");
    expect(demo.status === "ok" && plain.status === "ok" && demo.detection).toEqual(
      plain.status === "ok" ? plain.detection : null,
    );
  });
});

describe("size cap", () => {
  it("keeps at most MAX_RULES rules, dropping the oldest", () => {
    let rules: LearnedRule[] = [];
    for (let i = 0; i < MAX_RULES + 5; i++) {
      const r = teachHidden(newRule([`h${i}`], [`H${i}`], 10_000 + i), [`H${i}`], true);
      rules = withRule(rules, r);
    }
    expect(rules).toHaveLength(MAX_RULES);
    const kept = new Set(rules.map((r) => r.columns[0]));
    for (let i = 0; i < 5; i++) expect(kept.has(`H${i}`)).toBe(false);
    expect(kept.has(`H${MAX_RULES + 4}`)).toBe(true);
    // A rule used lately counts as recent.
    const used = { ...(rules.at(-1) as LearnedRule), usedAt: 99_999, uses: 1 };
    expect(withRule(rules, used)[0]?.id).toBe(used.id);
  });

  it("drops a rule left with nothing in it", () => {
    const r = teachRole(newRule(["a"], ["A"], 1), "A", { role: "dimension" });
    const rules = withRule([], r);
    expect(rules).toHaveLength(1);
    expect(withRule(rules, teachRole(r, "A", null))).toHaveLength(0);
  });

  it("keeps at most MAX_WORDS words, and a word taught twice once", () => {
    const word = (i: number): LearnedWord => ({
      id: `lw_${i}`,
      domainId: "ecommerce",
      domainName: "E-commerce",
      fieldId: "order_id",
      fieldLabel: "Order ID",
      header: `Ref ${i}`,
      key: `ref ${i}`,
      learnedAt: i,
      usedAt: null,
      uses: 0,
    });
    let words: LearnedWord[] = [];
    for (let i = 0; i < MAX_WORDS + 3; i++) words = withWord(words, word(i));
    expect(words).toHaveLength(MAX_WORDS);
    expect(words.some((w) => w.header === "Ref 0")).toBe(false);
    const again = withWord(words, {
      ...word(MAX_WORDS + 2),
      id: "lw_again",
      header: "REF 302",
      learnedAt: 1e9,
    });
    expect(again).toHaveLength(MAX_WORDS);
    expect(keepWords(again)[0]?.learnedAt).toBe(1e9);
  });
});

describe("export and import", () => {
  const word: LearnedWord = {
    id: "lw_abc_1",
    domainId: "ecommerce",
    domainName: "E-commerce",
    fieldId: "net_revenue",
    fieldLabel: "Net revenue",
    header: "Net Amt",
    key: "net amount",
    learnedAt: 5,
    usedAt: null,
    uses: 2,
  };

  it("round-trips rules and words", () => {
    const rules = [orderRule()];
    const json = exportLearned(rules, [word], Date.UTC(2026, 9, 21));
    const back = parseLearned(json);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.rules).toEqual(rules);
    expect(back.words).toEqual([word]);
    // Importing adds to what is there; importing the same again changes nothing.
    const merged = mergeLearned({ rules: [], words: [] }, back);
    expect(mergeLearned(merged, back)).toEqual(merged);
    // The file holds header names and choices, nothing else.
    expect(Object.keys(JSON.parse(json))).toEqual(["app", "kind", "version", "exportedAt", "rules", "words"]);
  });

  it("rejects a malformed file whole", () => {
    const good = JSON.parse(exportLearned([orderRule()], [word], 0)) as Record<string, unknown>;
    const bad = (patch: (f: Record<string, unknown>) => void) => {
      const f = structuredClone(good);
      patch(f);
      return parseLearned(JSON.stringify(f));
    };
    expect(parseLearned("not json").ok).toBe(false);
    expect(parseLearned("{}").ok).toBe(false);
    expect(bad((f) => (f.app = "other")).ok).toBe(false);
    expect(bad((f) => (f.version = 2)).ok).toBe(false);
    expect(
      bad((f) => ((f.rules as LearnedRule[])[0]!.roles["Customer ID"]!.role = "wizard" as never)).ok,
    ).toBe(false);
    expect(bad((f) => ((f.rules as LearnedRule[])[0]!.uses = -1)).ok).toBe(false);
    expect(bad((f) => ((f.words as LearnedWord[])[0]!.header = "")).ok).toBe(false);
    expect(bad((f) => ((f.rules as unknown[])[0] = { id: "lr_x" })).ok).toBe(false);
    // A key that would reach an object's prototype is refused.
    const proto = exportLearned([orderRule()], [], 0).replace('"Customer ID": {', '"__proto__": {');
    expect(proto).toContain('"__proto__": {');
    expect(parseLearned(proto).ok).toBe(false);
  });

  it("changes nothing in the store when the import is malformed", () => {
    useLearned.setState({ rules: [orderRule()], words: [word] });
    const res = useLearned
      .getState()
      .importJson('{"app":"loupe","kind":"learned","version":1,"rules":[1],"words":[]}');
    expect(res.ok).toBe(false);
    expect(useLearned.getState().rules).toHaveLength(1);
    expect(useLearned.getState().words).toEqual([word]);
    const ok = useLearned
      .getState()
      .importJson(exportLearned([], [{ ...word, id: "lw_other_1", header: "Nett" }], 0));
    expect(ok).toEqual({ ok: true, rules: 0, words: 1 });
    expect(useLearned.getState().words).toHaveLength(2);
  });
});

describe("in the workspace", () => {
  const csv = [
    ORDER_HEADERS.join(","),
    ...Array.from({ length: 80 }, (_, i) => {
      const day = String((i % 28) + 1).padStart(2, "0");
      const month = String((i % 9) + 1).padStart(2, "0");
      return [
        `ORD-${5000 + i}`,
        `2025-${month}-${day}`,
        `C${100 + (i % 23)}`,
        ["Kettle", "Mug", "Lamp", "Rug", "Vase"][i % 5],
        ["Kitchen", "Home", "Decor"][i % 3],
        (i % 4) + 1,
        (250 + i * 13) % 1200,
        i % 7 === 0 ? 50 : 0,
        ["Delivered", "Shipped", "Returned", "Cancelled"][i % 4],
        `note ${i}`,
      ].join(",");
    }),
  ].join("\n");
  const file = () => new File([csv], "orders.csv", { type: "text/csv" });

  it("learns a correction, applies it to the next file like it, and takes it back on Undo and Forget", async () => {
    const ws = () => useWorkspace.getState();
    await ws().loadFile(file());
    expect(ws().learned?.applied).toBeNull();
    await ws().confirmDomain(ws().domainId as string, ws().subDomainId, { goTo: "map" });
    ws().setColumnsHidden(["Internal Notes"], true);
    ws().setRoleOverride("Customer ID", "dimension");
    const [rule] = useLearned.getState().rules;
    expect(rule?.hidden).toEqual(["Internal Notes"]);
    expect(rule?.roles).toEqual({ "Customer ID": { role: "dimension" } });
    expect(rule?.learnedAt).toBeGreaterThan(0);

    ws().startOver();
    await ws().loadFile(file());
    expect(ws().hiddenColumns).toEqual(["Internal Notes"]);
    expect(ws().roleOverrides).toEqual({ "Customer ID": { role: "dimension" } });
    expect(describeApplied(ws().learned?.applied ?? ({} as never))).toBe("1 column role, 1 hidden column");
    expect(useLearned.getState().rules[0]?.uses).toBe(1);

    ws().undoLearned();
    expect(ws().hiddenColumns).toEqual([]);
    expect(ws().roleOverrides).toEqual({});
    expect(ws().learned?.applied).toBeNull();
    // Undo is for this file: the rule stays.
    expect(useLearned.getState().rules).toHaveLength(1);

    ws().forgetLearned();
    expect(useLearned.getState().rules).toHaveLength(0);
    ws().startOver();
  });

  it("learns the industry chosen on Detect, and a demo neither learns nor applies", async () => {
    const ws = () => useWorkspace.getState();
    await ws().loadFile(file());
    const detected = ws().domainId;
    const other = detected === "sales" ? "ecommerce" : "sales";
    ws().chooseIndustry(other, null);
    await ws().confirmDomain(other, null, { goTo: "map" });
    expect(useLearned.getState().rules[0]?.industry?.domainId).toBe(other);

    ws().startOver();
    await ws().loadFile(file());
    expect(ws().domainId).toBe(other);
    expect(ws().learned?.applied?.industry?.domainId).toBe(other);
    // Built (the Auto shape resolved), then undone: back to what detection picked.
    await ws().confirmDomain(other, ws().subDomainId, { goTo: "map" });
    ws().undoLearned();
    expect(ws().domainId).toBe(detected);
    await vi.waitFor(() => expect(ws().context?.domain.id).toBe(detected));
    expect(useLearned.getState().rules[0]?.industry?.domainId).toBe(other);

    ws().startOver();
    await ws().loadSample("ecommerce");
    expect(ws().learned).toBeNull();
    ws().setColumnsHidden([ws().profile?.columns[0]?.name ?? ""], true);
    expect(useLearned.getState().rules).toHaveLength(1);
    ws().startOver();
  });
});
