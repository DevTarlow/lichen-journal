import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEV_CSP = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline'",
  'connect-src \'self\' ws://127.0.0.1:* http://127.0.0.1:*'
].join('; ');

const PROD_CSP = [
  "default-src 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'none'",
  "media-src 'none'",
  "worker-src 'none'",
  "manifest-src 'none'"
].join('; ');

function cspPlugin(command) {
  return {
    name: 'lichen-csp',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: {
            'http-equiv': 'Content-Security-Policy',
            content: command === 'serve' ? DEV_CSP : PROD_CSP
          },
          injectTo: 'head-prepend'
        }
      ];
    }
  };
}

export default defineConfig(({ command }) => ({
  root: path.join(__dirname, 'src/renderer'),
  base: './',
  plugins: [react(), cspPlugin(command)],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: path.join(__dirname, 'dist'),
    emptyOutDir: true,
    sourcemap: false,
    target: 'chrome130'
  }
}));
