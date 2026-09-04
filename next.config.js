/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // PDF-routen läser typsnitt, logotyp och bilagor från public/ VID KÖRNING.
  //
  // ⚠️ **Spåraren löser ett `path.join` med enbart literaler — inte en väg byggd genom en variabel.**
  // Det är hela skillnaden, och den kostade en produktionsincident 2026-09-04:
  //
  //   path.join(process.cwd(), 'public', 'brand', 'logo.png')   ← hittas, följer med
  //   const DIR = path.join(process.cwd(), 'public', 'fonts');
  //   readFile(path.join(DIR, 'OpenSans-Regular.ttf'))          ← hittas INTE, ENOENT i drift
  //
  // Därför fungerade Fortnox-kopians logotyp i drift medan den nya renderarens typsnitt inte gjorde
  // det. Bilagorna, vars filnamn kommer ur en lista, kan spåraren aldrig se.
  //
  // Lokalt märks ingenting: där ligger filerna kvar på disk oavsett vad som spårats.
  experimental: {
    outputFileTracingIncludes: {
      '/api/fortnox/offers/[quoteId]/pdf': [
        './public/brand/fonts/*.ttf',
        './public/brand/Ekovilla_logo_Figma.png',
        // Spåras redan på egen hand (literal sökväg), men listas för att beroendet ska överleva en
        // omskrivning av den sökvägen till en variabel.
        './public/brand/Ekovilla_logo_Header.png',
        './public/documents/templates/*.pdf',
      ],
    },
  },
};

module.exports = nextConfig;
