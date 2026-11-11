// Pinned llama.cpp build used only for local multimodal OCR. The OCR model card
// verifies b11901; keep the executable and its shared libraries together.
export const OCR_RUNTIME_RELEASE = 'b11901';

export const OCR_RUNTIME_MANIFEST = Object.freeze({
  'linux-x64': {
    archive: 'llama-b11901-bin-ubuntu-x64.tar.gz',
    bytes: 22496063,
    sha256: '7c15e703cf4589e90371b51de0ed6ff1107df63b5f86e8d3c396019388be1fa8',
    url: 'https://github.com/ggml-org/llama.cpp/releases/download/b11901/llama-b11901-bin-ubuntu-x64.tar.gz'
  },
  'linux-arm64': {
    archive: 'llama-b11901-bin-ubuntu-arm64.tar.gz',
    bytes: 18218048,
    sha256: '9362155b389b89b127d219965fbb43fcd5e45ad8fc3d5d47fac2807620f42a5a',
    url: 'https://github.com/ggml-org/llama.cpp/releases/download/b11901/llama-b11901-bin-ubuntu-arm64.tar.gz'
  },
  'darwin-x64': {
    archive: 'llama-b11901-bin-macos-x64.tar.gz',
    bytes: 12038516,
    sha256: '44e20ca54d93ae3987272ca2631a7f4b9d3745962654ddfd89ff9e9a21f606aa',
    url: 'https://github.com/ggml-org/llama.cpp/releases/download/b11901/llama-b11901-bin-macos-x64.tar.gz'
  },
  'darwin-arm64': {
    archive: 'llama-b11901-bin-macos-arm64.tar.gz',
    bytes: 16296203,
    sha256: 'dde35fc01722157f31af2c3a6e859e971427deb8e65b9e038606fcc9c44ce79c',
    url: 'https://github.com/ggml-org/llama.cpp/releases/download/b11901/llama-b11901-bin-macos-arm64.tar.gz'
  },
  'win32-x64': {
    archive: 'llama-b11901-bin-win-cpu-x64.zip',
    bytes: 24228082,
    sha256: '039951745399d7c1228b1e882d6e41b24d393f1795e3a6e176162bfb8193500a',
    url: 'https://github.com/ggml-org/llama.cpp/releases/download/b11901/llama-b11901-bin-win-cpu-x64.zip'
  },
  'win32-arm64': {
    archive: 'llama-b11901-bin-win-cpu-arm64.zip',
    bytes: 12846237,
    sha256: '6bdb25ea6644c58a3f0075295d2d6c3e43cf247ce9b18402bdf0c0e3bf41a5db',
    url: 'https://github.com/ggml-org/llama.cpp/releases/download/b11901/llama-b11901-bin-win-cpu-arm64.zip'
  }
});

export function currentRuntimeKey(platform = process.platform, arch = process.arch) {
  return `${platform}-${arch}`;
}
