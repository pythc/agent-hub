# Roppo Mono

macOS Terminal falls back from Menlo to Apple Braille for U+2800–U+28FF.
Apple Braille's four dot rows do not span Menlo's line height, leaving visible
horizontal bands in the three-line companion.

Roppo Mono includes all 256 Braille patterns itself. Round dots are spaced over
the font's complete ascent/descent, so the last dot row of one character and the
first row of the next have the same nominal spacing as the rows inside a glyph.
The CLI's bitmap, R silhouette, animations and three-row layout stay the same.

## macOS Terminal setup

From the checkout:

```sh
npm run setup:terminal-font
open ~/.roppo/terminal/Roppo.terminal
```

Run `roppo` in the new window. The separate **Roppo** profile uses **Roppo Mono,
12 pt**, with standard line and character spacing. It does not change Terminal's
default profile. An already open window keeps its old font; restarting only the
CLI in that window does not select the new font.

Alternatively, select **Roppo Mono** in Terminal → Settings → Profiles → Text →
Font for the profile you use. All text in that profile uses the new monospace
font; Chinese characters continue to use macOS font fallback. Conversation,
account and model settings are unaffected.

The installer copies the font to `~/Library/Fonts/RoppoMono-Regular.ttf` and the
profile to `~/.roppo/terminal/Roppo.terminal`. It does not automate Terminal,
change system preferences or delete existing files.

## Source and license

Based on [JetBrains Mono 2.304 Regular](https://github.com/JetBrains/JetBrainsMono/tree/v2.304),
under the [SIL Open Font License](OFL.txt). The derivative is named **Roppo Mono**.
Normal text glyphs and font metrics are retained. The changes are the Braille
glyphs and font identity; Roppo does not distribute a modified Apple font.

To rebuild, install Python `fonttools==4.61.1`, obtain the upstream
`fonts/ttf/JetBrainsMono-Regular.ttf` at tag `v2.304`, and run:

```sh
python3 tools/fonts/build-roppo-mono.py /path/to/JetBrainsMono-Regular.ttf
```

Validation on macOS: CoreText resolves all 256 Braille characters to Roppo Mono,
each with the same 7.2 pt advance at 12 pt. Three rows of full-dot characters
render as twelve evenly spaced dot rows. At 2× scale measured adjacent row
centers are 7.91–8.27 px apart, including the two text-row boundaries. This is
a native font rendering check, not an automated Terminal.app acceptance test.
