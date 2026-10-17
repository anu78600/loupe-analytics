/**
 * The shared header vocabulary (version 41.0): profile/names.ts tokenize()
 * turns any header into the canonical English tokens that role rules, the
 * parser's date-name checks and the registry's synonym matching compare.
 *
 * Covered here: accents folded; currency marks, scale words and physical
 * units as their own tokens; business words translated from Spanish,
 * Portuguese, French, German, Italian and Hindi in Latin letters, with the
 * ambiguous ones read from the rest of the header; German compounds and
 * fused English words split; the new abbreviations; and English headers
 * left exactly as they were tokenised before.
 */
import { describe, expect, it } from "vitest";
import { MATCH_THRESHOLD } from "@/engine/detect/match";
import { nameCurrency, nameSimilarity, tokenize, translationConflicts } from "@/engine/profile/names";

/** Each header with the tokens it must give. */
const expectTokens = (cases: ReadonlyArray<readonly [string, readonly string[]]>) => {
  for (const [header, tokens] of cases) expect(tokenize(header), header).toEqual(tokens);
};

describe("accents", () => {
  it("folds accents instead of splitting words at them", () => {
    expectTokens([
      ["Código Cliente", ["code", "customer"]],
      ["Município", ["city"]],
      ["Descripción", ["description"]],
      ["Préstamo", ["loan"]],
      ["Straße", ["street"]],
      ["Größe", ["size"]],
      ["Index relevé (m³)", ["index", "releve", "cubicmetre"]],
    ]);
  });

  it("reads German typed without umlauts like German typed with them", () => {
    expect(tokenize("Rueckstand")).toEqual(tokenize("Rückstand"));
    expect(tokenize("Gebuehr")).toEqual(["fee"]);
  });
});

describe("currency marks", () => {
  it("writes any currency sign, code or name as the one token money", () => {
    expectTokens([
      ["ADR (€)", ["adr", "money"]],
      ["GDP (current US$)", ["gdp", "current", "money"]],
      ["Monetary_GBP", ["monetary", "money"]],
      ["copay_usd", ["copay", "money"]],
      ["adrUsd", ["adr", "money"]],
      ["Receita por produtos (BRL)", ["revenue", "por", "product", "money"]],
      ["Amount (Rs.)", ["amount", "money"]],
      ["Price in Dollars", ["price", "in", "money"]],
      ["Valor em Reais", ["value", "em", "money"]],
    ]);
  });

  it("keeps one money token where several marks stand together", () => {
    expect(tokenize("Amount (₹ INR)")).toEqual(["amount", "money"]);
  });

  it("reads codes that are also words as money only in brackets", () => {
    expect(tokenize("Fare (CAD)")).toEqual(["fare", "money"]);
    expect(tokenize("CAD Drawing")).toEqual(["cad", "drawing"]);
    expect(tokenize("NOK Qty")).toEqual(["nok", "quantity"]);
  });

  it("reads a slash after a currency as per", () => {
    expect(tokenize("Rate (₹/kg)")).toEqual(["rate", "money", "per", "kg"]);
    expect(tokenize("Spend (USD/day)")).toEqual(["spend", "money", "per", "day"]);
    expect(tokenize("Avg Rent (₹/sq ft/month)")).toEqual([
      "average",
      "rent",
      "money",
      "per",
      "sqft",
      "month",
    ]);
  });

  it("still tells which currency a header names", () => {
    expect(nameCurrency("Amount (USD)")).toBe("USD");
    expect(nameCurrency("Price (₹)")).toBe("INR");
    expect(nameCurrency("Receita (R$ mil)")).toBe("BRL");
    expect(nameCurrency("US$ Amount")).toBe("USD");
    expect(nameCurrency("Price in Rupees")).toBe("INR");
    expect(nameCurrency("Fare (CAD)")).toBe("CAD");
    expect(nameCurrency("Total")).toBeUndefined();
  });
});

describe("scale words", () => {
  it("names the scale a header's figures are written in", () => {
    expectTokens([
      ["AUM (₹ Cr)", ["aum", "money", "crore"]],
      ["Sales (₹ in Lakhs)", ["sale", "money", "in", "lakh"]],
      ["Target (Rs Lacs)", ["target", "money", "lakh"]],
      ["Net Absorption (mn sq ft)", ["net", "absorption", "million", "sqft"]],
      ["GDP (US$ bn)", ["gdp", "money", "billion"]],
      ["Revenue ($M)", ["revenue", "money", "million"]],
      ["Revenue (K)", ["revenue", "thousand"]],
      ["Receita Líquida (R$ mil)", ["revenue", "net", "money", "thousand"]],
      ["Umsatz (TEUR)", ["revenue", "thousand", "money"]],
      ["Revenue ('000)", ["revenue", "thousand"]],
    ]);
  });

  it("leaves short letters that are not scales alone", () => {
    // A metre, the digits of a number, and the credit side of a debit/credit pair.
    expect(tokenize("Height (m)")).toEqual(["height", "m"]);
    expect(tokenize("CPM (cost per 1,000 impressions)")).toEqual([
      "cpm",
      "cost",
      "per",
      "1",
      "000",
      "impression",
    ]);
    expect(tokenize("Dr/Cr")).toEqual(["dr", "credit"]);
    expect(tokenize("K-Means Cluster")).toEqual(["k", "mean", "cluster"]);
  });
});

describe("physical units", () => {
  it("keeps units as words, one spelling each", () => {
    expectTokens([
      ["Net Wt (gms)", ["net", "weight", "gram"]],
      ["Net Wt (gm)", ["net", "weight", "gram"]],
      ["Budget Cement (MT)", ["budget", "cement", "tonne"]],
      ["Fuel (L)", ["fuel", "litre"]],
      ["Diesel (Ltrs)", ["diesel", "litre"]],
      ["Area (Sq.Ft.)", ["area", "sqft"]],
      ["Fläche (m²)", ["area", "sqm"]],
      ["Volume (CBM)", ["volume", "cubicmetre"]],
      ["Energy (kWh)", ["energy", "kwh"]],
      ["Qty (Pcs)", ["quantity", "piece"]],
      ["Qty (Nos)", ["quantity", "piece"]],
      ["Distance (kms)", ["distance", "km"]],
      ["Handling Time (hrs)", ["handling", "time", "hour"]],
      ["Call Duration (mins)", ["call", "duration", "minute"]],
    ]);
  });

  it("does not read gross margin, P&L or quality management as units", () => {
    expect(tokenize("GM %")).toEqual(["gm", "percent"]);
    expect(tokenize("Avg GM")).toEqual(["average", "gm"]);
    expect(tokenize("P&L")).toEqual(["p", "l"]);
    expect(tokenize("QM Status")).toEqual(["qm", "status"]);
  });
});

describe("other languages", () => {
  it("translates business words to the English tokens the rest of Loupe uses", () => {
    expectTokens([
      // Spanish
      ["Fecha de pedido", ["date", "de", "order"]],
      ["Importe total", ["amount", "total"]],
      ["Ciudad", ["city"]],
      ["Provincia", ["province"]],
      ["Precio normal", ["price", "regular"]],
      ["Precio rebajado", ["price", "sale"]],
      ["Cantidad", ["quantity"]],
      ["Mes", ["month"]],
      // Portuguese
      ["Data da venda", ["date", "da", "sale"]],
      ["UF", ["state"]],
      ["Nome do cliente", ["name", "do", "customer"]],
      ["Forma de pagamento", ["method", "de", "payment"]],
      ["Prêmio emitido", ["premium", "emitido"]],
      // French
      ["Montant TTC", ["amount", "gross"]],
      ["Total HT", ["total", "net"]],
      ["Chiffre d'affaires", ["revenue"]],
      ["Code postal", ["postcode"]],
      ["Nouveau client", ["new", "client"]],
      ["Objet", ["subject"]],
      // German
      ["Umsatz Ist", ["revenue", "actual"]],
      ["Monat", ["month"]],
      ["Datum", ["date"]],
      ["Filiale", ["branch"]],
      ["Umsatz je Filiale", ["revenue", "per", "branch"]],
      // Italian
      ["Data di consegna", ["date", "di", "delivery"]],
      ["Fatturato", ["revenue"]],
      ["Città", ["city"]],
      ["Prezzi", ["price"]],
      // Hindi in Latin letters
      ["Gaadi No", ["vehicle", "number"]],
      ["Bhada", ["freight"]],
      ["Baaki", ["balance"]],
      ["Tarikh", ["date"]],
      ["Shahar", ["city"]],
    ]);
  });

  it("folds foreign plurals", () => {
    expectTokens([
      ["Clientes", ["customer"]],
      ["Ciudades", ["city"]],
      ["Unidades", ["unit"]],
      ["Ventes", ["sale"]],
    ]);
  });

  it("reads a word that means something else in English only from a foreign header", () => {
    expect(tokenize("Data Usage")).toEqual(["data", "usage"]);
    expect(tokenize("Data")).toEqual(["data"]);
    expect(tokenize("COD Amount")).toEqual(["cod", "amount"]);
    expect(tokenize("Cod Cliente")).toEqual(["code", "customer"]);
    expect(tokenize("Time (IST)")).toEqual(["time", "ist"]);
    expect(tokenize("Normal Range")).toEqual(["normal", "range"]);
    expect(tokenize("Ht (cm)")).toEqual(["height", "cm"]);
  });

  it("reads a word two languages share from the language of the header", () => {
    expect(tokenize("Nombre del cliente")).toEqual(["name", "del", "customer"]);
    expect(tokenize("Nombre de commandes")).toEqual(["number", "de", "order"]);
    // Alone it is Spanish: French names a count "Nombre de …".
    expect(tokenize("Nombre")).toEqual(["name"]);
  });

  it("leaves words that are ambiguous within their own language for the values to decide", () => {
    expect(tokenize("Estado")).toEqual(["estado"]);
    expect(tokenize("Departamento")).toEqual(["departamento"]);
  });

  it("keeps every language table consistent with the others", () => {
    expect(translationConflicts()).toEqual([]);
  });
});

describe("split words", () => {
  it("splits German compounds into known parts", () => {
    expectTokens([
      ["Kundennummer", ["customer", "number"]],
      ["Jahresgehalt", ["annual", "salary"]],
      ["Kaltmiete", ["rent"]],
      ["Rechnungsbetrag", ["invoice", "amount"]],
      ["Eintrittsdatum", ["joining", "date"]],
      ["Stückzahl", ["piece", "count"]],
      ["Zahlungsart", ["payment", "type"]],
      ["Sollmiete", ["target", "rent"]],
    ]);
    // Parts that would also read as an English word together stay whole.
    expect(tokenize("artist")).toEqual(["artist"]);
  });

  it("splits fused capitals or lower case into known English words", () => {
    expectTokens([
      ["ACTTOTALCOST", ["act", "total", "cost"]],
      ["TUITIONFEE", ["tuition", "fee"]],
      ["ORDERNUMBER", ["order", "number"]],
      ["CUSTOMERNAME", ["customer", "name"]],
      ["QUANTITYORDERED", ["quantity", "ordered"]],
      ["ADDRESSLINE1", ["address", "line", "1"]],
      ["totalamt", ["total", "amount"]],
    ]);
  });

  it("leaves real words, and words written in title case, whole", () => {
    for (const w of ["network", "passport", "payroll", "WEEKEND", "Weekday", "headcount", "Ordernumber"])
      expect(tokenize(w), w).toEqual([w.toLowerCase()]);
  });
});

describe("abbreviations and phrases", () => {
  it("expands the abbreviations analysts write", () => {
    expectTokens([
      ["no_show_flg", ["noshow", "flag"]],
      ["Item Cd", ["item", "code"]],
      ["Billing Doc.", ["billing", "document"]],
      ["Total Spent", ["total", "spend"]],
      ["Rndrng_Prvdr_Zip5", ["rndrng", "prvdr", "zipcode"]],
      ["Accnt Bal", ["account", "balance"]],
      ["Amt Recv", ["amount", "received"]],
      ["Sls Vol", ["sale", "volume"]],
      ["Gross Wt", ["gross", "weight"]],
      ["Avg_Submtd_Cvrd_Chrg", ["average", "submtd", "cvrd", "charge"]],
      ["EMPNO", ["employee", "number"]],
    ]);
  });

  it("reads a header that lists its own yes/no answers as a flag", () => {
    expect(tokenize("Paid (Y/N)")).toEqual(["paid", "flag"]);
    expect(tokenize("Active (Yes/No)")).toEqual(["active", "flag"]);
    expect(tokenize("Pago (Sim/Não)")).toEqual(["payment", "flag"]);
    // The serial number of Indian sheets, not "yes/no".
    expect(tokenize("SI No")).toEqual(["si", "number"]);
  });

  it("reads the number sign of other languages", () => {
    expect(tokenize("N° commande")).toEqual(["number", "order"]);
    expect(tokenize("N.º de pedido")).toEqual(["number", "de", "order"]);
  });
});

describe("matching with foreign stopwords", () => {
  it("skips an article or preposition between two words", () => {
    expect(nameSimilarity(tokenize("Nombre del cliente"), "customer name")).toBeGreaterThanOrEqual(0.95);
    expect(nameSimilarity(tokenize("Data da venda"), "sale date")).toBeGreaterThanOrEqual(0.95);
  });

  it("keeps the same letters at either end, where they are abbreviations", () => {
    // "DO number" is a delivery order: a bare "Number" column must not reach it.
    expect(nameSimilarity(tokenize("DO Number"), "do number")).toBe(1);
    expect(nameSimilarity(tokenize("Number"), "do number")).toBeLessThan(MATCH_THRESHOLD);
    expect(nameSimilarity(tokenize("LOS"), "los")).toBe(1);
  });

  it("matches a registry synonym written the same way as the column", () => {
    expect(nameSimilarity(tokenize("Area (Sq.Ft.)"), "area sq ft")).toBe(1);
    // "kWh" used to split into "k" and "wh", so the column missed its own synonym.
    expect(nameSimilarity(tokenize("Energy (kWh)"), "energy kwh")).toBe(1);
  });
});

describe("English headers", () => {
  // Pinned from the tokenizer before 41.0: the vocabulary must not change how English is read.
  const ENGLISH: ReadonlyArray<readonly [string, readonly string[]]> = [
    ["OrderDate", ["order", "date"]],
    ["cust_ID", ["customer", "id"]],
    ["Discount %", ["discount", "percent"]],
    ["Training Hours", ["training", "hour"]],
    ["Lead Time (days)", ["lead", "time", "days"]],
    ["Quantity (- Refund)", ["quantity", "refund"]],
    ["Invoice No", ["invoice", "number"]],
    ["Updated at", ["updated", "at"]],
    ["MultipleLines", ["multiple", "line"]],
    ["Date of Birth", ["date", "of", "birth"]],
    ["Customer Lifetime Value", ["customer", "lifetime", "value"]],
    ["Days for shipping (real)", ["days", "for", "shipping", "real"]],
    ["Sub-Category", ["subcategory"]],
    ["Postal Code", ["postcode"]],
    ["MonthlyCharges", ["monthly", "charge"]],
    ["YearsAtCompany", ["year", "at", "company"]],
    ["ADR", ["adr"]],
    ["Weekly_Sales", ["weekly", "sale"]],
    ["Pageviews", ["pageview"]],
    ["Avg. Session Duration", ["average", "session", "duration"]],
    ["Attendance %", ["attendance", "percent"]],
    ["Downtime (min)", ["downtime", "min"]],
    ["Batch No", ["batch", "number"]],
    ["Stock on Hand", ["stock", "on", "hand"]],
    ["Margin %", ["margin", "percent"]],
    ["COD", ["cod"]],
    ["AWB Number", ["awb", "number"]],
    ["Address Line 1", ["address", "line", "1"]],
    ["Data Usage (GB)", ["data", "usage", "gb"]],
    ["Total Day Minutes", ["total", "day", "minute"]],
    ["Number vmail messages", ["number", "vmail", "message"]],
    ["is_returned", ["is", "returned"]],
    ["PaymentMethod", ["payment", "method"]],
    ["Population, total", ["population", "total"]],
    ["Weekday", ["weekday"]],
    ["Cost Centre", ["cost", "centre"]],
    ["Cheque No", ["cheque", "number"]],
    ["Withdrawal Amt", ["withdrawal", "amount"]],
  ];

  it("tokenises them exactly as before", () => {
    expectTokens(ENGLISH);
  });

  it("reads words that are also JavaScript property names as words", () => {
    // Formula 1 results name their teams "constructorId"; a plain object lookup returned a function.
    expect(tokenize("constructorId")).toEqual(["constructor", "id"]);
    expect(tokenize("toString")).toEqual(["to", "string"]);
    expect(tokenize("hasOwnProperty")).toEqual(["has", "own", "property"]);
    expect(nameCurrency("constructor")).toBeUndefined();
  });
});
