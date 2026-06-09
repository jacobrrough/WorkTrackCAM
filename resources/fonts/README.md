# Bundled fonts

These fonts are bundled inside the WorkTrack3D app so the **Text → machinable
vectors** engine (`src/shared/text-to-vectors.ts`) can run with **no network at
runtime**. The user never installs or sees these files directly — they are an
internal product dependency, exactly like the bundled OrcaSlicer CLI and the
CadQuery sample scripts.

The font is parsed by [`opentype.js`](https://github.com/opentypejs/opentype.js)
(MIT) and its glyph outlines are flattened into closed sketch contours suitable
for V-carve / profile / pocket toolpaths.

## Roboto-Regular.ttf

| | |
|---|---|
| **Family** | Roboto |
| **Style** | Regular |
| **Designer** | Christian Robertson (Google) |
| **License** | Apache License, Version 2.0 |
| **Source** | https://github.com/googlefonts/roboto-2 (`src/hinted/Roboto-Regular.ttf`) |
| **unitsPerEm** | 2048 |

Roboto is licensed under the **Apache License 2.0**, a permissive license that
allows redistribution and bundling inside a commercial desktop application. The
full license text is reproduced below as required by the Apache 2.0 terms (a
NOTICE-style attribution is sufficient; no per-file header is required for the
binary font).

> Copyright 2011 Google Inc. All Rights Reserved.
>
> Licensed under the Apache License, Version 2.0 (the "License");
> you may not use this file except in compliance with the License.
> You may obtain a copy of the License at
>
>     http://www.apache.org/licenses/LICENSE-2.0
>
> Unless required by applicable law or agreed to in writing, software
> distributed under the License is distributed on an "AS IS" BASIS,
> WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
> See the License for the specific language governing permissions and
> limitations under the License.

### Why Apache-2.0 (not OFL)?

The dependency policy for this wave allowed an **OFL- or Apache-licensed** font.
Roboto's Apache-2.0 license is fully compatible with bundling in a closed-source
commercial installer and imposes no copyleft on the rest of WorkTrack3D's code or
on the G-code / sketches produced from the font outlines.

## How it's loaded

`resources/` assets are resolved by the main process via
`src/main/paths.ts` → `getResourcesRoot()` (which handles both the dev tree and
the packaged `process.resourcesPath/resources` layout — the same resolver used
for `resources/orca-slicer` and `resources/samples`). A font path under
`getResourcesRoot()/fonts/Roboto-Regular.ttf` is read into a buffer and handed to
the pure `textToSketchVectors({ fontBuffer, ... })` engine; the engine itself
performs **no** file or network I/O, so it stays unit-testable in the `node`
vitest environment.

## Adding another font later

If a future cycle bundles an additional face, it MUST be **OFL- or
Apache-licensed**, documented in this README (family, style, designer, license,
source URL), and — for OFL fonts — ship the upstream `OFL.txt` alongside the
`.ttf`.
