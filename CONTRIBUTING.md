# Contributing to Notemoji

Thanks for helping! Bug reports and ideas are welcome as GitHub issues. For larger changes,
please open an issue first: [docs/decisions.md](docs/decisions.md) explains what the plugin
deliberately does and does not do.

## Setup

Node 24 or newer (the version in `.nvmrc`, which CI uses too).

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
npm run demo           # re-records everything; --only=styles,banner for some of it
```

It needs Chromium for Playwright (`npx playwright-core install chromium`), ffmpeg, and a colour
emoji font. gifsicle and pngquant, when installed, make the files smaller.

## Words for automatic emoji in another language

Add a file like `src/icons/auto-emoji-words/de.ts` for the language's code (as Obsidian reports
it) and list it in `LANGUAGES` in `src/icons/auto-emoji-themes.ts`. It names theme words and
obvious hits for the existing emoji groups, and English words that mean something else in that
language. The tests check that every emoji works on all systems and that no word is listed twice.

## Releases

Releases are built by the _Release_ workflow (`.github/workflows/release.yml`). For now it only
runs when started by hand, so the release process can be tested first; starting it on a pushed
version tag can be added later. GitHub offers _Run workflow_ only once the workflow file is on the
default branch, so the first run is the real one for that version: it only makes a draft, which
you can check and delete.

1. **Raise the version** in `manifest.json`, `package.json`, `package-lock.json` (both version
   fields) and `versions.json` (the new version with its `minAppVersion`). A test checks that they
   agree, so `npm run check` fails if one is missed. Obsidian uses the version without a `v`.
2. **Commit and push** that change to the default branch (`main`): Obsidian reads the version
   from `manifest.json` there.
3. **Start the workflow:** on GitHub, open _Actions_ → _Release_ → _Run workflow_, choose `main`
   and confirm. It:
   - stops if it runs on another branch, or if the version already has a tag, a release or a
     draft, so a published version is not replaced;
   - runs `npm ci` and `npm run check` (formatting, lint, types, tests and the build of `main.js`)
     in a job that can only read the repository, so the dependencies they run can't write to it;
   - signs `main.js`, `manifest.json` and `styles.css` (an artifact attestation: a record, signed
     by GitHub, that these exact files were built by this workflow from this commit);
   - creates a **draft** release with those three files and notes generated from the changes.
4. **Check the draft** on the _Releases_ page: the version, the notes (edit them as you like) and
   the three files. A draft is only visible to maintainers.
5. **Publish it.** Publishing creates the version tag on the commit the workflow built from.
   There is no step in Obsidian's developer dashboard: Obsidian finds the new release on GitHub,
   users get it with _Check for updates_ in Obsidian's community plugins settings, and the
   community directory reviews every release automatically (its scorecard then shows the
   signed files). If a release fails that review, the details are in the developer dashboard.
   To check a branch before releasing, the dashboard can also run a preview scan.

If a step fails, the run stops and nothing is released: open the run in the _Actions_ tab to see
which step and why. To start over for the same version, delete its draft on the _Releases_ page
first. To check the signature of a downloaded file (GitHub CLI 2.49 or newer):

```sh
gh attestation verify main.js --repo finnxwz/notemoji
```
