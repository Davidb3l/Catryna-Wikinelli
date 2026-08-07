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

Only the **latin** and **latin-ext** subsets. Cyrillic, Greek and Vietnamese are
not vendored — add them to the URL below and to `../styles/fonts.css` if a
corpus needs them.

## Regenerating

Fetch the CSS Google serves for a modern browser, then download each `src` URL.
The `unicode-range` declarations in `../styles/fonts.css` are copied **verbatim**
from this output — keep them, or subsetting stops working and every page pulls
every subset.

```bash
curl -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36" \
  'https://fonts.googleapis.com/css2?family=Inter:wght@400..700&family=JetBrains+Mono:wght@400..500&family=Fraunces:opsz,wght@9..144,400..600&family=Hanken+Grotesk:wght@300..700&display=swap'
```

Weight ranges must stay in step with what the app uses — see the `font-black`
note in the `frontend/overview` doc before widening any of them.
