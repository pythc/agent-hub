#!/usr/bin/env python3
"""Build Roppo Mono from JetBrains Mono 2.304 (fontTools 4.61.1).

The font and this font-build script are licensed under SIL OFL 1.1.
Usage: python3 tools/fonts/build-roppo-mono.py JetBrainsMono-Regular.ttf
Upstream: https://github.com/JetBrains/JetBrainsMono/tree/v2.304
"""
import sys
from pathlib import Path

from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

font = TTFont(sys.argv[1], recalcTimestamp=False)
width = font['hmtx'].metrics[font.getBestCmap()[ord('M')]][0]
ascent, descent = font['hhea'].ascent, font['hhea'].descent
pitch = (ascent - descent) / 4
radius = width / 10
order = list(font.getGlyphOrder())
bits = ((1, 8), (2, 16), (4, 32), (64, 128))

for mask in range(256):
    name = f'roppoBraille{mask:02X}'
    pen = TTGlyphPen(None)
    curves = Cu2QuPen(pen, max_err=0.5)
    for row in range(4):
        for column in range(2):
            if not mask & bits[row][column]:
                continue
            x = width * (column + 0.5) / 2
            y = ascent - pitch * (row + 0.5)
            r, k = radius, radius * 0.5522847498
            curves.moveTo((x + r, y))
            curves.curveTo((x + r, y - k), (x + k, y - r), (x, y - r))
            curves.curveTo((x - k, y - r), (x - r, y - k), (x - r, y))
            curves.curveTo((x - r, y + k), (x - k, y + r), (x, y + r))
            curves.curveTo((x + k, y + r), (x + r, y + k), (x + r, y))
            curves.closePath()
    glyph = pen.glyph()
    font['glyf'][name] = glyph
    glyph.recalcBounds(font['glyf'])
    font['hmtx'].metrics[name] = (width, glyph.xMin if mask else 0)
    order.append(name)
    for table in font['cmap'].tables:
        if table.isUnicode():
            table.cmap[0x2800 + mask] = name

font.setGlyphOrder(order)
names = {
    1: 'Roppo Mono', 2: 'Regular', 3: 'Roppo Mono Regular 1.000',
    4: 'Roppo Mono Regular', 5: 'Version 1.000', 6: 'RoppoMono-Regular',
    16: 'Roppo Mono', 17: 'Regular',
}
for record in font['name'].names:
    if record.nameID in names:
        record.string = names[record.nameID].encode(record.getEncoding())
    elif record.nameID == 0:
        record.string = (record.toUnicode() + '; Roppo dot glyphs Copyright 2026 lljjcc426').encode(record.getEncoding())
font['head'].fontRevision = 1.0
output = Path(__file__).resolve().parents[2] / 'assets/terminal/RoppoMono-Regular.ttf'
output.parent.mkdir(parents=True, exist_ok=True)
font.save(output)
print(output)
