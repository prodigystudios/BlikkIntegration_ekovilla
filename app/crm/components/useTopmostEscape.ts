"use client";

import { useEffect, type RefObject } from 'react';

// Alla heltäckande overlägg som stänger på Escape, så länge de är öppna.
//
// Utan en gemensam anmälan stänger ett Escape varenda öppet överlägg på en gång: lyssnarna sitter
// allihop på `document`, och stopPropagation når inte en syskonlyssnare på samma nod. Konkret:
// öppna en offert, börja skriva en ny uppgift, tryck Escape för att ångra bara formuläret — och
// både formuläret och hela offertpanelen försvann, med det påbörjade utkastet.
//
// ⚠️ Ett överlägg som lägger en EGEN document-lyssnare utan att gå genom den här hooken är osynligt
// för de andra, och då är felet tillbaka för alla som ligger under det. Det gällde
// DocumentEmailProgress, som ligger på z-[2900] ovanpå varje CrmModal.
const openOverlays = new Set<HTMLElement>();

/**
 * Stäng på Escape — men bara om det här överlägget är det översta.
 *
 * "Överst" avgörs på DOKUMENTORDNING: överläggen ligger på samma z-index-nivå, så den som målas
 * överst är den som kommer sist i dokumentet.
 *
 * ⚠️ Att den som öppnas senare också hamnar sist är en egenskap hos hur de renderas, inte en
 * naturlag — och de två formerna kommer dit på olika vägar. `CrmConfirmDialog` och
 * `DocumentEmailProgress` är syskon som står efter panelen i JSX. `TaskFormModal` och
 * `ContactFormModal` är INTE nästlade i panelen alls: de `createPortal`:ar till `document.body`
 * och hamnar efter den för att en portal appendas sist. Renderas ett överlägg någon gång som ett
 * TIDIGARE syskon än det som öppnar det, håller inte regeln — då är det renderingsordningen som
 * ska rättas, inte den här jämförelsen.
 *
 * Monteringsordning vore fel mått: React kör barnens effekter före förälderns, så en push/pop-stack
 * hade lagt ett nästlat överlägg underst.
 */
export function useTopmostEscape(overlayRef: RefObject<HTMLElement | null>, onEscape: () => void) {
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    openOverlays.add(overlay);
    return () => { openOverlays.delete(overlay); };
  }, [overlayRef]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      const overlay = overlayRef.current;
      if (!overlay) return;
      for (const other of openOverlays) {
        if (other === overlay) continue;
        if (overlay.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING) return;
      }
      onEscape();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [overlayRef, onEscape]);
}
