'use client';

import * as React from 'react';
import SelectMenu, { type SelectMenuOption } from './SelectMenu';

// `<Select>` ÄR numera `SelectMenu` — den tar bara emot `<option>`-barn i stället för en
// `options`-array, så de anropsplatser som redan fanns kunde stå kvar orörda.
//
// 🧨 SKÄLET: den här komponenten var förut en `<select>` med `appearance: none`. Det stylar bara den
// STÄNGDA rutan. Listan som fälls ut ur en `<select>` ritas av operativsystemet och når ingen CSS —
// på macOS grå och fyrkantig, helt utanför appens formspråk. Fältet såg alltså rätt ut ända tills
// man klickade på det. Se noten i `SelectMenu.tsx`.
//
// ⚠️ PROPTYPEN ÄR SMAL MED FLIT. Den var förut `React.SelectHTMLAttributes<HTMLSelectElement>`, och
// hade den fått stå kvar hade varje DOM-attribut som komponenten inte längre kan hedra tagits emot
// och kastats TYST — `onBlur` på rollväljaren i AdminUsers var precis den buggen som väntade
// (spara-vid-blur på en knapp + portal betyder något annat: fokus flyttas IN i listan). Nu blir
// samma sak ett type-check-fel i stället för en rolländring som slutar sparas utan att någon märker
// det. Vill du ha en prop tillbaka: lägg till den här OCH hedra den i SelectMenu.

type SelectChangeEvent = { target: { value: string }; currentTarget: { value: string } };

export type SelectProps = {
  /** Utelämnad → första icke-disablade alternativet, precis som en okontrollerad `<select>`. */
  value?: string | number | null;
  onChange?: (event: SelectChangeEvent) => void;
  children?: React.ReactNode;
  className?: string;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
  /** Visas när värdet inte matchar något alternativ. */
  placeholder?: string;
};

// `<option>{namn}{villkor ? ' – primär' : ''}</option>` ger ett BARN-ARRAY, inte en sträng. Platta
// till hela trädet till text så etiketten blir densamma som webbläsaren hade renderat.
function optionText(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(optionText).join('');
  if (React.isValidElement(node)) return optionText((node.props as { children?: React.ReactNode }).children);
  return '';
}

// `React.Children` plattar ut arrayer (från `.map()`) och hoppar över `null`/`false` (från
// `{villkor ? <option/> : null}`) av sig självt — men den öppnar INTE fragment, så det görs här.
function collectOptions(children: React.ReactNode, out: SelectMenuOption[]) {
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    const props = child.props as { value?: unknown; disabled?: boolean; children?: React.ReactNode };
    if (child.type === React.Fragment || child.type === 'optgroup') {
      collectOptions(props.children, out);
      return;
    }
    if (child.type !== 'option') return;
    const label = optionText(props.children);
    // En `<option>` utan `value` använder sin text som värde — samma regel som i HTML.
    out.push({
      value: props.value === undefined || props.value === null ? label : String(props.value),
      label,
      disabled: Boolean(props.disabled),
    });
  });
}

export default function Select({ value, onChange, children, placeholder, ...rest }: SelectProps) {
  const options = React.useMemo(() => {
    const out: SelectMenuOption[] = [];
    collectOptions(children, out);
    return out;
  }, [children]);

  // 🧨 En okontrollerad `<select>` visar sitt FÖRSTA alternativ, inte en tom ruta. `FortnoxCodeSelect`
  // lutar sig mot det (`<Select disabled><option>Laddar…</option></Select>` — inget `value`), och utan
  // den här raden hade det stått "Välj…" under laddningen.
  const resolved =
    value === undefined || value === null ? options.find((o) => !o.disabled)?.value ?? '' : String(value);

  // 🧨 OMSLAGSDIVEN MÅSTE VARA KVAR. Den gamla `<Select>` var `div > select.w-full`, och divens
  // block-box var det som mötte layouten utanför. Renderar vi knappen bar blir DEN flex-itemet, och
  // `w-full` syftar då på förälderns bredd i stället för divens innehållsbredd: i en `inline-flex`
  // `<label>` (som `:where(label){width:100%}` dessutom gör 100 % bred) sträcker sig ROT-typväljaren
  // över hela artikelraden i stället för att krympa till sitt innehåll. Med diven kvar är box-
  // modellen identisk med förut på samtliga anropsplatser. Portalen bryr sig inte — den går till
  // `<body>` oavsett var i JSX:en den står.
  return (
    <div className="relative">
      <SelectMenu
        {...rest}
        value={resolved}
        options={options}
        placeholder={placeholder}
        onChange={(next) => onChange?.({ target: { value: next }, currentTarget: { value: next } })}
      />
    </div>
  );
}
