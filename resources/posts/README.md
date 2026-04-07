# G-code post templates (`resources/posts/`)

Handlebars (`.hbs`) files rendered by [`src/main/post-process.ts`](../../src/main/post-process.ts) when the app generates CNC output. The **`postTemplate`** field on each machine profile ([`../machines/`](../machines/README.md)) must match a filename in this folder.

## Bundled templates

| File | Used by | Role |
|------|---------|------|
| **`cnc_generic_mm.hbs`** | All shipped [`machines/*.json`](../machines/README.md) today | Minimal header (safety + WCS/units + **tool-change** reminders), `{{units}}`, spindle snippets, `{{#each toolpathLines}}`. |

## Template context (`PostContext`)

Populated in **`renderPost()`** — keep variable names stable if you add templates:

| Key | Type | Meaning |
|-----|------|---------|
| `machine` | object | Full parsed machine profile (see [`machine-schema.ts`](../../src/shared/machine-schema.ts)). |
| `toolpathLines` | `string[]` | One G-code line per entry (no header/footer). |
| `spindleOn` / `spindleOff` | `string` | From **`dialect`** (`grbl` / `mach3` / `generic_mm`) — not a substitute for reading your control manual. |
| `units` | `G21` \| `G20` | Emitted on the `{{units}}` line; current snippets default to **G21** per dialect helper — still verify against your controller. |
| `wcsLine` | `string?` | Present when manufacture pass supplies work offset index 1–6 (e.g. `G54`…`G59`). |

## Comments in templates

- **`{{!-- … --}}`** — Handlebars block comments: **not** written to the generated G-code. Use for maintainer notes (conventions, context keys, parsing pitfalls).
- **Lines starting with `;`** — emitted as **G-code comments** in the output file for the operator. These are intentional; keep the same **unverified-output** tone as [`cnc_generic_mm.hbs`](cnc_generic_mm.hbs).
- **Tool change / ATC** — Unless `PostContext` gains explicit multi-tool data (coordinate **Stream D**), operator-visible `;` lines should state that the template does **not** emit M6/ATC sequences by default and that multi-tool jobs need manual or custom blocks.

## Adding a template

1. Add **`your_post.hbs`** here with the same **unverified-output** tone as `cnc_generic_mm.hbs` (dry run, WCS, `docs/MACHINES.md`).
2. Set **`postTemplate`** on a machine JSON to **`your_post.hbs`** (see [`../machines/README.md`](../machines/README.md)).
3. Prefer **no** `src/` changes; if the context is insufficient, coordinate **Stream D** / **Stream S** for a typed extension to `PostContext`.

## Safety

Templates must **not** promise safe G-code. See **[`docs/MACHINES.md`](../../docs/MACHINES.md)**.
