import { describe, expect, it } from 'vitest';
import {
  buildOcrArgs,
  cleanOcrText,
  formatOcrError,
  mergeOcrText,
  resolveOcrPaths,
  supportedImageExtension
} from '../src/main/ocr-utils.js';

describe('OCR text cleanup', () => {
  it('removes prompt echoes, chat tokens, and thinking traces', () => {
    expect(
      cleanOcrText(
        '\nText Recognition:\n[Start thinking]\nI should read this.\n[End thinking]\n<|im_start|>assistant\nThe river after rain.\nMoss and wet stone.<|im_end|>\n'
      )
    ).toBe('The river after rain.\nMoss and wet stone.');
  });

  it('strips ANSI color codes and extra blank lines', () => {
    expect(cleanOcrText('\u001b[32mLICHEN\u001b[0m\n\n\n\nJOURNAL')).toBe('LICHEN\n\nJOURNAL');
  });

  it('keeps markdown paragraphs and a page of text', () => {
    const text = cleanOcrText('A heading\n\n- first line\n- second line');
    expect(text).toContain('- first line');
    expect(text).toContain('- second line');
  });

  it('returns an empty string for empty or control-only output', () => {
    expect(cleanOcrText('')).toBe('');
    expect(cleanOcrText('Text Recognition:')).toBe('');
  });
});

describe('OCR body merge', () => {
  it('creates a page from empty text and preserves existing words', () => {
    expect(mergeOcrText('', 'First page.')).toBe('First page.');
    expect(mergeOcrText('Existing words.\n', 'New words.')).toBe(
      'Existing words.\n\nNew words.'
    );
  });

  it('trims only surrounding whitespace and never replaces existing text', () => {
    expect(mergeOcrText('Keep this.', '  Add this.  ')).toBe('Keep this.\n\nAdd this.');
    expect(mergeOcrText('Keep this.', '   ')).toBe('Keep this.');
  });
});

describe('OCR runtime arguments', () => {
  const base = {
    modelPath: '/models/ocr.gguf',
    projectorPath: '/models/mmproj.gguf',
    imagePath: '/tmp/page.png'
  };

  it('uses the jinja chat template and image prompt without suppressing stdout', () => {
    const args = buildOcrArgs({ ...base, platform: 'linux', gpu: false });
    expect(args).toContain('--jinja');
    expect(args).toContain('--image');
    expect(args).toContain('Text Recognition:');
    expect(args).not.toContain('--log-disable');
    expect(args).toEqual(expect.arrayContaining(['-ngl', '0', '--no-mmproj-offload']));
  });

  it('opts into Metal and projector offload on macOS by default', () => {
    const args = buildOcrArgs({ ...base, platform: 'darwin' });
    expect(args).toEqual(expect.arrayContaining(['-ngl', '99', '--mmproj-offload']));
  });

  it('uses the video card on Windows/Linux when requested', () => {
    const args = buildOcrArgs({ ...base, platform: 'linux', gpu: true });
    expect(args).toEqual(expect.arrayContaining(['-ngl', '99', '--mmproj-offload']));
  });

  it('can force the processor on macOS', () => {
    const args = buildOcrArgs({ ...base, platform: 'darwin', gpu: false });
    expect(args).toEqual(expect.arrayContaining(['-ngl', '0', '--no-mmproj-offload']));
  });
});

describe('OCR path and image helpers', () => {
  it('resolves packaged and development paths', () => {
    const packaged = resolveOcrPaths({
      isPackaged: true,
      resourcesPath: '/app/resources',
      appRoot: '/repo',
      platform: 'linux',
      arch: 'x64'
    });
    expect(packaged.runtimePath).toBe('/app/resources/llama/llama-mtmd-cli');
    expect(packaged.gpuRuntimePath).toBe('/app/resources/llama/gpu/llama-mtmd-cli');
    expect(packaged.modelPath).toBe('/app/resources/models/MiniCPM-OCR-1_0-Q4_K_M.gguf');

    const dev = resolveOcrPaths({
      isPackaged: false,
      appRoot: '/repo',
      platform: 'win32',
      arch: 'x64'
    });
    expect(dev.runtimePath).toBe('/repo/vendor/llama/win32-x64/llama-mtmd-cli.exe');
    expect(dev.gpuRuntimePath).toBe('/repo/vendor/llama/win32-x64/gpu/llama-mtmd-cli.exe');

    const mac = resolveOcrPaths({
      isPackaged: false,
      appRoot: '/repo',
      platform: 'darwin',
      arch: 'arm64'
    });
    expect(mac.runtimePath).toBe('/repo/vendor/llama/darwin-arm64/llama-mtmd-cli');
    expect(mac.gpuRuntimePath).toBe(mac.runtimePath);

    const downloaded = resolveOcrPaths({
      isPackaged: true,
      resourcesPath: '/app/resources',
      appRoot: '/repo',
      modelDir: '/home/user/models',
      platform: 'linux',
      arch: 'x64'
    });
    expect(downloaded.modelPath).toBe('/home/user/models/MiniCPM-OCR-1_0-Q4_K_M.gguf');
    expect(downloaded.projectorPath).toBe('/home/user/models/mmproj-model-f16-4x.gguf');
  });

  it('accepts only the image formats the picker offers', () => {
    expect(supportedImageExtension('page.PNG')).toBe(true);
    expect(supportedImageExtension('page.jpeg')).toBe(true);
    expect(supportedImageExtension('page.webp')).toBe(true);
    expect(supportedImageExtension('page.gif')).toBe(false);
  });

  it('formats an OCR error without leaking a stack', () => {
    const error = Object.assign(new Error('No text'), { code: 'OCR_EMPTY' });
    expect(formatOcrError(error)).toEqual({ code: 'OCR_EMPTY', message: 'No text' });
    expect(formatOcrError(null)).toEqual({ code: 'OCR_FAILED', message: 'The photo could not be read.' });
  });
});
