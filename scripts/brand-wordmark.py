"""
Writes the Loupe brand files in public/brand and src/app/icon.svg (version 50.0).

The mark is a lens rim (a neutral ring), an accent measuring arc and a focal point; the wordmark sets
"Loupe" beside it in Inter SemiBold, drawn as outlines so the files need no font. The accent is the
theme's (--accent of styles/theme-dark.css and theme-light.css): periwinkle on dark, indigo on light.

Run from the repository root:  python scripts/brand-wordmark.py
Needs fontTools (pip install fonttools) and public/fonts/Inter-SemiBold.ttf.
"""

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

FONT = "public/fonts/Inter-SemiBold.ttf"
# The two themes: ink for the ring and the word, accent for the arc and the focal point.
THEMES = {
    "dark": {"ink": "#edeff3", "accent": "#8995f4"},
    "light": {"ink": "#14171e", "accent": "#504bdd"},
}
# The word's cap height and baseline in the mark's 32-unit grid, and the gap after the mark.
CAP_HEIGHT = 24.0
BASELINE = 27.5
WORD_X = 41.0
TRACKING = -0.02  # of the font size, as the display sizes set it


def mark(ink: str, accent: str) -> str:
    return (
        f'<circle cx="16" cy="16" r="12" fill="none" stroke="{ink}" stroke-opacity="0.24" stroke-width="1.6"/>'
        f'<path d="M16 4a12 12 0 1 1-11.32 8" fill="none" stroke="{accent}" stroke-width="1.9" stroke-linecap="round"/>'
        f'<circle cx="16" cy="16" r="3.4" fill="{accent}"/>'
        f'<circle cx="21.6" cy="10.4" r="1.15" fill="{ink}" fill-opacity="0.55"/>'
    )


def word() -> tuple[str, float]:
    """The outlines of "Loupe" in the mark's units, and the x where the word ends."""
    font = TTFont(FONT)
    glyphs = font.getGlyphSet()
    cmap = font.getBestCmap()
    cap = font["OS/2"].sCapHeight
    scale = CAP_HEIGHT / cap
    size = font["head"].unitsPerEm * scale
    pen = SVGPathPen(glyphs, ntos=lambda v: f"{v:.2f}".rstrip("0").rstrip("."))
    x = WORD_X
    for ch in "Loupe":
        name = cmap[ord(ch)]
        # Font units are y-up; the SVG is y-down from the baseline.
        glyphs[name].draw(TransformPen(pen, (scale, 0, 0, -scale, x, BASELINE)))
        x += glyphs[name].width * scale + TRACKING * size
    return pen.getCommands(), x


def main() -> None:
    path, end = word()
    width = round(end + 2, 1)
    for theme, c in THEMES.items():
        ink, accent = c["ink"], c["accent"]
        with open(f"public/brand/loupe-mark-{theme}.svg", "w", encoding="utf8", newline="\n") as f:
            f.write(
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="64" height="64" role="img" '
                f'aria-label="Loupe"><title>Loupe</title>{mark(ink, accent)}</svg>'
            )
        with open(f"public/brand/loupe-wordmark-{theme}.svg", "w", encoding="utf8", newline="\n") as f:
            f.write(
                f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -2 {width} 38" width="{round(width * 4)}" '
                f'height="152" role="img" aria-label="Loupe"><title>Loupe</title>{mark(ink, accent)}'
                f'<path d="{path}" fill="{ink}"/></svg>'
            )
    dark = THEMES["dark"]
    with open("src/app/icon.svg", "w", encoding="utf8", newline="\n") as f:
        f.write(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">\n'
            '  <rect width="32" height="32" rx="8" fill="#0b0c10"/>\n'
            f'  <circle cx="16" cy="16" r="10.5" stroke="{dark["ink"]}" stroke-opacity="0.28" stroke-width="1.6"/>\n'
            f'  <path d="M16 5.5a10.5 10.5 0 1 1-9.9 7" stroke="{dark["accent"]}" stroke-width="2" stroke-linecap="round"/>\n'
            f'  <circle cx="16" cy="16" r="3.2" fill="{dark["accent"]}"/>\n'
            "</svg>\n"
        )


if __name__ == "__main__":
    main()
