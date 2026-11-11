# Release checklist

Lichen Journal is developed on GitHub and is also planned for an itch.io
downloadable release. Builds are platform artifacts intended for the GitHub
release page or the itch.io project.

## Build matrix

Build on the target OS. `node-llama-cpp` does not support cross-compiling its
native binaries. `npm ci` installs the matching optional backend package for the
target; the build includes `@node-llama-cpp/<os>-<arch>`, plus `-vulkan` on
Windows/Linux x64 and `-metal` on macOS arm64. Do not add the large `-cuda` or
`-cuda-ext` packages to the default build.

| Target | Command | Typical artifact |
| --- | --- | --- |
| Windows | `npm run dist:win` | `release/*Windows-Setup.exe` |
| Linux | `npm run dist:linux` | `release/*Linux-x86_64.AppImage` |
| macOS | `npm run dist:mac` | `release/*macOS-*.dmg`, `*.zip` |

The packaged app contains no GGUF model files. It bundles the processor OCR
runtime under `resources/llama/` and, on Windows/Linux x64, a Vulkan OCR runtime
under `resources/llama/gpu/`; model weights are downloaded on first run. It also
bundles the matching `node-llama-cpp` prebuilt backend: Vulkan on Windows/Linux
x64 and Metal on macOS arm64. `electron-builder.json` deliberately uses
`${platform}` (win32/darwin/linux) for the OCR vendor directory and `${os}`
(win/mac/linux) for the `@node-llama-cpp` package names.

## Pre-release checks

1. `npm test`
2. `npm run build`
3. `xvfb-run -a env ELECTRON_OZONE_PLATFORM_HINT=x11 npm run test:e2e` (Linux)
4. `npm run ocr:runtime:verify` (must verify both the processor runtime and the
   Vulkan runtime where the platform has one)
5. `npm run smoke:ai` and `npm run smoke:ocr` (development models required)
6. On a host with a working video card, `npm run smoke:ai:gpu` and a
   `LICHEN_COMPUTE_MODE=gpu npm run smoke:ocr`; confirm the video card was used
   or the app fell back cleanly.
7. `npm run dist:dir`
8. Confirm the packaged `resources/` contains no `.gguf` files, contains the OCR
   processor runtime, contains `llama/gpu/` on Windows/Linux x64, and contains
   the matching `@node-llama-cpp/*-vulkan` or `*-metal` prebuilt backend under
   `app.asar.unpacked`.
9. Run the packaged self-test twice:
   - without model files, to confirm the app handles the missing-model state;
   - with `LICHEN_MODEL_DIR="$PWD/models"`, to exercise AI and OCR.
10. Install on a clean user account, write an entry, import a page photo, export a
    ZIP, purge the vault, and try the Performance switch.
11. For itch.io, upload the platform artifact, set the project page and
    screenshots, and state that model weights download on first run.

## Signing and distribution

- **Windows:** unsigned installers trigger SmartScreen. Code signing with an
  OV/EV certificate is strongly recommended.
- **macOS:** users see Gatekeeper warnings unless the app is signed with an
  Apple Developer ID and notarized. Build and notarize on macOS.
- **Linux:** ensure the AppImage has the executable bit set before uploading.

Do not upload a build made for another OS or architecture. The OCR runtime is
platform-specific and `node-llama-cpp` does not cross-compile.

## Distribution links

- Repository: https://github.com/DevTarlow/lichen-journal
- Store: https://tarlow.itch.io/lichen-journal

## Model downloads

The application downloads pinned model files from Hugging Face on first run and
verifies size and SHA-256 before use. The URLs and hashes live in
[`src/main/model-catalog.js`](../src/main/model-catalog.js). Do not change them
without updating `models/README.md`, `THIRD_PARTY_NOTICES.md`, and the packaged
self-test expectations.

For development and smoke tests, populate `models/` with:

```bash
npm run model:fetch
npm run model:verify
```

Those files are ignored by git and are not part of a release artifact.
