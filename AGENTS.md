# AGENTS.md — working in Lichen Journal

Operating contract for AI coding agents in this repository. Read this before
editing anything. Product architecture, storage paths, privacy guarantees and
release steps live in [`README.md`](README.md) and
[`docs/release.md`](docs/release.md).

## 1. The git contract

> **Commit after a task is done. Push only when explicitly asked.**

| Action | Who | When |
| --- | --- | --- |
| `git commit` | **The agent, unprompted** | As soon as a task is complete and verified. Do not leave finished work sitting in the working tree and do not ask whether to commit. |
| `git push` | **Only when the human explicitly says so** | On an unambiguous instruction such as *"push"*, *"push it"*, *"push that"* or *"push to origin"*. A previous push does not authorise the next one. |

- **Never push on your own initiative.** A green test run, a clean diff or a
  finished task are not permission. `commit ≠ push`.
- **A commit is the definition of "task done."** The loop is:
  implement → verify → commit → report the hash → **stop and wait**.
- **Explicit push only.** If the intent is ambiguous ("ship it", "get it up
  there"), ask before pushing. "Commit" means commit, not push.
- **Report every commit** with the short SHA and subject in the final message,
  and state that it has not been pushed.
- **Never rewrite published history** without explicit permission: no
  force-push, no rebasing or amending commits already on `origin/main`, and no
  `reset --hard` against published commits.
- **Never commit secrets or generated credentials.**

The remote is `origin` → `https://github.com/DevTarlow/lichen-journal.git`; the
working branch is `main`. A local `gitea` remote may remain as a private backup
of the earlier history; do not push the fresh GitHub history there unless asked.
Do not print credential-helper output or put tokens in URLs, remote config, logs
or commits.

## 2. Task loop

1. **Orient.** Read this file and the relevant part of `README.md`. Check
   `git status --short --branch` and `git log --oneline -5` before editing.
2. **Change the smallest correct thing.** Keep unrelated cleanup out of the
   task. Update the documentation the change touches, including `README.md`
   whenever the change pertains to it (see §4).
3. **Verify** with the minimum gate for the kind of change (see §3).
4. **Commit** with a Conventional Commit message (see §4).
5. **Report** the short hash and subject; explicitly note "not pushed".
6. **Wait.** Do not run `git push` until the human asks.

A question or analysis with no file changes needs no commit. If a task cannot be
verified, report the failure instead of committing a red tree.

## 3. Commands and verification

| Command | What it covers | Typical use |
| --- | --- | --- |
| `npm run dev` | Vite on `127.0.0.1:5173` plus Electron | Inner loop |
| `npm test` | Vitest: vault, FTS, export, purge, ritual, AI/OCR normalization, model download store | Every code change |
| `npm run build` | Production renderer bundle in `dist/` | Every renderer/UI change |
| `npm run test:e2e` | Playwright Electron: boot, autosave, search, mood, finish-page overview, privacy, export, offline, purge, AI, photo import, first-run model setup | Main/preload/renderer/security changes |
| `npm run smoke:ai` | Real model reflection + metadata + palette, direct in Node | AI prompt/runtime changes |
| `npm run smoke:ocr` | Real MiniCPM-OCR read of the committed fixture | OCR/runtime changes |
| `npm run selftest` | Packaged-style vault + optional companion/OCR + export + network + purge self-test | Before packaging or after main-process changes |
| `npm run model:verify` | SHA-256 and size of the three development GGUFs | Release and dependency work |
| `npm run ocr:runtime:fetch` | Download the pinned llama.cpp OCR runtime for this platform | Fresh checkout or packaging |
| `npm run ocr:runtime:verify` | Start the bundled OCR runtime and verify it | Release and dependency work |
| `npm run dist:dir` | Unpacked build for the current OS | Packaging checks |
| `npm run dist` | Installer/AppImage for the current OS | Release artifact |
| `npm run icons` | Regenerate `build/icon.png` from `build/icon.svg` | Branding changes |

**Before every commit that changes code:** run the applicable gate once, after
the targeted checks are green. `npm test` remains the unit gate; while iterating
use the smallest Vitest scope (see *Test execution efficiency* below). For
renderer/UI, main/preload, security or AI changes, also run `npm run build` and
the relevant subset of `npm run test:e2e`. Run the full E2E suite only when the
change affects shared utilities, global state, or public interfaces across the
app shell; a localized change needs the matching E2E test, not the whole suite.
A documentation-only or comment-only change needs no test run.

**Before every push:** run the gates for the changed surface, confirm the tree is
clean, confirm the branch is `main`, then push `origin main` and verify the
remote ref matches the local commit. Never claim a check that was not executed.

**Before a release:** run `npm run model:verify`, `npm run ocr:runtime:verify`,
`npm run smoke:ai`, `npm run smoke:ocr`, `npm test`, `npm run build`, the E2E
suite, and a packaged `dist:dir` self-test. The packaged self-test should run both
without model files and with `LICHEN_MODEL_DIR="$PWD/models"` so the optional AI
and OCR paths are exercised. For packaging or dependency changes, rebuild the
installer/AppImage and repeat the packaged self-test.

### Headless and test environments

- Electron needs a display. On headless Linux use
  `xvfb-run -a env ELECTRON_OZONE_PLATFORM_HINT=x11 npm run test:e2e`.
- `--no-sandbox` and `--disable-gpu` are test/container flags only. Do not make
  them required for normal desktop use.
- Tests pass an isolated `LICHEN_USER_DATA_DIR`, plus
  `--user-data-dir=<same path>`, so they never touch a real journal.
- `LICHEN_SELFTEST=1` creates its own temporary app-data directory when
  `LICHEN_USER_DATA_DIR` is unset. Never point either variable at a real vault.
- The GGUFs, OCR runtime, and packaged artifacts are excluded from git. A fresh
  checkout needs `npm run ocr:runtime:fetch` for packaging; development tests and
  smoke runs additionally need `npm run model:fetch`. The verify commands catch a
  truncated download or a runtime that will not start.
- If git reports "dubious ownership" because the checkout is owned by a different
  uid, prefix local git commands with
  `git -c safe.directory="$PWD" ...` rather than changing ownership or widening
  permissions.

### Test execution efficiency (critical)

Treat test runs as a scarce resource. The gates above define what must pass
before a commit, push or release; this section defines when and how to spend
runs while getting there. The pre-commit `npm test` is the one deliberately
broad final confirmation; it is fast and catches cross-module regressions. Do
not turn it into a repeated inner-loop command.

#### 1. Execution triggers

- **Never run tests during** code exploration, initial scaffolding, file
  creation, or while logic is still incomplete.
- **Only run a test command when:**
  - a discrete file, feature or refactor step is completely written and
    syntactically valid;
  - you are diagnosing a specific failure from the immediately prior run; or
  - you are confirming the final fix before declaring the task complete.

#### 2. Scope isolation

- **Default to the smallest unit.** Target the exact file or test case, for
  example `npx vitest run tests/db.test.js` or
  `npx vitest run tests/db.test.js -t "reflection answers"`.
- Use `npm run build` as the cheap renderer check, and
  `npx playwright test e2e/app.spec.js -g "saves and revisits"` for one E2E
  path. On headless Linux, wrap Playwright in the `xvfb-run` command above.
- **Escalate** to a directory or the full suite only after the isolated test
  passes and the change affects shared utilities, global state or public
  interfaces. Do not run the full E2E suite for a localized change.

#### 3. Error recovery loops

- Read and parse the exact failing line or assertion before changing code.
- Apply a targeted fix, then re-run **only** the failing test case.
- **Hard stop:** after three consecutive failures with the same error, run no
  further commands and present the failure and findings to the human for
  guidance. Do not keep guessing.

#### 4. Output summary format

Keep terminal output processing minimal and never paste full success logs into
the chat. On success, report one concise line:

```
✅ [X] Tests Passed in [Y]s. Scope: [Targeted File/Function]
```

A failure report must include the exact failing assertion and the last command
run. Report only checks that were actually executed.

## 4. Commit rules

- **One coherent task = one commit.** Split independent work; do not bundle
  unrelated fixes.
- **Stage explicitly.** Check `git status` and add only files belonging to the
  task; avoid blind `git add -A`.
- **Conventional Commits**, imperative mood, one line under ~72 characters:
  `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, `perf:`.
  Examples: `fix: preserve reflections when autosave races a date switch`,
  `docs: codify agent commit and push workflow`.
- Add a short body when the *why* is not obvious from the subject. Mention the
  verification that was run when it matters.
- **No AI attribution**, "Generated with…" trailers or co-author lines.
- **Documentation is part of the task.** Update `README.md`, `AGENTS.md` or
  `THIRD_PARTY_NOTICES.md` in the same commit when the change touches them.
  See [Documentation stays current](#documentation-stays-current).
- Never commit `node_modules/`, `dist/`, `release/`, `.cache/`, test output
  (`test-results/`, `playwright-report/`), temporary data, logs, or
  `models/*.gguf`.

### Documentation stays current

- **README.md tracks the shipped build.** Whenever a change pertains to the
  README — user-visible behaviour, features, screenshots, setup, commands,
  storage paths, privacy, or limitations — update `README.md` in the same commit.
  It must stay relevant and current with the build that actually ships, not an
  earlier one.
- **Weave changes in; do not rewrite.** Keep the existing structure and voice.
  Add or adjust only the passages the change makes inaccurate. Change existing
  copy only when necessary for accuracy; do not reorganize or rewrite unrelated
  prose.
- **Screenshots are deliverables.** When a UI change makes a README screenshot
  stale, regenerate and commit it with the code. Do not leave illustrative
  assets that show an older interface.
- **AGENTS.md follows the same rule.** When the task loop, verification matrix,
  commit/push rules, invariants, or agent-facing conventions change, update this
  file in the same commit. Keep existing statements current rather than only
  appending new ones; preserve its voice and avoid unrelated rewrites.
- **Third-party notices follow the same rule.** Update
  `THIRD_PARTY_NOTICES.md` (and `models/README.md` where the model attribution
  lives) when dependencies, model files, or licenses change.

## 5. Push rules

When the human explicitly asks to push:

1. Run the gates for the changed surface and confirm they pass.
2. Confirm the working tree is clean (`git status --short --branch`).
3. Confirm the current branch is `main` and the history is sane.
4. Push the current branch to `origin` with the configured HTTP credential
   helper. Report the branch, commit hash and remote; verify the remote ref
   matches the local commit.
5. State clearly that the push is complete; do not create tags, PRs, releases or
   store uploads unless explicitly asked.

If push authentication fails, report the exact command and failure class. Do not
invent credentials or rewrite the remote URL with a token.

## 6. Repository invariants

- **Local-first is the product.** Normal packaged operation must have no outbound
  network path. Keep the session request block, packaged DNS rule, strict CSP,
  sandbox, context isolation and the no-runtime-download AI settings intact. The
  one deliberate exception is the user-initiated, pinned model downloader in the
  main process; do not add any other network path.
- **Models are downloaded, not bundled.** The app package contains no GGUF files.
  First-run setup downloads the companion and OCR weights from pinned HTTPS URLs,
  verifies size and SHA-256, and stores them in user data. The OCR
  `llama-mtmd-cli` runtime remains bundled. `getLlama` must keep
  `build: 'never'` and `skipDownload: true`. CPU on Windows/Linux, Metal auto on
  macOS with CPU fallback. AI, OCR, and download failures must never block
  journaling.
- **Photo OCR is local and non-persistent.** It runs from the bundled llama.cpp
  `llama-mtmd-cli`, reads a temporary normalized image, and deletes it. The
  original photo and the temporary image must never enter the vault or the
  export. Imported text is written only after the user reviews and confirms it.
- **The companion never writes the journal body.** It offers reflection,
  metadata and palettes only.
- **Main/preload stay unbundled CommonJS.** `node-llama-cpp` is ESM-only and is
  loaded via dynamic `import()`; do not bundle native modules. The renderer uses
  Vite/React and must not import Node APIs.
- **Vault contract:** one entry per local calendar day; SQLite FTS5; Markdown +
  JSON export; typed-token purge; exact path surfaced in Settings. The database
  is intentionally unencrypted; do not claim otherwise.
- **No telemetry, accounts, sync, remote fonts/assets or auto-update.**
- **Keep documentation current:** README for users, this file for agents,
  third-party notices for dependencies and model attribution. Documentation is
  part of the change, not a follow-up; see §4.
