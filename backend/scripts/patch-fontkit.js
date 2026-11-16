import fs from 'fs';
import path from 'path';

const files = [
  'node_modules/fontkit/dist/main.cjs',
  'node_modules/fontkit/dist/module.mjs',
  'node_modules/fontkit/src/opentype/GPOSProcessor.js'
];

for (const rel of files) {
  const p = path.resolve(process.cwd(), rel);
  if (fs.existsSync(p)) {
    let c = fs.readFileSync(p, 'utf8');
    if (!c.includes('if (!anchor) return { x: 0, y: 0 };')) {
      c = c.replace(
        'getAnchor(anchor) {',
        'getAnchor(anchor) {\n        if (!anchor) return { x: 0, y: 0 };'
      );
      fs.writeFileSync(p, c);
      console.log(`[patch-fontkit] Patched ${rel}`);
    }
  }
}
