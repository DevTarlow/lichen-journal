import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const buildDir = path.join(__dirname, '..', 'build');
const svgPath = path.join(buildDir, 'icon.svg');

if (!fs.existsSync(svgPath)) {
  console.error('build/icon.svg is missing.');
  process.exit(1);
}

await sharp(svgPath, { density: 384 })
  .resize(1024, 1024)
  .png({ compressionLevel: 9 })
  .toFile(path.join(buildDir, 'icon.png'));

console.log('Wrote build/icon.png (1024×1024) from build/icon.svg');
