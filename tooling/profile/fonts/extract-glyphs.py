"""Extracts from the site's fonts the glyph outlines that the profile SVGs use.

Why: GitHub shows README images as <img> (through its camo proxy), where an SVG loads no web fonts and system
fonts vary by viewer. With the text drawn as outlines the design system's type looks the same everywhere, and
versioning these small JSON files keeps the Node generator free of font-reading dependencies.

Run it once from the repo root when the character set or the fonts change
(requires `pip install fonttools brotli`):

    python tooling/profile/fonts/extract-glyphs.py

Output: tooling/profile/fonts/<face>.json with, per character, its advance and an SVG path in font units with y
pointing down (already flipped: the generator only scales), plus the pair kerning (GPOS) between the characters
of the set.
"""

import json
import pathlib

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = pathlib.Path(__file__).resolve().parents[3]
SOURCE = ROOT / "apps/web/public/fonts"
OUT = pathlib.Path(__file__).resolve().parent

# Printable ASCII plus the cards' typographic punctuation. Anything else is drawn as "?" (src/type.ts).
CHARSET = [chr(c) for c in range(0x20, 0x7F)] + list("·–—’‘“”…×")

# Design system roles (docs/design/DESIGN-SYSTEM.md §3): Gloock display, Pagella reading, Hanken UI.
FACES = {
    "gloock": ("gloock-latin.woff2", None),
    "pagella": ("pagella-regular-latin.woff2", None),
    "hanken-400": ("hanken-grotesk-latin.woff2", 400),
    "hanken-600": ("hanken-grotesk-latin.woff2", 600),
}


def kerning(font, names):
    """Pair kerning (XAdvance) between glyphs of the set; as in GPOS, the first matching subtable wins."""
    pairs = {}
    if "GPOS" not in font:
        return pairs
    gpos = font["GPOS"].table
    lookup_ids = sorted({i for fr in gpos.FeatureList.FeatureRecord if fr.FeatureTag == "kern"
                         for i in fr.Feature.LookupListIndex})
    wanted = set(names.values())
    for index in lookup_ids:
        lookup = gpos.LookupList.Lookup[index]
        for sub in lookup.SubTable:
            kind = lookup.LookupType
            if kind == 9:
                kind, sub = sub.ExtensionLookupType, sub.ExtSubTable
            if kind != 2:
                continue
            covered = [g for g in sub.Coverage.glyphs if g in wanted]
            if sub.Format == 1:
                index_of = {g: i for i, g in enumerate(sub.Coverage.glyphs)}
                for first in covered:
                    for record in sub.PairSet[index_of[first]].PairValueRecord:
                        if record.SecondGlyph in wanted:
                            value = getattr(record.Value1, "XAdvance", 0) if record.Value1 else 0
                            pairs.setdefault((first, record.SecondGlyph), value or 0)
            elif sub.Format == 2:
                class1 = sub.ClassDef1.classDefs
                class2 = sub.ClassDef2.classDefs
                for first in covered:
                    row = sub.Class1Record[class1.get(first, 0)]
                    for second in wanted:
                        record = row.Class2Record[class2.get(second, 0)]
                        value = getattr(record.Value1, "XAdvance", 0) if record.Value1 else 0
                        pairs.setdefault((first, second), value or 0)
    by_name = {v: k for k, v in names.items()}
    return {by_name[a] + by_name[b]: v for (a, b), v in sorted(pairs.items()) if v}


def extract(file, weight):
    font = TTFont(SOURCE / file)
    if weight is not None:
        font = instancer.instantiateVariableFont(font, {"wght": weight})
    cmap = font.getBestCmap()
    glyph_set = font.getGlyphSet()
    names = {ch: cmap[ord(ch)] for ch in CHARSET if ord(ch) in cmap}
    glyphs = {}
    for ch, name in names.items():
        # Whole units: at the largest size in use (60 px, 1000 upm) one unit is 0.06 px.
        svg = SVGPathPen(glyph_set, ntos=lambda n: str(round(n)))
        glyph_set[name].draw(TransformPen(svg, (1, 0, 0, -1, 0, 0)))
        glyphs[ch] = {"a": glyph_set[name].width, "d": svg.getCommands()}
    return {
        "unitsPerEm": font["head"].unitsPerEm,
        "ascender": font["hhea"].ascent,
        "descender": font["hhea"].descent,
        "capHeight": getattr(font["OS/2"], "sCapHeight", 0),
        "glyphs": glyphs,
        "kern": kerning(font, names),
    }


for face, (file, weight) in FACES.items():
    data = extract(file, weight)
    (OUT / f"{face}.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(face, len(data["glyphs"]), "glyphs,", len(data["kern"]), "kerning pairs")
