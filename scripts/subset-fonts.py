"""
Cuts the self-hosted Inter files from an Inter release (https://github.com/rsms/inter,
v4.1, SIL Open Font License), so the font files in the repo can be rebuilt and
checked rather than trusted.

  python scripts/subset-fonts.py <folder of the unzipped Inter release>

Needs fontTools with brotli (pip install fonttools brotli). Writes:

- src/app/fonts/Inter-Latin.woff2 and Inter-LatinExt.woff2: the variable font
  (optical size 14-32 and weight 400-700) split into the interface's Latin
  characters and the extended Latin, Vietnamese and Greek ones. layout.tsx gives
  each its unicode-range, so the second downloads only when a page needs it.
- public/fonts/Inter-Regular.ttf and Inter-SemiBold.ttf: static text cuts for
  the text PDFs (jsPDF embeds only the glyphs it uses) and the social image.

The ranges below must match INTER_LATIN and INTER_LATIN_EXT in layout.tsx.
"""

import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

LATIN = (
    "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0394,U+03A3,U+03A9,"
    "U+03BB,U+03BC,U+03C0,U+03C3,U+2000-206F,U+2070-209F,U+20A0-20CF,U+2122,U+2150-218F,"
    "U+2190-21FF,U+2200-22FF,U+2300-23FF,U+25A0-25FF,U+FEFF,U+FFFD"
)
LATIN_EXT = "U+0100-024F,U+0259,U+02B0-02FF,U+0300-036F,U+0370-03FF,U+1E00-1EFF,U+FB01-FB02"

# Every OpenType feature the interface may switch on (tabular figures, case-sensitive forms,
# disambiguation sets, fractions); the circled and squared letter sets are left out.
FEATURES = (
    "calt,case,ccmp,cv01,cv02,cv03,cv04,cv05,cv06,cv07,cv08,cv09,cv10,cv11,cv12,cv13,cv14,dnom,"
    "frac,kern,liga,locl,mark,mkmk,numr,ordn,pnum,sinf,ss01,ss02,ss03,ss04,ss07,ss08,subs,sups,tnum,zero"
)


def run(*args: str) -> None:
    subprocess.run([sys.executable, "-m", *args], check=True)


def main(release: Path) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        limited = str(Path(tmp) / "inter-400-700.ttf")
        run("fontTools.varLib.instancer", str(release / "InterVariable.ttf"), "wght=400:700", "-o", limited)
        for name, ranges in (("Inter-Latin", LATIN), ("Inter-LatinExt", LATIN_EXT)):
            out = ROOT / "src" / "app" / "fonts" / f"{name}.woff2"
            run("fontTools.subset", limited, f"--unicodes={ranges}", f"--layout-features={FEATURES}",
                "--flavor=woff2", f"--output-file={out}")
    for weight in ("Regular", "SemiBold"):
        out = ROOT / "public" / "fonts" / f"Inter-{weight}.ttf"
        run("fontTools.subset", str(release / "extras" / "ttf" / f"Inter-{weight}.ttf"),
            f"--unicodes={LATIN},{LATIN_EXT}", "--layout-features=kern,liga,ccmp,locl,mark,mkmk",
            f"--output-file={out}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(Path(sys.argv[1]))
