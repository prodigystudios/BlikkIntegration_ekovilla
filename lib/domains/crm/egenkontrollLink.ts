// Hitta den inlämnade egenkontrollens nedladdningslänk bland arbetsorderns kommentarer.
//
// ── VARFÖR KOMMENTAREN ÄR KÄLLAN ─────────────────────────────────────────────
// När en egenkontroll sparas arkiveras PDF:en och en kommentar skrivs på arbetsordern med raden
// `Ladda ner här: <origin>/api/storage/download?path=…` (app/egenkontroll/page.tsx). Det är i dag
// den ENDA kopplingen mellan en order och dess egenkontroll som pekar ut just den filen —
// säckraderna (`kind: 'final'`) bevisar att en egenkontroll finns, men bär ingen sökväg, och
// arkivet går bara att söka i på filnamn.
//
// Priset är ett textparsningskontrakt mot en kommentar vi själva formaterar. Det accepterades med
// öppna ögon, mot alternativet att spara sökvägen i databasen: det senare är strukturellt renare
// men hjälper bara FRAMTIDA rapporter, och varje egenkontroll som redan lämnats in hade förblivit
// oåtkomlig. Skulle sökvägen börja sparas på ordern är det här reserven för bakåtkatalogen.
//
// ⚠️ MATCHNINGEN KRÄVER `Egenkontroller`-PREFIXET. Ett naket `/api/storage/download` hade plockat
// upp vilken arkivlänk som helst någon råkat klistra in i en kommentar — ett dokument, ett kvitto —
// och visat den under rubriken "Egenkontroll". Prefixet är den enda spärren mot det.
//
// ⚠️ SENASTE VINNER. En ny egenkontroll ERSÄTTER orderns tidigare (samma regel som final-raderna i
// säckboken följer). Visas den äldsta läser kontoret siffror som inte längre gäller.

export type EgenkontrollCommentLike = {
  body?: string | null;
  created_at?: string | null;
};

// Sökvägen ligger URL-kodad i query-strängen: encodeURIComponent('Egenkontroller/x.pdf') ger
// 'Egenkontroller%2Fx.pdf'. Den okodade varianten accepteras också — billigare än att anta att
// varje länk som någonsin skrivits kodades likadant.
const DOWNLOAD_PATTERN =
  /https?:\/\/[^\s<>"']*\/api\/storage\/download\?path=Egenkontroller(?:%2F|\/)[^\s<>"']+/gi;

// Sista träffen i EN kommentar. Kommentaren innehåller normalt exakt en länk; skulle någon ha
// redigerat in fler är den sista den som står närmast raden "Ladda ner här:".
function lastEgenkontrollUrlIn(body: string): string | null {
  const re = new RegExp(DOWNLOAD_PATTERN.source, DOWNLOAD_PATTERN.flags);
  let found: string | null = null;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    // Avslutande skiljetecken hör till meningen, inte till adressen.
    found = match[0].replace(/[.,;:!?]+$/, '');
  }
  return found;
}

export function findLatestEgenkontrollLink(
  comments: readonly EgenkontrollCommentLike[] | null | undefined,
): string | null {
  if (!Array.isArray(comments)) return null;

  let bestUrl: string | null = null;
  let bestTime = Number.NEGATIVE_INFINITY;
  let bestIndex = -1;

  for (let index = 0; index < comments.length; index += 1) {
    const url = lastEgenkontrollUrlIn(String(comments[index]?.body ?? ''));
    if (!url) continue;

    // Otolkbart datum sorteras sist, men diskvalificerar inte kommentaren: en länk vi kan öppna är
    // bättre än ingen. Den faller då tillbaka på inmatningsordningen, där senare vinner.
    const parsed = Date.parse(String(comments[index]?.created_at ?? ''));
    const time = Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;

    if (time > bestTime || (time === bestTime && index > bestIndex)) {
      bestUrl = url;
      bestTime = time;
      bestIndex = index;
    }
  }

  return bestUrl;
}
