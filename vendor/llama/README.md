# Local OCR runtime

This directory holds the pinned llama.cpp `llama-mtmd-cli` build used only for
reading page photos. The binaries are downloaded per platform by:

```bash
npm run ocr:runtime:fetch
npm run ocr:runtime:verify
```

Each platform directory (`linux-x64`, `darwin-arm64`, `win32-x64`, and so on)
is ignored by git. `electron-builder` copies the current platform directory into
the packaged app as `resources/llama/`.

Lichen Journal never downloads this runtime at application runtime. It is a
build/development artifact, like the GGUF models.
