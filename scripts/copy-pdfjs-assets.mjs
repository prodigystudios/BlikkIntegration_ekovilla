// Kopierar pdf.js runtime-tillgångar till public/ så webbläsaren kan hämta dem vid körning.
//
// Fyra saker, inte bara workern:
//   pdf.worker.min.js  sjalva renderingsmotorn
//   cmaps/             teckenuppslag for pdf:er med fordefinierade CMap:ar
//   standard_fonts/    de 14 standardtypsnitten, for pdf:er som inte bäddat in sina
//   wasm/              avkodare for JBIG2/CCITT/JPEG2000 - alltsa SCANNADE dokument
//   iccs/              fargprofiler
//
// 🧨 De tre sista är inte valfria. pdf.js KASTAR - varnar inte - med "Ensure that the
// `cMapUrl` API parameter is provided" så fort ett dokument behöver något av dem, och en
// inscannad lathund gör det. Utan dem faller hela visningen ned i sin felruta.
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

import { copyFile, cp, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

const packageRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));
const targetDir = path.join(process.cwd(), 'public', 'pdfjs');

await mkdir(targetDir, { recursive: true });

await copyFile(
  path.join(packageRoot, 'legacy', 'build', 'pdf.worker.min.mjs'),
  path.join(targetDir, 'pdf.worker.min.js'),
);

for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  await cp(path.join(packageRoot, dir), path.join(targetDir, dir), { recursive: true });
}

console.log(`[pdfjs] tillgangar kopierade till ${path.relative(process.cwd(), targetDir)}`);
