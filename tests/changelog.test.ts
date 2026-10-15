/**
 * Guards the version-log convention (src/content/changelog.ts):
 * newest first, MAJOR.MINOR numbering without gaps, majors end in .0,
 * timestamps never go backwards, and every entry explains itself.
 */
import { describe, expect, it } from "vitest";
import { CURRENT_VERSION, parseVersion, RELEASES } from "@/content/changelog";

describe("version log", () => {
  it("lists versions newest first, each exactly once", () => {
    const keys = RELEASES.map((r) => parseVersion(r.version));
    for (let i = 1; i < keys.length; i++) {
      const [pMaj, pMin] = keys[i - 1] as [number, number];
      const [maj, min] = keys[i] as [number, number];
      expect(
        pMaj > maj || (pMaj === maj && pMin > min),
        `${RELEASES[i - 1]?.version} should be newer than ${RELEASES[i]?.version}`,
      ).toBe(true);
    }
    expect(new Set(RELEASES.map((r) => r.version)).size).toBe(RELEASES.length);
    expect(CURRENT_VERSION).toBe(RELEASES[0]?.version);
  });

  it("uses x.0 for majors and counts minors from 1 without gaps", () => {
    const minorsByMajor = new Map<number, number[]>();
    const majors = new Set<number>();
    for (const r of RELEASES) {
      expect(r.version, r.version).toMatch(/^\d+\.\d+$/);
      const [maj, min] = parseVersion(r.version);
      if (r.kind === "major") {
        expect(min, `${r.version} is a major and must end in .0`).toBe(0);
        majors.add(maj);
      } else {
        expect(min, `${r.version} is a minor and must not end in .0`).toBeGreaterThan(0);
        minorsByMajor.set(maj, [...(minorsByMajor.get(maj) ?? []), min]);
      }
    }
    for (const [maj, minors] of minorsByMajor) {
      expect(majors.has(maj), `minor versions of ${maj} need a ${maj}.0`).toBe(true);
      expect([...minors].sort((a, b) => a - b)).toEqual(minors.map((_, i) => i + 1));
    }
    const sortedMajors = [...majors].sort((a, b) => a - b);
    expect(sortedMajors).toEqual(sortedMajors.map((_, i) => i + 1));
  });

  it("never goes back in time", () => {
    for (let i = 1; i < RELEASES.length; i++) {
      const newer = RELEASES[i - 1];
      const older = RELEASES[i];
      expect(Number.isNaN(Date.parse(older?.date ?? ""))).toBe(false);
      expect(
        Date.parse(newer?.date ?? "") >= Date.parse(older?.date ?? ""),
        `${newer?.version} is dated before ${older?.version}`,
      ).toBe(true);
    }
  });

  it("explains every step", () => {
    for (const r of RELEASES) {
      expect(r.title.length, r.version).toBeGreaterThan(3);
      expect(r.summary.length, r.version).toBeGreaterThan(20);
      expect(r.changes.length, r.version).toBeGreaterThan(0);
      expect(r.tags.length, r.version).toBeGreaterThan(0);
    }
  });
});
