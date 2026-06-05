"use client";

import { useEffect, useState } from 'react';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';

type CodeOption = { code: string; description: string };
type Status = 'loading' | 'ready' | 'unavailable';

// Picker for a Fortnox code register (terms of payment, price list, …). Loads the
// account's register so sellers choose a valid Code (Fortnox rejects unknown codes
// on the Customer endpoint). Falls back to a free-text input when Fortnox is
// unavailable or returns nothing.
export default function FortnoxCodeSelect({
  value,
  onChange,
  endpoint,
  emptyLabel,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  endpoint: string;
  emptyLabel: string;
  placeholder: string;
}) {
  const [status, setStatus] = useState<Status>('loading');
  const [options, setOptions] = useState<CodeOption[]>([]);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const res = await fetch(endpoint, { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (!active) return;
        const items: CodeOption[] = res.ok && json.ok ? json.data?.items ?? [] : [];
        if (items.length > 0) {
          setOptions(items);
          setStatus('ready');
        } else {
          setStatus('unavailable');
        }
      } catch {
        if (active) setStatus('unavailable');
      }
    }
    load();
    return () => { active = false; };
  }, [endpoint]);

  // Fortnox not connected / empty register / load failed → free text, no guessing forced.
  if (status === 'unavailable') {
    return <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />;
  }

  if (status === 'loading') {
    return (
      <Select disabled>
        <option>Laddar…</option>
      </Select>
    );
  }

  // A previously saved value that isn't in the register (e.g. legacy free text or
  // a deactivated code) is kept as an option so editing doesn't silently drop it.
  const hasCurrent = value === '' || options.some((o) => o.code === value);

  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{emptyLabel}</option>
      {options.map((o) => (
        <option key={o.code} value={o.code}>
          {o.description ? `${o.code} – ${o.description}` : o.code}
        </option>
      ))}
      {!hasCurrent ? <option value={value}>{`${value} (nuvarande)`}</option> : null}
    </Select>
  );
}
