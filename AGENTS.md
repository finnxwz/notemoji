# Notemoji – notes for AI agents

Obsidian plugin that gives notes, folders and files an emoji or a custom image, shown next to
their names (file explorer, tabs, note title). Names and notes are never changed.

**Before changing behaviour, read [docs/decisions.md](docs/decisions.md):** it records what the
maintainer decided and why, including rejected ideas.

## Working with the maintainer

- Propose before building: suggest one change at a time with a recommendation; build what was
  agreed. Bug fixes and cleanups within the agreed design are fine.
- Never push, open pull requests or otherwise publish without explicit permission.
- Never open, launch or modify the maintainer's own Obsidian or vaults. Verify with the tests and
  the demo scene; the maintainer tests in Obsidian.
- Keep it small: no new dependencies, settings or abstractions without a clear need.

## Commands

```sh
npm ci
npm run check      # Prettier, ESLint (Obsidian rules), TypeScript, Vitest, production build
npm test           # tests only (Vitest + happy-dom)
OBSIDIAN_VAULT=/path/to/vault npm run dev   # watch build into a test vault
npm run demo       # re-record the README media in docs/media (needs Chromium + ffmpeg)
npm run emoji-data # regenerate src/picker/emoji-data.ts from emojibase
npm run set-previews # regenerate the emoji style previews (downloads the pinned fonts)
```

`npm run check` must pass before every commit.

## Map

| Path                      | What                                                                       |
| ------------------------- | -------------------------------------------------------------------------- |
| `src/main.ts`             | Plugin wiring: events, menus, commands, saving                             |
| `src/data.ts`             | `data.json` shape, defaults, lenient parsing of all versions               |
| `src/internals.ts`        | The only place that touches undocumented Obsidian internals                |
| `src/icons/`              | What an item's icon is: emoji parsing, values, path store, custom icons    |
| `src/style/`              | Emoji styles: downloadable sets, font loading, `EmojiStyle` (font + cache) |
| `src/picker/`             | Picker modal, catalog/search, grid geometry, virtual grid, sprite sheets   |
| `src/display/`            | Rendering in the explorer and on titles (note, tab, view header)           |
| `src/settings/`           | Settings tab and the emoji style cards                                     |
| `styles.css`              | All styles (no inline styles; CSS variables via `setCssProps`)             |
| `tests/obsidian.ts`       | Fake `obsidian` module (the npm package is types only)                     |
| `tests/plugin-harness.ts` | Loads the real plugin against the fake app                                 |
| `scripts/demo/`           | Showcase scene: the real plugin in an Obsidian-like page                   |
| `scripts/record-demo.mjs` | Records GIFs (stop motion) and composed images into `docs/media`           |
| `docs/decisions.md`       | Decisions and their reasons                                                |

## Conventions

- Pure logic (parsing, geometry, search) stays free of DOM and Obsidian imports and gets unit
  tests; UI is tested through the fake app.
- Comments explain _why_; user-facing text is plain English in sentence case.
- No `aria-label` on elements people hover often: Obsidian turns it into a tooltip.
- Write emoji literally in source. Invisible characters (U+FE0F, U+200D) are created with
  `String.fromCodePoint`; some editing tools turn `\u` escapes into invisible literals.
- Network access only on an explicit user click, pinned and checksum-verified.
- Files only inside the plugin folder; `onunload` cleans up the DOM, never user files.
- When the UI changes visibly, re-record the media (`npm run demo`) and check the README.
