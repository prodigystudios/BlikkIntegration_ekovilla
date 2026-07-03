"use client";

import { useMemo, useRef, useState } from 'react';
import Textarea from '../../../components/ui/Textarea';

export type MentionUser = { id: string; full_name: string | null };

// Properties copied onto the mirror element so its text wraps exactly like the textarea.
const MIRROR_PROPS = [
  'boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight',
  'textTransform', 'wordSpacing', 'whiteSpace', 'wordWrap',
] as const;

// Pixel position of a caret index inside a textarea, relative to the textarea's top-left.
// Renders a hidden mirror div with the same box/typography, places a marker span at the
// index, and reads its offset. Standard technique — textareas expose no caret geometry.
function caretCoordinates(el: HTMLTextAreaElement, index: number): { top: number; left: number; lineHeight: number } {
  const computed = window.getComputedStyle(el);
  const div = document.createElement('div');
  const style = div.style;
  style.position = 'absolute';
  style.visibility = 'hidden';
  style.whiteSpace = 'pre-wrap';
  style.wordWrap = 'break-word';
  style.overflow = 'hidden';
  for (const prop of MIRROR_PROPS) {
    (style as any)[prop] = (computed as any)[prop];
  }
  div.textContent = el.value.slice(0, index);
  const marker = document.createElement('span');
  marker.textContent = el.value.slice(index) || '.';
  div.appendChild(marker);
  document.body.appendChild(div);
  const lineHeight = parseInt(computed.lineHeight, 10) || Math.round(parseInt(computed.fontSize, 10) * 1.4);
  const coords = { top: marker.offsetTop, left: marker.offsetLeft, lineHeight };
  document.body.removeChild(div);
  return coords;
}

// Textarea with "@" mention autocomplete. Typing "@" (optionally followed by part of a
// name) opens a list of matching profiles anchored at the "@"; picking one inserts
// "@Full Name " at the caret. The mention is plain text in the body — no notification.
export default function MentionTextarea({
  value,
  onChange,
  onMention,
  users,
  rows,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (next: string) => void;
  // Fires when a user is picked from the autocomplete, so the caller can collect mentioned ids
  // (the id is otherwise discarded — the body only carries the plain "@Name" text).
  onMention?: (user: MentionUser) => void;
  users: MentionUser[];
  rows?: number;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [tokenStart, setTokenStart] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  function syncMentionState(text: string, caret: number) {
    const before = text.slice(0, caret);
    // An "@" at the start or after whitespace, followed by an unbroken name fragment.
    const match = before.match(/(?:^|\s)@([\p{L}\p{N}_-]*)$/u);
    if (match) {
      const start = caret - match[1].length - 1; // index of the "@"
      setQuery(match[1]);
      setTokenStart(start);
      setOpen(true);
      const el = ref.current;
      if (el) {
        const c = caretCoordinates(el, start);
        // Anchor just below the "@", clamped so the list never spills off the right edge.
        const maxLeft = Math.max(0, el.clientWidth - 220);
        setPos({ top: c.top + c.lineHeight - el.scrollTop, left: Math.min(c.left, maxLeft) });
      }
    } else {
      setOpen(false);
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    onChange(e.target.value);
    syncMentionState(e.target.value, e.target.selectionStart ?? e.target.value.length);
  }

  const matches = useMemo(() => {
    if (!open) return [];
    const q = query.toLowerCase();
    return users.filter((u) => (u.full_name || '').toLowerCase().includes(q)).slice(0, 6);
  }, [open, query, users]);

  function selectUser(user: MentionUser) {
    const name = user.full_name || 'Namnlös';
    const caret = ref.current?.selectionStart ?? value.length;
    const before = value.slice(0, tokenStart);
    const after = value.slice(caret);
    const insert = `@${name} `;
    onChange(`${before}${insert}${after}`);
    onMention?.(user);
    setOpen(false);
    const nextCaret = before.length + insert.length;
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(nextCaret, nextCaret);
    });
  }

  return (
    <div className="relative">
      <Textarea
        ref={ref}
        value={value}
        onChange={handleChange}
        onKeyUp={(e) => syncMentionState(e.currentTarget.value, e.currentTarget.selectionStart ?? e.currentTarget.value.length)}
        onClick={(e) => syncMentionState(e.currentTarget.value, e.currentTarget.selectionStart ?? e.currentTarget.value.length)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        rows={rows}
        placeholder={placeholder}
        autoFocus={autoFocus}
      />
      {open && matches.length > 0 ? (
        <div
          className="absolute z-20 w-[210px] overflow-hidden rounded-xl border border-[#e0e8dc] bg-white shadow-[0_16px_32px_rgba(15,23,42,0.12)]"
          style={{ top: pos.top, left: pos.left }}
        >
          <div className="max-h-56 overflow-y-auto">
            {matches.map((user) => (
              <button
                key={user.id}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); selectUser(user); }}
                className="flex w-full items-center gap-2 border-b border-slate-100 px-3 py-2.5 text-left text-sm transition last:border-b-0 hover:bg-[#f1f5ee]"
              >
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-emerald-100 text-[11px] font-bold text-emerald-700">
                  {(user.full_name || '?').slice(0, 1).toUpperCase()}
                </span>
                <span className="truncate font-medium text-slate-800">{user.full_name}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
