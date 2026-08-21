// Kopierar pdf.js-workern till public/ så webbläsaren kan hämta den vid körning.
//
// 🧨 WORKERN FÅR INTE GÅ GENOM BUNDLERN. Det självklara receptet — `new URL(
// 'pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url)` — får Next att skicka filen
// genom SWC, som parsar den färdigbyggda ESM-bundlen som ett vanligt skript och failar HELA
// bygget: "'import', and 'export' cannot be used outside of module code". En webpack-regel med
// `type: 'asset/resource'` räcker inte heller, för Next har egna regler som ändå kopplar på
// sin loader. Därför kopierar vi filen i stället och pekar `workerSrc` på /pdfjs/.
//
// 🧨 Kopian får ändelsen .js, inte .mjs. En modul-worker startas på MIME-typen, inte på
// ändelsen, och statiska .mjs-filer serveras inte med en js-typ överallt. Innehållet är
// oförändrat — det är fortfarande ESM, och `new Worker(url, { type: 'module' })` läser det så.
//
// Körs av både postinstall och prebuild, så filen alltid finns och alltid är samma version som
// paketet i node_modules. Därför är den gitignorerad: en incheckad kopia hade tyst blivit fel
// version vid nästa uppdatering av pdfjs-dist, och pdf.js kastar då mitt i renderingen med
// "The API version does not match the Worker version".

import { copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

const packageRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));
const source = path.join(packageRoot, 'legacy', 'build', 'pdf.worker.min.mjs');
const targetDir = path.join(process.cwd(), 'public', 'pdfjs');
const target = path.join(targetDir, 'pdf.worker.min.js');

await mkdir(targetDir, { recursive: true });
await copyFile(source, target);
console.log(`[pdfjs] worker kopierad till ${path.relative(process.cwd(), target)}`);
