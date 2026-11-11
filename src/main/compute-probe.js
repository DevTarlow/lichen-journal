'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { fork } = require('node:child_process');
const { friendlyComputeError } = require('./compute-utils');

const PROBE_MARKER = 'LICHEN_GPU_PROBE_RESULT ';
const DEFAULT_TIMEOUT_MS = 90_000;

function parseProbeOutput(stdout) {
  const text = typeof stdout === 'string' ? stdout : '';
  const index = text.lastIndexOf(PROBE_MARKER);
  if (index === -1) return null;
  const line = text.slice(index + PROBE_MARKER.length).split('\n')[0].trim();
  if (!line) return null;
  try {
    const parsed = JSON.parse(line);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function defaultSpawn({ modelPath, contextSize, maxTokens, timeoutMs }) {
  const probePath = path.join(__dirname, 'gpu-probe.js');
  const env = {
    ...process.env,
    LICHEN_GPU_PROBE: JSON.stringify({ modelPath, contextSize, maxTokens, timeoutMs })
  };

  let utilityProcess = null;
  try {
    ({ utilityProcess } = require('electron'));
  } catch {
    utilityProcess = null;
  }

  if (utilityProcess && typeof utilityProcess.fork === 'function') {
    return utilityProcess.fork(probePath, [], {
      serviceName: 'Lichen GPU Check',
      env,
      stdio: 'pipe'
    });
  }

  return fork(probePath, [], {
    env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
}

/**
 * Resolve to a plain result instead of throwing for an ordinary video-card
 * failure. The caller only needs to know whether to save GPU or CPU.
 */
function runGpuProbe({
  modelPath,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  contextSize = 4096,
  maxTokens = 8,
  spawnImpl = defaultSpawn
} = {}) {
  return new Promise((resolve) => {
    if (!modelPath || typeof modelPath !== 'string') {
      resolve({
        ok: false,
        error: {
          code: 'MODEL_MISSING',
          message: 'The companion model is missing.'
        }
      });
      return;
    }
    let stat = null;
    try {
      stat = fs.statSync(modelPath);
    } catch {
      stat = null;
    }
    if (!stat || !stat.isFile() || stat.size <= 0) {
      resolve({
        ok: false,
        error: {
          code: 'MODEL_MISSING',
          message: 'The companion model is missing.'
        }
      });
      return;
    }

    let child = null;
    try {
      child = spawnImpl({ modelPath, contextSize, maxTokens, timeoutMs });
    } catch (error) {
      resolve({
        ok: false,
        error: {
          code: 'GPU_PROBE_FAILED',
          message: friendlyComputeError(error)
        },
        details: error && error.message ? String(error.message) : ''
      });
      return;
    }
    if (!child) {
      resolve({
        ok: false,
        error: {
          code: 'GPU_PROBE_FAILED',
          message: friendlyComputeError(null)
        }
      });
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer = null;

    const finish = (result, killChild = false) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (killChild && child) {
        try {
          child.kill();
        } catch {
          // The child may already be gone.
        }
      }
      resolve(result);
    };

    timer = setTimeout(() => {
      finish(
        {
          ok: false,
          error: {
            code: 'GPU_TIMEOUT',
            message:
              'The video card took too long to start, so the companion will use the processor.'
          }
        },
        true
      );
    }, Math.max(1_000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));
    timer.unref?.();

    try {
      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
    } catch {
      // Some child implementations expose unencoded streams.
    }
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > 64_000) stdout = stdout.slice(-64_000);
    });
    child.stderr?.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-8_000);
    });
    child.on?.('error', (error) => {
      finish({
        ok: false,
        error: {
          code: 'GPU_PROBE_FAILED',
          message: friendlyComputeError(error)
        },
        details: error && error.message ? String(error.message) : ''
      });
    });
    const handleExit = (code, signal) => {
      const parsed = parseProbeOutput(stdout);
      if (parsed && parsed.ok === true) {
        finish({
          ok: true,
          backend: typeof parsed.backend === 'string' ? parsed.backend : 'gpu',
          gpuLayers: Number(parsed.gpuLayers) || 0,
          text: typeof parsed.text === 'string' ? parsed.text : ''
        });
        return;
      }
      if (parsed && parsed.error) {
        finish({
          ok: false,
          error: {
            code:
              typeof parsed.error.code === 'string'
                ? parsed.error.code
                : 'GPU_UNAVAILABLE',
            message:
              typeof parsed.error.message === 'string'
                ? parsed.error.message
                : friendlyComputeError(null)
          },
          details: stderr
        });
        return;
      }
      finish({
        ok: false,
        error: {
          code: 'GPU_PROBE_FAILED',
          message: friendlyComputeError(null)
        },
        details: signal
          ? `The video card check stopped (${signal}).`
          : `The video card check exited with code ${code}.`
      });
    };
    child.on?.('exit', handleExit);
    child.on?.('close', handleExit);
  });
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  PROBE_MARKER,
  parseProbeOutput,
  runGpuProbe,
  defaultSpawn
};
