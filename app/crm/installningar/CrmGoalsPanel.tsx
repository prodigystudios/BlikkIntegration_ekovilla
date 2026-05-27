'use client';

import { useMemo, useState } from 'react';
import Input from '../../../components/ui/Input';
import SectionCard from '../../../components/ui/SectionCard';
import { useToast } from '@/lib/Toast';

type TeamMember = {
  id: string;
  full_name: string | null;
  role: 'sales' | 'admin';
};

type GoalItem = {
  user_id: string;
  calls_target: number;
  quotes_target: number;
  quote_value_target: number | string;
};

type GoalDraft = {
  calls_target: string;
  quotes_target: string;
  quote_value_target: string;
};

function formatGoalInputValue(value: number | string | null | undefined) {
  const numeric = typeof value === 'number' ? value : Number(String(value ?? ''));
  if (!Number.isFinite(numeric) || numeric === 0) return '';
  return String(value);
}

function formatPeriodLabel(periodStart: string) {
  const start = new Date(`${periodStart}T12:00:00`);
  if (Number.isNaN(start.getTime())) return periodStart;
  const end = new Date(start);
  end.setDate(end.getDate() + 6);

  const formatter = new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short' });
  return `${formatter.format(start)} - ${formatter.format(end)}`;
}

export default function CrmGoalsPanel({
  team,
  initialGoals,
  periodStart,
}: {
  team: TeamMember[];
  initialGoals: GoalItem[];
  periodStart: string;
}) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, GoalDraft>>(() => {
    const byUserId = new Map(initialGoals.map((item) => [item.user_id, item]));
    return Object.fromEntries(
      team.map((member) => {
        const goal = byUserId.get(member.id);
        return [member.id, {
          calls_target: formatGoalInputValue(goal?.calls_target),
          quotes_target: formatGoalInputValue(goal?.quotes_target),
          quote_value_target: formatGoalInputValue(goal?.quote_value_target),
        }];
      }),
    );
  });

  const configuredCount = useMemo(
    () => team.filter((member) => {
      const draft = drafts[member.id];
      return draft && (Number(draft.calls_target) > 0 || Number(draft.quotes_target) > 0 || Number(draft.quote_value_target) > 0);
    }).length,
    [drafts, team],
  );

  function setDraftValue(userId: string, field: keyof GoalDraft, value: string) {
    setDrafts((current) => ({
      ...current,
      [userId]: {
        ...(current[userId] || { calls_target: '', quotes_target: '', quote_value_target: '' }),
        [field]: value,
      },
    }));
  }

  async function saveGoals() {
    setSaving(true);
    setError(null);

    try {
      const goals = team.map((member) => ({
        user_id: member.id,
        calls_target: Number(drafts[member.id]?.calls_target || 0),
        quotes_target: Number(drafts[member.id]?.quotes_target || 0),
        quote_value_target: Number(drafts[member.id]?.quote_value_target || 0),
      }));

      const res = await fetch('/api/crm/goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          period_type: 'week',
          period_start: periodStart,
          goals,
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        setError(json?.error || 'Kunde inte spara målen.');
        return;
      }

      toast.success('Veckomålen sparades.');
    } catch {
      setError('Kunde inte spara målen.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard className="grid gap-4 border-slate-200 bg-white/90 p-5 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <strong className="text-base font-bold text-slate-950">Veckomål per säljare</strong>
          <p className="m-0 text-sm leading-6 text-slate-600">Sätt mål för samtal, offerter och offertvärde för veckan. Översikten kan sedan jämföra aktiviteten mot dessa nivåer.</p>
        </div>
        <div className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-3 text-right">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Aktiv vecka</div>
          <strong className="block text-sm text-slate-900">{formatPeriodLabel(periodStart)}</strong>
          <div className="mt-1 text-xs text-slate-500">{configuredCount} av {team.length} med mål</div>
        </div>
      </div>

      {error ? <div className="rounded-[20px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

      <div className="grid gap-3">
        {team.map((member) => (
          <div key={member.id} className="grid gap-3 rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] px-4 py-4 shadow-[0_12px_24px_rgba(15,23,42,0.05)]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong className="text-sm font-semibold text-slate-950">{member.full_name || 'Namn saknas'}</strong>
              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-600">
                {member.role === 'admin' ? 'Admin' : 'Sälj'}
              </span>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <Input
                value={drafts[member.id]?.calls_target || ''}
                onChange={(event) => setDraftValue(member.id, 'calls_target', event.target.value)}
                inputMode="numeric"
                placeholder="0"
              />
              <Input
                value={drafts[member.id]?.quotes_target || ''}
                onChange={(event) => setDraftValue(member.id, 'quotes_target', event.target.value)}
                inputMode="numeric"
                placeholder="0"
              />
              <Input
                value={drafts[member.id]?.quote_value_target || ''}
                onChange={(event) => setDraftValue(member.id, 'quote_value_target', event.target.value)}
                inputMode="decimal"
                placeholder="0"
              />
            </div>
            <div className="grid gap-2 text-xs text-slate-500 md:grid-cols-3">
              <span>Mål antal samtal</span>
              <span>Mål antal offerter</span>
              <span>Mål offertvärde (SEK)</span>
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={saveGoals}
          disabled={saving}
          className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-sky-600 bg-[linear-gradient(180deg,#0ea5e9_0%,#0284c7_100%)] px-4 py-2 text-sm font-semibold text-white shadow-[0_16px_26px_rgba(2,132,199,0.22)] transition hover:brightness-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? 'Sparar…' : 'Spara veckomål'}
        </button>
      </div>
    </SectionCard>
  );
}