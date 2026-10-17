/**
 * Reading values written the way the rest of the world writes them (version
 * 41.0): month names in Spanish, Portuguese, French, German, Italian and
 * Dutch with their connectors ("14 de março de 2024 10:22 hs."), a time or a
 * weekday before the date, months written "01.2025", ISO weeks, Unix times
 * under event names, yes/no words in other languages, numbers with a scale
 * word ("14.5 Lacs", "3.4M") and Swiss thousands. Each case is a small table
 * with realistic headers, parsed and profiled as an upload is; each also
 * shows where the rule stops (codes, decimals, mixed languages).
 */
import { describe, expect, it } from "vitest";
import { exportKind, wordLabels } from "@/engine/core/booleans";
import { utc } from "@/engine/core/dates";
import type { Dataset, ParseReport } from "@/engine/core/types";
import { createAccumulator } from "@/engine/parse/builder";
import { detectNumericDateKind, parseDateParts, partsToMs } from "@/engine/parse/dates";
import { parseNumber, parseScaledNumber } from "@/engine/parse/values";
import { foldWord, MONTH_LANGUAGES, MONTH_NAMES } from "@/engine/parse/words";
import { profileDataset } from "@/engine/profile/profile";
import type { ColumnProfile } from "@/engine/profile/types";
import { csvCell } from "./helpers/layouts";
import { cell, column, parse } from "./helpers/dataset";

/** A CSV from named columns of equal length (the longest decides; shorter ones are blank below). */
function table(cols: Record<string, readonly (string | number)[]>): string {
  const names = Object.keys(cols);
  const n = Math.max(...names.map((k) => (cols[k] as readonly unknown[]).length));
  const lines = [names.map(csvCell).join(",")];
  for (let i = 0; i < n; i++)
    lines.push(
      names.map((k) => csvCell(String((cols[k] as readonly (string | number)[])[i] ?? ""))).join(","),
    );
  return `${lines.join("\n")}\n`;
}

/** Parses and profiles a table, as an upload is read. */
async function read(
  cols: Record<string, readonly (string | number)[]>,
): Promise<{ ds: Dataset; report: ParseReport; role: (name: string) => ColumnProfile["role"] }> {
  const { ds, report } = await parse(table(cols), "world.csv");
  const profile = profileDataset(ds);
  const role = (name: string) => {
    const c = profile.columns.find((x) => x.name === name);
    if (!c) throw new Error(`no column ${name}`);
    return c.role;
  };
  return { ds, report, role };
}

const seq = <T>(n: number, f: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => f(i));
const evidence = (report: ParseReport, name: string) =>
  report.dateFormats.find((d) => d.column === name)?.evidence;
const noteOf = (report: ParseReport, name: string) => report.columnNotes.find((n) => n.column === name);
const H = 3_600_000;

describe("month names in other languages", () => {
  it("reads each language with the connectors it writes, and says which language", async () => {
    const { ds, report, role } = await read({
      "Data da venda": seq(
        24,
        (i) => `${(i % 27) + 1} de ${["março", "abril", "dezembro"][i % 3]} de 2024 10:22 hs.`,
      ),
      Fecha: seq(24, (i) => `${(i % 27) + 1} de ${["enero", "agosto", "diciembre"][i % 3]} del 2024`),
      "Date de commande": seq(
        24,
        (i) => `${i % 3 === 0 ? "1er" : (i % 27) + 1} ${["janvier", "févr.", "août"][i % 3]} 2024`,
      ),
      Rechnungsdatum: seq(24, (i) => `${(i % 27) + 1}. ${["März", "Okt.", "Dez."][i % 3]} 2024`),
      "Data ordine": seq(24, (i) => `${(i % 27) + 1} ${["gennaio", "maggio", "settembre"][i % 3]} 2024`),
      Factuurdatum: seq(24, (i) => `${(i % 27) + 1} ${["maart", "mei", "okt"][i % 3]} 2024`),
    });
    expect(cell(ds, "Data da venda", 0)).toBe(utc(2024, 3, 1) + 10 * H + 22 * 60_000);
    expect(cell(ds, "Fecha", 1)).toBe(utc(2024, 8, 2));
    expect(cell(ds, "Date de commande", 0)).toBe(utc(2024, 1, 1));
    expect(cell(ds, "Date de commande", 1)).toBe(utc(2024, 2, 2));
    expect(cell(ds, "Rechnungsdatum", 0)).toBe(utc(2024, 3, 1));
    expect(cell(ds, "Data ordine", 1)).toBe(utc(2024, 5, 2));
    expect(cell(ds, "Factuurdatum", 0)).toBe(utc(2024, 3, 1));
    for (const name of [
      "Data da venda",
      "Fecha",
      "Date de commande",
      "Rechnungsdatum",
      "Data ordine",
      "Factuurdatum",
    ])
      expect(role(name), name).toBe("datetime");
    expect(evidence(report, "Data da venda")).toContain("Portuguese");
    expect(evidence(report, "Fecha")).toContain("Spanish");
    expect(evidence(report, "Rechnungsdatum")).toContain("German");
    expect(evidence(report, "Factuurdatum")).toContain("Dutch");
  });

  it("reads Indonesian, Scandinavian, Turkish and Polish month names too", async () => {
    const { ds, report } = await read({
      Tanggal: seq(12, (i) => `${i + 1} ${["Agustus", "Desember", "Maret"][i % 3]} 2024`),
      Datum: seq(12, (i) => `${i + 1} ${["maj", "augusti", "mars"][i % 3]} 2024`),
      Dato: seq(12, (i) => `${i + 1}. ${["desember", "mai", "mars"][i % 3]} 2024`),
      Tarih: seq(12, (i) => `${i + 1} ${["Ekim", "Kasım", "ŞUBAT"][i % 3]} 2024`),
      "Data wystawienia": seq(12, (i) => `${i + 1} ${["marca", "października", "września"][i % 3]} 2024`),
    });
    expect(cell(ds, "Tanggal", 0)).toBe(utc(2024, 8, 1));
    expect(cell(ds, "Datum", 1)).toBe(utc(2024, 8, 2));
    expect(cell(ds, "Dato", 0)).toBe(utc(2024, 12, 1));
    expect(cell(ds, "Tarih", 1)).toBe(utc(2024, 11, 2));
    expect(cell(ds, "Data wystawienia", 1)).toBe(utc(2024, 10, 2));
    expect(evidence(report, "Tanggal")).toContain("Indonesian");
    expect(evidence(report, "Datum")).toContain("Swedish");
    expect(evidence(report, "Dato")).toContain("Norwegian");
    expect(evidence(report, "Tarih")).toContain("Turkish");
    expect(evidence(report, "Data wystawienia")).toContain("Polish");
  });

  it("reads month-year labels in other languages, with a comma, or with 'de'", async () => {
    const { ds, role } = await read({
      Mes: seq(
        12,
        (i) =>
          `${["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"][i]}-24`,
      ),
      month: seq(12, (i) => `${["January", "February", "March"][i % 3]}, ${2023 + Math.floor(i / 3)}`),
      Periodo: seq(12, (i) => `${["marzo", "junio"][i % 2]} de ${2020 + i}`),
    });
    expect(cell(ds, "Mes", 0)).toBe(utc(2024, 1, 1));
    expect(cell(ds, "Mes", 11)).toBe(utc(2024, 12, 1));
    expect(cell(ds, "month", 4)).toBe(utc(2024, 2, 1));
    expect(cell(ds, "Periodo", 1)).toBe(utc(2021, 6, 1));
    for (const name of ["Mes", "month", "Periodo"]) expect(role(name), name).toBe("datetime");
  });

  it("gives a column one language: a value in another is left blank, a half-and-half column stays text", async () => {
    const spanish = seq(30, (i) => `${(i % 27) + 1} ${["ene", "abr", "ago", "dic"][i % 4]} 2024`);
    const { ds, report } = await read({ Fecha: [...spanish, "3 Jan 2024"] });
    expect(column(ds, "Fecha").kind).toBe("date");
    expect(cell(ds, "Fecha", 30)).toBeNull();
    expect(noteOf(report, "Fecha")?.examples).toContain("3 Jan 2024");
    const mixed = await read({ Fecha: seq(30, (i) => (i % 2 ? `${i} ene 2024` : `${i + 1} Jan 2024`)) });
    expect(column(mixed.ds, "Fecha").kind).toBe("string");
  });

  it("reads words several languages share alike, and says nothing about the language then", async () => {
    // "mar", "may" and "nov" are March, May and November in English and Spanish alike.
    const { ds, report } = await read({
      Date: seq(12, (i) => `${i + 1} ${["Mar", "May", "Nov"][i % 3]} 2025`),
    });
    expect(cell(ds, "Date", 1)).toBe(utc(2025, 5, 2));
    expect(evidence(report, "Date")).toBe("Unambiguous pattern.");
  });

  it("reads a time written before the date, a weekday before it and the zones tools append", () => {
    const at = (raw: string, kind: Parameters<typeof parseDateParts>[1]) => {
      const p = parseDateParts(raw, kind);
      return p ? partsToMs(p, kind, true) : null;
    };
    expect(at("11:38 PM, September 10 2024", "mon-d-y")).toBe(utc(2024, 9, 10) + 23 * H + 38 * 60_000);
    expect(at("Thursday, March 14, 2024", "mon-d-y")).toBe(utc(2024, 3, 14));
    expect(at("jueves, 14 de marzo de 2024", "d-mon-y")).toBe(utc(2024, 3, 14));
    expect(at("quinta-feira, 14 de março de 2024", "d-mon-y")).toBe(utc(2024, 3, 14));
    expect(at("Donnerstag, 14. März 2024", "d-mon-y")).toBe(utc(2024, 3, 14));
    // RFC 2822 and JavaScript's Date.toString(): the clock time is kept as written, the zone ignored.
    expect(at("Thu, 14 Mar 2024 10:22:33 +0000", "d-mon-y")).toBe(
      utc(2024, 3, 14) + 10 * H + 22 * 60_000 + 33_000,
    );
    expect(at("Thu Mar 14 2024 10:22:33 GMT+0530 (India Standard Time)", "mon-d-y")).toBe(
      utc(2024, 3, 14) + 10 * H + 22 * 60_000 + 33_000,
    );
    expect(at("2024-03-14 10:22 IST", "iso")).toBe(utc(2024, 3, 14) + 10 * H + 22 * 60_000);
    expect(at("14/03/2024 10:22:33 p. m.", "nn-nn-y")).toBe(utc(2024, 3, 14) + 22 * H + 22 * 60_000 + 33_000);
    // A word that is no zone after the time, and a time on both sides, are not dates.
    expect(at("14/03/2024 10:22 Pune", "nn-nn-y")).toBeNull();
    expect(at("10:22, 14 Mar 2024 11:00", "d-mon-y")).toBeNull();
  });

  it("reads the shapes other locales give dates and times", () => {
    const at = (raw: string, kind: Parameters<typeof parseDateParts>[1]) => {
      const p = parseDateParts(raw, kind);
      return p ? partsToMs(p, kind, true) : null;
    };
    // Korean and Hungarian dates, French "10h22", Italian and Danish "10.22", a spaced hyphen before the time.
    expect(at("2024. 3. 14.", "ymd-slash")).toBe(utc(2024, 3, 14));
    expect(at("14 mars 2024 à 10h22", "d-mon-y")).toBe(utc(2024, 3, 14) + 10 * H + 22 * 60_000);
    expect(at("14/03/2024 10.22.33", "nn-nn-y")).toBe(utc(2024, 3, 14) + 10 * H + 22 * 60_000 + 33_000);
    expect(at("14/03/2024 - 10:22", "nn-nn-y")).toBe(utc(2024, 3, 14) + 10 * H + 22 * 60_000);
    expect(at("Mar ’24", "mon-y")).toBe(utc(2024, 3, 1));
    // A flight's "+1" (arrives the next day) is not a time zone to ignore.
    expect(at("2024-03-14 10:22+1", "iso")).toBeNull();
  });

  it("never gives one word two months", () => {
    const months = new Map<string, number>();
    for (const language of MONTH_LANGUAGES)
      MONTH_NAMES[language].forEach((words, i) => {
        for (const w of words.map(foldWord)) {
          expect(months.get(w) ?? i + 1, `${language} "${w}"`).toBe(i + 1);
          months.set(w, i + 1);
        }
      });
  });
});

describe("months written with numbers, and ISO weeks", () => {
  it('reads "01.2025" under a month name as January 2025, not the decimal 1.2025, and says why', async () => {
    const { ds, report, role } = await read({
      Monat: seq(24, (i) => `${String((i % 12) + 1).padStart(2, "0")}.${2024 + Math.floor(i / 12)}`),
      Umsatz: seq(24, (i) => 1000 + i * 37),
    });
    expect(cell(ds, "Monat", 0)).toBe(utc(2024, 1, 1));
    expect(cell(ds, "Monat", 23)).toBe(utc(2025, 12, 1));
    expect(role("Monat")).toBe("datetime");
    expect(evidence(report, "Monat")).toMatch(/month and a year \(January 2024\), not as decimal numbers/);
  });

  it('reads "2024.03" under a month name as March 2024, and leaves it a decimal elsewhere', async () => {
    const months = seq(24, (i) => `${2024 + Math.floor(i / 12)}.${String((i % 12) + 1).padStart(2, "0")}`);
    const { ds, report } = await read({ Month: months, Weight: months });
    expect(cell(ds, "Month", 2)).toBe(utc(2024, 3, 1));
    expect(evidence(report, "Month")).toContain("(January 2024), not as decimal numbers");
    // No date name: "2024.03" stays the number it also is.
    expect(cell(ds, "Weight", 2)).toBe(2024.03);
  });

  it("reads MM/YYYY without a date name when every value is a month, but not codes or decimals", async () => {
    const { ds, report } = await read({
      "Billing cycle": seq(
        24,
        (i) => `${String((i % 12) + 1).padStart(2, "0")}/${2024 + Math.floor(i / 12)}`,
      ),
      "Invoice No": seq(24, (i) => `${(i % 12) + 1}/2025`),
      "EUR/USD": seq(24, (i) => (1.195 + (i % 7) / 1000).toFixed(4)),
    });
    expect(cell(ds, "Billing cycle", 13)).toBe(utc(2025, 2, 1));
    expect(evidence(report, "Billing cycle")).toContain("every value has a month from 1 to 12");
    expect(column(ds, "Invoice No").kind).toBe("string");
    // Exchange rates near 1.2 have four decimals that look like years, but one "month": they stay numbers.
    expect(column(ds, "EUR/USD").kind).toBe("number");
    expect(cell(ds, "EUR/USD", 0)).toBe(1.195);
  });

  it('needs a month or period name, not just an event word, before "1.2010" is a month', async () => {
    const rates = seq(24, (i) => (1.195 + (i % 7) / 1000).toFixed(4));
    const { ds } = await read({ "Start Rate": rates, "Due Rate": rates, Period: rates });
    expect(column(ds, "Start Rate").kind).toBe("number");
    expect(column(ds, "Due Rate").kind).toBe("number");
    // Under a period name the same values are months, as "01.2025" would be.
    expect(column(ds, "Period").kind).toBe("date");
  });

  it("reads ISO weeks as their Monday, and only weeks the year has", async () => {
    const weeks = [
      "2024-W12",
      "2025-W01",
      "2020-W53",
      ...seq(21, (i) => `2024-W${String(i + 20).padStart(2, "0")}`),
    ];
    const { ds, role } = await read({ Week: [...weeks, "2021-W53"], Orders: seq(25, (i) => 40 + i) });
    expect(cell(ds, "Week", 0)).toBe(utc(2024, 3, 18));
    expect(cell(ds, "Week", 1)).toBe(utc(2024, 12, 30));
    expect(cell(ds, "Week", 2)).toBe(utc(2020, 12, 28));
    // 2021 has 52 ISO weeks, so its week 53 is no date.
    expect(cell(ds, "Week", 24)).toBeNull();
    expect(role("Week")).toBe("datetime");
  });
});

describe("Unix timestamps under event names", () => {
  it("reads seconds, milliseconds and microseconds under time, event and stamp names", async () => {
    const s = 1_712_345_678;
    const { ds, role } = await read({
      time: seq(20, (i) => s + i * 3600),
      event_time: seq(20, (i) => (s + i) * 1000),
      _ts: seq(20, (i) => s + i),
      at: seq(20, (i) => s + i * 60),
      event_timestamp: seq(20, (i) => `${(s + i) * 1_000_000 + 123}`),
      // Slack's message stamps: seconds with microseconds after the point.
      ts: seq(20, (i) => `${s + i}.${String(123_456 + i).padStart(6, "0")}`),
    });
    expect(cell(ds, "time", 1)).toBe((s + 3600) * 1000);
    expect(cell(ds, "event_time", 0)).toBe(s * 1000);
    expect(cell(ds, "_ts", 0)).toBe(s * 1000);
    expect(cell(ds, "at", 0)).toBe(s * 1000);
    expect(cell(ds, "event_timestamp", 0)).toBe(s * 1000);
    expect(cell(ds, "ts", 0)).toBe(s * 1000 + 123);
    for (const name of ["time", "event_time", "_ts", "at", "event_timestamp", "ts"])
      expect(role(name), name).toBe("datetime");
  });

  it("keeps IDs and amounts in the Unix range as numbers, beside a stamp word", () => {
    const values = seq(20, (i) => 1_712_345_678 + i * 7919);
    for (const name of ["created_by", "Created User ID", "Time Deposit Amount", "Updated Balance"])
      expect(detectNumericDateKind(values, name), name).toBeNull();
    expect(detectNumericDateKind(values, "Created")).toBe("unix-s");
  });
});

describe("yes/no words in other languages", () => {
  it("stores one language's pair as yes/no, keeping the file's words", async () => {
    const { ds, role } = await read({
      "Venda por publicidade": seq(20, (i) => (i % 3 ? "Não" : "Sim")),
      "Nouveau client": seq(20, (i) => (i % 2 ? "Non" : "Oui")),
      "¿Pagado?": seq(20, (i) => (i % 4 ? "Sí" : "No")),
      Bestätigt: seq(20, (i) => (i % 5 ? "Ja" : "Nein")),
      "Payment mila": seq(20, (i) => (i % 2 ? "Haan" : "Nahi")),
      Activo: seq(20, (i) => (i % 2 ? "VERDADERO" : "FALSO")),
      Actif: seq(20, (i) => (i % 2 ? "VRAI" : "FAUX")),
    });
    const labels = (name: string) => {
      const c = column(ds, name);
      return c.kind === "boolean" ? [c.trueLabel, c.falseLabel] : c.kind;
    };
    expect(labels("Venda por publicidade")).toEqual(["Sim", "Não"]);
    expect(labels("Nouveau client")).toEqual(["Oui", "Non"]);
    expect(labels("¿Pagado?")).toEqual(["Sí", "No"]);
    expect(labels("Bestätigt")).toEqual(["Ja", "Nein"]);
    expect(labels("Payment mila")).toEqual(["Haan", "Nahi"]);
    expect(labels("Activo")).toEqual(["VERDADERO", "FALSO"]);
    expect(labels("Actif")).toEqual(["VRAI", "FAUX"]);
    expect(cell(ds, "Venda por publicidade", 0)).toBe(true);
    expect(cell(ds, "Venda por publicidade", 1)).toBe(false);
    for (const name of ["Venda por publicidade", "Nouveau client", "Activo"])
      expect(role(name), name).toBe("boolean");
    // Exports keep the words as text, so the file comes back as it was written (core/booleans.ts).
    const sim = column(ds, "Venda por publicidade");
    expect(exportKind(sim)).toBe("string");
    if (sim.kind === "boolean") expect(wordLabels(sim)).toEqual({ true: "Sim", false: "Não" });
  });

  it("reads pairs in other scripts and in Turkish, Polish and Indonesian alike", async () => {
    const { ds } = await read({
      Aktif: seq(20, (i) => (i % 2 ? "EVET" : "HAYIR")),
      Opłacone: seq(20, (i) => (i % 2 ? "Tak" : "Nie")),
      Lunas: seq(20, (i) => (i % 2 ? "Ya" : "Tidak")),
      Оплачено: seq(20, (i) => (i % 2 ? "Да" : "Нет")),
      是否付款: seq(20, (i) => (i % 2 ? "是" : "否")),
      支払済: seq(20, (i) => (i % 2 ? "はい" : "いいえ")),
      결제여부: seq(20, (i) => (i % 2 ? "예" : "아니오")),
    });
    for (const name of ["Aktif", "Opłacone", "Lunas", "Оплачено", "是否付款", "支払済", "결제여부"]) {
      expect(column(ds, name).kind, name).toBe("boolean");
      expect(cell(ds, name, 1), name).toBe(true);
    }
  });

  it("leaves mixed languages, a lone name and single letters as text", async () => {
    const { ds } = await read({
      Réponse: seq(20, (i) => (i % 2 ? "Oui" : "No")),
      Ethnicity: seq(20, () => "Han"),
      Hemisphere: seq(20, (i) => (i % 2 ? "N" : "S")),
    });
    expect(column(ds, "Réponse").kind).toBe("string");
    expect(column(ds, "Ethnicity").kind).toBe("string");
    expect(column(ds, "Hemisphere").kind).toBe("string");
  });
});

describe("numbers with a scale word", () => {
  it("reads lakhs and crores at full size beside money, and says so", async () => {
    const { ds, report, role } = await read({
      Price: seq(20, (i) => (i % 2 ? `₹${(1 + i / 10).toFixed(1)} Cr` : `₹${80 + i} Lac`)),
      "AUM (₹ Cr)": seq(20, (i) => `${(12.5 + i).toFixed(1)} Cr`),
      CTC: seq(20, (i) => `${(4.5 + i / 2).toFixed(1)} LPA`),
    });
    expect(cell(ds, "Price", 0)).toBe(8_000_000);
    expect(cell(ds, "Price", 1)).toBe(11_000_000);
    expect(cell(ds, "AUM (₹ Cr)", 0)).toBe(125_000_000);
    expect(cell(ds, "CTC", 0)).toBe(450_000);
    expect(role("Price")).toBe("currency");
    const note = noteOf(report, "Price");
    expect(note?.invalidCount).toBe(0);
    expect(note?.note).toMatch(/Every value carries a scale word .*read at full size/);
    expect(note?.note).toContain("crores (ten millions)");
  });

  it("reads K, M and Bn beside money, in either decimal style", async () => {
    const { ds } = await read({
      Revenue: seq(20, (i) => (i % 2 ? `${(1 + i / 10).toFixed(1)}M` : `${100 + i}K`)),
      "Market Cap": seq(20, (i) => `$${(1.1 + i / 100).toFixed(2)} Bn`),
    });
    expect(cell(ds, "Revenue", 0)).toBe(100_000);
    expect(cell(ds, "Revenue", 1)).toBe(1_100_000);
    expect(cell(ds, "Market Cap", 0)).toBe(1_100_000_000);
    expect(parseScaledNumber("1,2 Mio. €", "comma")).toMatchObject({ value: 1_200_000, currency: "EUR" });
    expect(parseScaledNumber("500 k€")).toMatchObject({ value: 500_000, currency: "EUR" });
    expect(parseScaledNumber("2.3 Cr")?.value).toBe(23_000_000);
  });

  it("leaves sizes, grades and ledger credits as they are", async () => {
    const { ds } = await read({
      "Screen Size": seq(20, (i) => ["4K", "5K", "8K"][i % 3] as string),
      "Pencil Grade": seq(20, (i) => ["2B", "4B", "6B"][i % 3] as string),
      "Closing Balance": seq(20, (i) => `${(12_345 + i * 101).toLocaleString("en-IN")}.00 Cr`),
      Followers: seq(20, (i) => `${10 + i}K`),
    });
    for (const name of ["Screen Size", "Pencil Grade", "Closing Balance", "Followers"])
      expect(column(ds, name).kind, name).toBe("string");
  });

  it("reads a header that spells the scale out, but every value must carry a scale word", async () => {
    const { ds } = await read({
      District: seq(20, (i) => `D-${i}`),
      Households: seq(20, (i) => 1200 + i * 31),
      "Population (millions)": seq(20, (i) => `${(1.4 + i / 10).toFixed(1)} mn`),
      Budget: [...seq(19, (i) => `${(2 + i / 10).toFixed(1)} Cr`), "45000"],
    });
    expect(cell(ds, "Population (millions)", 0)).toBe(1_400_000);
    // One sampled value without a scale word, and the column is left as written.
    expect(column(ds, "Budget").kind).toBe("string");
  });

  it("reads a later value without a scale word as written, and counts it in the note", () => {
    const acc = createAccumulator({ kind: "number", style: "dot", scaled: true }, { preferDayFirst: true });
    for (const v of ["2.5 Cr", "85 Lacs", "45000", ""]) acc.push(v);
    const fin = acc.finish("Budget");
    expect(fin.column.kind === "number" && [...fin.column.values]).toEqual([
      25_000_000,
      8_500_000,
      45_000,
      NaN,
    ]);
    expect(fin.note?.note).toContain('2 values carry a scale word (such as "2.5 Cr")');
    expect(fin.note?.note).toContain("1 value without one was read as written");
  });
});

describe("numbers and blanks written the local way", () => {
  it("reads Swiss apostrophe thousands, and N/D or a dash as blank in a number column", async () => {
    expect(parseNumber("CHF 1'234.50")).toEqual({ value: 1234.5, currency: "CHF" });
    expect(parseNumber("1’234’567")?.value).toBe(1_234_567);
    expect(parseNumber("5'10")).toBeNull();
    const { ds, report } = await read({
      Betrag: seq(20, (i) => (i % 5 === 4 ? (i % 2 ? "N/D" : "–") : `${i + 1}'234.50`)),
    });
    expect(column(ds, "Betrag").kind).toBe("number");
    expect(cell(ds, "Betrag", 0)).toBe(1234.5);
    expect(cell(ds, "Betrag", 4)).toBeNull();
    expect(cell(ds, "Betrag", 9)).toBeNull();
    expect(noteOf(report, "Betrag")).toBeUndefined();
  });

  it("keeps numbers longer than a double holds exactly as text, so IDs are never changed", async () => {
    const { ds, role } = await read({
      // GA4's user_pseudo_id: as a double, the last digits would change and IDs could merge.
      user_pseudo_id: seq(60, (i) => `${1_197_596_843 + i}.16735154${String(30 + i).padStart(2, "0")}`),
      tweet_id: seq(60, (i) => `${1_780_000_000_000_000_000n + BigInt(i * 7919)}`),
      latitude: seq(60, (i) => `12.9715987000000${String(10 + i).padStart(2, "0")}`),
    });
    expect(column(ds, "user_pseudo_id").kind).toBe("string");
    expect(cell(ds, "user_pseudo_id", 0)).toBe("1197596843.1673515430");
    expect(cell(ds, "tweet_id", 1)).toBe("1780000000000007919");
    expect(role("user_pseudo_id")).toBe("identifier");
    // A long decimal elsewhere is a measurement's float noise, and stays a number.
    expect(column(ds, "latitude").kind).toBe("number");
  });

  it("still reads English yes/no and month names as before", async () => {
    const { ds, report } = await read({
      Returned: seq(20, (i) => (i % 3 ? "No" : "Yes")),
      "Order Date": seq(20, (i) => `${i + 1} Apr 2025`),
    });
    const returned = column(ds, "Returned");
    expect(returned.kind === "boolean" && [returned.trueLabel, returned.falseLabel]).toEqual(["Yes", "No"]);
    expect(cell(ds, "Order Date", 2)).toBe(utc(2025, 4, 3));
    expect(evidence(report, "Order Date")).toBe("Unambiguous pattern.");
  });
});
