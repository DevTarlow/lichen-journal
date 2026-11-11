# Third-party notices

Lichen Journal's own application code is licensed under the GNU General Public
License, version 3 (GPL-3.0-only); see [`LICENSE`](LICENSE). The application
bundles or depends on the following open-source projects and model artifacts.
Their licenses remain in effect.

| Component | Version | License | Source |
| --- | --- | --- | --- |
| Electron | 45.x | MIT | https://github.com/electron/electron |
| Chromium | bundled with Electron | BSD-3-Clause and other licenses | https://www.chromium.org/ |
| Node.js | bundled with Electron | MIT | https://nodejs.org/ |
| React / React DOM | 19.x | MIT | https://github.com/facebook/react |
| Vite | 7.x | MIT | https://github.com/vitejs/vite |
| better-sqlite3 | 13.x | MIT | https://github.com/WiseLibs/better-sqlite3 |
| SQLite | 3.x | Public domain | https://sqlite.org/ |
| node-llama-cpp | 3.22.x | MIT | https://github.com/withcatai/node-llama-cpp |
| llama.cpp | node-llama-cpp bundled build + b11901 OCR runtime | MIT | https://github.com/ggml-org/llama.cpp |
| archiver | 7.x | MIT | https://github.com/archiverjs/node-archiver |
| MiniCPM-V 4.7 1B | Q4_K_M GGUF (downloaded) | Apache-2.0 | https://huggingface.co/openbmb/MiniCPM-V-4.7-1B |
| MiniCPM-V 4.7 GGUF quantization | Q4_K_M (downloaded) | Apache-2.0 | https://huggingface.co/openbmb/MiniCPM-V-4.7-1B-gguf |
| MiniCPM-OCR 1.0 | Q4_K_M GGUF + 4x projector (downloaded) | Apache-2.0 | https://huggingface.co/openbmb/MiniCPM-OCR-1.0 |

## Model attribution

MiniCPM-V 4.7 1B was developed by OpenBMB. The root Q4_K_M GGUF (thinking
disabled) is downloaded by the user at first run; it is not redistributed in
the application package. It is distributed under the Apache License 2.0. The
complete license text is available at:

https://www.apache.org/licenses/LICENSE-2.0

Model card and limitations:

https://huggingface.co/openbmb/MiniCPM-V-4.7-1B

MiniCPM-OCR 1.0 was developed by OpenBMB and is also Apache-2.0. Its model and
projector are downloaded by the user; the bundled OCR runtime is llama.cpp
b11901, MIT licensed, used only for local photo OCR.
See <https://huggingface.co/openbmb/MiniCPM-OCR-1.0> and
<https://github.com/ggml-org/llama.cpp>.

## Full license texts

The complete license text for each npm dependency is included in its package
under `node_modules/<package>/LICENSE*` at build time. Electron's license is
included in the packaged Electron distribution. If you distribute a modified
build, retain these notices and license files.

No warranty is provided for third-party components; refer to each project's
license for the applicable terms.
