# Self-hosted webfonts

Vendored so the viewer makes **no third-party request** and renders its own
typography offline. They replaced a render-blocking `<link>` to
`fonts.googleapis.com` plus two `preconnect`s.

Declared in [`../styles/fonts.css`](../styles/fonts.css), imported eagerly from
`../index.css`. Vite hashes them into `dist/assets/` at build.

## Licence

All four families are under the **SIL Open Font License 1.1**, reproduced in
[`OFL.txt`](./OFL.txt). The OFL requires the licence to travel with the fonts,
which is why that file is here — do not delete it when updating them.

| Family | Copyright | Upstream |
|---|---|---|
| Inter | Copyright 2016 The Inter Project Authors | https://github.com/rsms/inter |
| JetBrains Mono | Copyright 2020 The JetBrains Mono Project Authors | https://github.com/JetBrains/JetBrainsMono |
| Fraunces | Copyright 2020 The Fraunces Project Authors | https://github.com/undercasetype/Fraunces |
| Hanken Grotesk | Copyright 2021 The Hanken Grotesk Project Authors | https://github.com/marcologous/hanken-grotesk |

Each is distributed by Google Fonts from `ofl/<family>/` in
[google/fonts](https://github.com/google/fonts), whose `METADATA.pb` records
`license: "OFL"`.

## What is vendored, and what is not

**Variable** fonts requested as weight **ranges**, not discrete weights. That is
what makes self-hosting cheaper than the CDN was: one file per family per subset
covers every weight, so four static Inter instances collapse into one.

**Every subset Google publishes for these four families** — latin, latin-ext,
cyrillic, cyrillic-ext, greek, greek-ext, vietnamese. Nothing is deliberately
left out, so there is no script these families can render that the viewer has to
go online for.

That is 20 files, not 28, because **Google's own coverage is uneven** and the
gaps are upstream. Verified empirically against the CSS the command below
returns — do not assume a family publishes a subset just because another one
does:

| Family | latin | latin-ext | cyrillic | cyrillic-ext | greek | greek-ext | vietnamese |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Inter | ● | ● | ● | ● | ● | ● | ● |
| JetBrains Mono | ● | ● | ● | ● | ● | — | ● |
| Hanken Grotesk | ● | ● | — | ● | — | — | ● |
| Fraunces | ● | ● | — | — | — | — | ● |

What the dashes mean when someone reads a doc:

- **Atelier has no Greek face at all.** Its display face is Fraunces and its body
  face is Hanken Grotesk, neither of which publishes Greek, so Greek renders in
  the Georgia/serif and system-sans fallbacks. Cyrillic *headings* fall back the
  same way; Cyrillic body text is covered by Hanken Grotesk's `cyrillic-ext`.
- **Classic covers Greek, Cyrillic and Vietnamese in full**, except polytonic
  Greek (`greek-ext`) inside code blocks — JetBrains Mono does not publish it,
  so that falls back to the system monospace.
- **Vietnamese is complete in both themes**; it is the one non-Latin subset all
  four families publish.

Adding these subsets added **no new family**, so `OFL.txt` did not change. That
was checked rather than assumed: each new file's own `name` table reports one of
the four families already listed above, with the same copyright string.

## Regenerating

Fetch the CSS Google serves for a modern browser, then download each `src` URL.
The `unicode-range` declarations in `../styles/fonts.css` are copied **verbatim**
from this output — keep them, or subsetting stops working and every page pulls
every subset.

```bash
curl -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36" \
  'https://fonts.googleapis.com/css2?family=Inter:wght@400..700&family=JetBrains+Mono:wght@400..500&family=Fraunces:opsz,wght@9..144,400..600&family=Hanken+Grotesk:wght@300..700&display=swap'
```

That one request returns **every** subset each family publishes — there is no
`subset=` parameter to add, so the CSS above is the authority on what exists.
Save each `src` to `<family-slug>-<subset>.woff2` here, and reproduce the block
in `../styles/fonts.css` with only the `src` rewritten to the local path.

Two things worth checking on the way through, both of which have a real failure
mode behind them:

- The **UA string is load-bearing.** Google serves woff2 with `unicode-range`
  only to a browser it recognises; an unset or curl-default agent gets a single
  fat TTF face per family and the subsetting disappears.
- Confirm the files are **variable**: `fvar` should report a `wght` axis (and
  `opsz` for Fraunces). A static instance would still render, at roughly 3.5x
  the bytes for the same coverage.

Weight ranges must stay in step with what the app uses — see the `font-black`
note in the `frontend/overview` doc before widening any of them.
