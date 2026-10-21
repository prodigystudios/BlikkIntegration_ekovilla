// Byggets version — inbakad vid bygget av next.config.js (`env.NEXT_PUBLIC_APP_BUILD_ID`), i klientens och serverns kod.
// Tom lokalt och utan Vercel.
export const APP_BUILD_ID: string = process.env.NEXT_PUBLIC_APP_BUILD_ID ?? '';

/**
 * Har servern en annan version än den här flikens kod? Då är appen driftsatt på nytt sedan sidan laddades, och fliken
 * kör gammal kod tills den laddas om.
 *
 * Tomt på någon sida betyder "vet inte", aldrig "annan version": lokalt saknas versionen, och ett svar från en äldre
 * driftsättning utan fältet ska inte få alla flikar att be om omladdning. En återställd (äldre) driftsättning räknas
 * också — omladdningen ger då den versionen, vilket är rätt.
 */
export function isOtherAppVersionLive(clientBuild: string | null | undefined, serverBuild: string | null | undefined): boolean {
  if (!clientBuild || !serverBuild) return false;
  return clientBuild !== serverBuild;
}
