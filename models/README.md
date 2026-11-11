# Model files

Lichen Journal does **not** ship any GGUF model files. On first run, the app
offers to download three weights once, verifies their SHA-256, and stores them
under the app's user-data directory:

```
<userData>/models/MiniCPM-V-4_7-1B-Q4_K_M.gguf
<userData>/models/MiniCPM-OCR-1_0-Q4_K_M.gguf
<userData>/models/mmproj-model-f16-4x.gguf
```

The OCR `llama-mtmd-cli` runtimes are bundled separately under
`vendor/llama/<platform>-<arch>/`: a processor build at the root, plus a Vulkan
build under `gpu/` on Windows/Linux x64. They are not model files. The companion
uses the matching `node-llama-cpp` processor/Vulkan/Metal prebuilt backend.

## Companion

**File:** `MiniCPM-V-4_7-1B-Q4_K_M.gguf`
**Size:** 672,003,680 bytes (0.63 GiB)
**SHA-256:** `f18f594747e5317ab490cff9c06339c9cfb89acbe2f02ebc48a4e167bc23576d`
**Source:** https://huggingface.co/openbmb/MiniCPM-V-4.7-1B-gguf
**License:** Apache-2.0 (OpenBMB MiniCPM-V 4.7 1B)

This is the repository-root Q4_K_M file, whose embedded chat template keeps
thinking disabled. The `thinking/` variants are not used.

## OCR page reader

**File:** `MiniCPM-OCR-1_0-Q4_K_M.gguf`
**Size:** 529,106,816 bytes (0.49 GiB)
**SHA-256:** `c80a703400633f298cc2fddf6d493a541be36918c0801c0b1bf3f14c5703ce49`
**Source:** https://huggingface.co/openbmb/MiniCPM-OCR-1.0-gguf
**License:** Apache-2.0 (OpenBMB MiniCPM-OCR 1.0)

**File:** `mmproj-model-f16-4x.gguf` (vision projector, required)
**Size:** 901,017,536 bytes (0.84 GiB)
**SHA-256:** `ceed82261b3b1380c3165f8b37c10117a50093be1362cbfeeb692fa036444682`
**Source:** https://huggingface.co/openbmb/MiniCPM-OCR-1.0-gguf
**License:** Apache-2.0 (OpenBMB MiniCPM-OCR 1.0)

The OCR model is run by the bundled llama.cpp `llama-mtmd-cli` runtime. See
[`../vendor/llama/README.md`](../vendor/llama/README.md).

## Development setup

The `models/` directory is intentionally ignored by git. For development,
tests, and smoke runs, download all three files there:

```bash
npm run model:fetch
npm run model:verify
```

`model:fetch` downloads from the pinned URLs, verifies each SHA-256, and refuses
to install a truncated or altered file. The packaged app does not include these
files; it downloads them into user data on first run or through Settings.

The OCR runtime is fetched separately for development/packaging:

```bash
npm run ocr:runtime:fetch
npm run ocr:runtime:verify
```

## Attribution

MiniCPM-V 4.7 1B and MiniCPM-OCR 1.0 were created by OpenBMB. See the model
cards for evaluation details, limitations, and the Apache-2.0 license text:

- https://huggingface.co/openbmb/MiniCPM-V-4.7-1B
- https://huggingface.co/openbmb/MiniCPM-OCR-1.0

The GGUF quantizations are published by OpenBMB:

- https://huggingface.co/openbmb/MiniCPM-V-4.7-1B-gguf
- https://huggingface.co/openbmb/MiniCPM-OCR-1.0-gguf

The bundled OCR executable is from llama.cpp release b11901, MIT licensed:
https://github.com/ggml-org/llama.cpp
