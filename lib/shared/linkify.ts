// Dela upp fri text i text- och länkdelar, så en renderare kan göra riktiga <a> av URL:erna.
//
// VARFÖR DEN HÄR FINNS: arbetsorderkommentarerna renderades som ren text. Egenkontrollen skriver in
// en permanent nedladdningslänk i en kommentar på ordern när rapporten lämnas in, och kontoret fick
// markera och kopiera den för hand — varje gång, på varje order.
//
// ⚠️ REN FUNKTION, INGEN HTML. Den returnerar DELAR, inte en sträng med taggar i. Att bygga
// `<a href="...">` som text och stoppa in via dangerouslySetInnerHTML är den klassiska vägen till
// en XSS i användarskriven text — kommentarer skrivs av människor och ska aldrig tolkas som markup.
// Renderaren mappar delarna till React-element, och då escapar React texten åt oss.
//
// ⚠️ BARA http/https. Regexet kan inte matcha `javascript:`-scheman, alltså kan en kommentar inte
// smyga in en klickbar sådan. Ändra inte regexet till att acceptera fler scheman utan att tänka
// igenom just det.

export type LinkPart = { type: 'text' | 'link'; value: string };

// Skapas per anrop och inte som modulkonstant: ett /g-regex bär `lastIndex` som delat tillstånd,
// och en modulnivåkopia hade läckt position mellan två renderingar.
function urlPattern(): RegExp {
  return /https?:\/\/[^\s<>"']+/g;
}

// Skiljetecken sist i en mening är nästan aldrig en del av adressen: "Ladda ner här: https://…/x.pdf."
// Slutparentes och hakparentes tas bara bort när motsvarande öppning saknas i URL:en — annars hade
// en legitim adress som slutar på ')' kapats.
function trimTrailingPunctuation(url: string): string {
  let out = url;
  for (;;) {
    const last = out.slice(-1);
    if (!last) break;
    if ('.,;:!?'.includes(last)) { out = out.slice(0, -1); continue; }
    if (last === ')' && !out.includes('(')) { out = out.slice(0, -1); continue; }
    if (last === ']' && !out.includes('[')) { out = out.slice(0, -1); continue; }
    break;
  }
  return out;
}

// Måste fortfarande vara en adress efter putsningen. "https://." trimmas till "https://", som är
// klickbar men leder ingenstans — bättre att låta den stå kvar som text.
function isUsableUrl(url: string): boolean {
  return /^https?:\/\/[^\s/]/.test(url);
}

export function splitLinkParts(text: string | null | undefined): LinkPart[] {
  const src = String(text ?? '');
  if (!src) return [];

  const parts: LinkPart[] = [];
  const re = urlPattern();
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(src)) !== null) {
    const raw = match[0];
    const url = trimTrailingPunctuation(raw);

    // Inte en användbar adress → låt hela träffen vara vanlig text och gå vidare förbi den.
    if (!isUsableUrl(url)) {
      re.lastIndex = match.index + raw.length;
      continue;
    }

    if (match.index > cursor) parts.push({ type: 'text', value: src.slice(cursor, match.index) });
    parts.push({ type: 'link', value: url });

    // Fortsätt EFTER den putsade adressen, inte efter hela träffen: skiljetecknet vi klippte bort
    // hör till texten och ska tillbaka in i nästa textdel.
    cursor = match.index + url.length;
    re.lastIndex = cursor;
  }

  if (cursor < src.length) parts.push({ type: 'text', value: src.slice(cursor) });
  return parts;
}
