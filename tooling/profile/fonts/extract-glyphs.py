"""Extrae de las fuentes del sitio los contornos de glifos que usan los SVG del perfil.

Por qué: GitHub muestra las imágenes del README como <img> (vía su proxy camo), donde un SVG no carga fuentes
web y las del sistema cambian según quien mire. Con el texto dibujado como trazos la tipografía del sistema de
diseño sale igual en todos lados, y versionar estos JSON chicos deja al generador de Node sin dependencias
para leer fuentes.

Se corre una vez desde la raíz del repo cuando cambian el juego de caracteres o las fuentes
(requiere `pip install fonttools brotli`):

    python tooling/profile/fonts/extract-glyphs.py

Salida: tooling/profile/fonts/<cara>.json con, por carácter, su avance y un path SVG en unidades de la fuente
con la y hacia abajo (ya invertida: el generador solo escala), más el kerning por pares (GPOS) entre los
caracteres del juego.
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

# ASCII imprimible más la puntuación tipográfica de las tarjetas. Lo demás se dibuja como "?" (src/type.ts).
CHARSET = [chr(c) for c in range(0x20, 0x7F)] + list("·–—’‘“”…×")

# Roles del sistema de diseño (docs/design/DESIGN-SYSTEM.md §3): Gloock display, Pagella lectura, Hanken UI.
FACES = {
    "gloock": ("gloock-latin.woff2", None),
    "pagella": ("pagella-regular-latin.woff2", None),
    "hanken-400": ("hanken-grotesk-latin.woff2", 400),
    "hanken-600": ("hanken-grotesk-latin.woff2", 600),
}


def kerning(font, names):
    """Kerning por pares (XAdvance) entre glifos del juego; como en GPOS, gana la primera subtabla que coincide."""
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
        # Unidades enteras: al tamaño más grande que se usa (60 px, 1000 upm) una unidad es 0,06 px.
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
