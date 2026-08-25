# Excalidraw scene fonts (self-hosted)

The fonts Excalidraw draws **canvas content** with. Vendored so the whiteboard
works with no network at all.

Without these, Excalidraw's font loader builds its URL list from
`window.EXCALIDRAW_ASSET_PATH` and then always appends
`https://esm.sh/@excalidraw/excalidraw@<version>/dist/prod/` as a fallback — so
with the global unset that CDN is the *only* source. The global is set in
`frontend/components/excalidraw-asset-path.ts`, imported before the library.

The failure mode is quiet: the canvas opens fine and nothing looks wrong. A font
is fetched only when a glyph needs it, so you have to actually **type** to see
the request. `frontend/third-party-origins.test.ts` pins the wiring.

## Licences

Every family here is redistributable, and each licence requires the notice to
travel with the font. Taken from each font's own `name` table (IDs 0 and 14),
not from memory.

| Family | Files | Size | Licence | Copyright |
|---|---:|---:|---|---|
| Xiaolai SC | 209 | 12.1 MB | **SIL OFL 1.1** — [lxgw/kose-font](https://github.com/lxgw/kose-font) | © 2020 LXGW |
| Assistant | 4 | 79 KB | SIL OFL 1.1 | © 2020 The Assistant Project Authors |
| Nunito | 5 | 56 KB | SIL OFL 1.1 | © 2014 The Nunito Project Authors |
| Lilita One | 2 | 11 KB | SIL OFL 1.1 | © 2011 Juan Montoreano |
| Virgil | 1 | 54 KB | SIL OFL 1.1 | © 2011 Your Own Font Foundry |
| Cascadia Code | 1 | 64 KB | SIL OFL 1.1 | © 2020 Microsoft Corporation |
| Comic Shanns | 4 | 30 KB | **MIT** (full text in the font's own copyright field) | © 2018 Shannon Miwa and contributors |
| Liberation Sans | 1 | 69 KB | [Liberation Fonts licence](http://www.ascendercorp.com/liberation.html) | Digitized data © 2007 Ascender Corporation |
| Excalifont | 7 | 63 KB | ships in the MIT-licensed `@excalidraw/excalidraw` package | © 2024 Excalidraw |

The SIL OFL text sits beside these files in [`OFL.txt`](./OFL.txt), so it
travels with them into `dist/` when the viewer is deployed — which is what the
licence actually asks for. (The app's own UI fonts carry their copy at
`frontend/fonts/OFL.txt`.)

## Why Xiaolai SC is 12 MB

It carries **41,577 codepoints, 20,949 of them CJK ideographs**. A Latin font
needs a few hundred glyphs; a Chinese one needs tens of thousands. It ships as
209 subset files and `unicode-range` means the browser fetches only the handful
holding the characters actually typed — so the 12 MB is repo cost, not page
weight.

It is here deliberately. Leaving it out would have meant Chinese users, and only
Chinese users, silently falling back to a CDN while everyone else worked
offline.

## Regenerating

Copy the whole directory from the installed package — the layout must match
exactly, or the URLs 404 and Excalidraw falls through to its CDN fallback
without complaining:

```bash
cp -R node_modules/@excalidraw/excalidraw/dist/prod/fonts \
      frontend/public/excalidraw-assets/
```

Verify afterwards by opening the whiteboard, typing, and confirming
`performance.getEntriesByType('resource')` shows no `esm.sh` entry.
