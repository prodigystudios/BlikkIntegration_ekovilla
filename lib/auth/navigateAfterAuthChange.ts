/**
 * Navigera efter ett auth-byte (inloggning, utloggning, nytt konto, nytt lösenord) — ALLTID med full
 * sidladdning, aldrig med `router.replace`/`router.push`.
 *
 * Rotlayouten (app/layout.tsx) läser profil och effektiva behörigheter en gång per full laddning och
 * renderas inte om vid klientnavigering — bara segmenten under den. En mjuk navigering från
 * inloggningssidan landar därför på rätt sida men med inloggningssidans skal: ingen profil, inga
 * nycklar, "inloggad utan roll" tills någon laddar om. Åt andra hållet ligger förra användarens profil
 * kvar i skalet efter utloggningen.
 *
 * `replace` och inte `assign`: auth-sidan ska inte gå att backa till, samma som `router.replace` gav.
 */
export function navigateAfterAuthChange(path: string): void {
  window.location.replace(path);
}
