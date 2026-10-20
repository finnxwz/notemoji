# Contributing to Notemoji

Thanks for helping! Bug reports and ideas are welcome as GitHub issues. For larger changes,
please open an issue first: [docs/decisions.md](docs/decisions.md) explains what the plugin
deliberately does and does not do.

## Setup

```sh
npm ci
OBSIDIAN_VAULT=/path/to/test/vault npm run dev   # builds into the vault; pair with the Hot Reload plugin
npm run check                                    # format, lint, typecheck, tests and build
```

Use a separate test vault, not your real one.

## Project layout

See the map in [AGENTS.md](AGENTS.md). In short: `src/icons` (what an icon is and where it is
stored), `src/style` (emoji styles), `src/picker`, `src/display` (explorer and titles),
`src/settings`. Tests run against a small fake of Obsidian in `tests/obsidian.ts`.

## README media

The GIFs and images in `docs/media` are recorded from the real plugin running in an
Obsidian-like page:

```sh
npm run set-previews   # once: downloads the pinned emoji fonts the style GIF uses
npm run demo           # re-records everything; --only=picker,banner for some of it
```

It needs Chromium for Playwright (`npx playwright-core install chromium`), ffmpeg, and a colour
emoji font. gifsicle, when installed, makes the GIFs smaller.
