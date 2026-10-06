"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { getCrmOverviewWindow } from '@/lib/domains/crm/goals';
import type { WeeklyScoreboard } from '@/lib/domains/crm/weeklyScoreboard';
import { WEEK_PARAM, parseWeekParam, scoreboardWindowFor } from './overviewWeek';
import { readSection } from './useCrmOverviewData';

type WeekBoardState = { weekStart: string; scoreboard: WeeklyScoreboard | null; loading: boolean; failed: boolean };

// Veckan som tavlan, topplistan och raderna per säljare visar, när det INTE är denna vecka. Denna
// veckas tavla läses av useCrmOverviewData som förut — bannern och "N samtal från stjärnan" bygger
// på den och ska alltid visa nuläget, vad som än är valt här.
//
// Veckan bärs i adressfältet som startsidans arbetsschema (#97): ?vecka=<måndagens datum>, ett
// ABSOLUT datum, och parametern SAKNAS på denna vecka — så att en flik som stått öppen över en
// söndagsnatt inte låses fast en vecka bakåt.
export function useWeekBoard() {
  // null = denna vecka.
  const [selected, setSelected] = useState<string | null>(null);
  const [board, setBoard] = useState<WeekBoardState | null>(null);
  // Ett svar från en överkörd vecka skriver inte över en senare, och hämtningen avbryts — tio snabba
  // tryck bakåt ska inte låta nio tavlor räknas klart på servern i onödan.
  const loadIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = () => {
    loadIdRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
  };

  const fetchWeek = useCallback(async (weekStart: string) => {
    cancel();
    const loadId = loadIdRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    setBoard((prev) => ({
      weekStart,
      // Samma vecka igen (Uppdatera): det som står kvar visas medan den läses om.
      scoreboard: prev?.weekStart === weekStart ? prev.scoreboard : null,
      loading: true,
      failed: false,
    }));
    const range = scoreboardWindowFor(weekStart, getCrmOverviewWindow());
    const query = new URLSearchParams({ today: range.today, week_start: range.weekStart, week_end: range.weekEnd });
    const section = await readSection(`/api/crm/overview/scoreboard?${query}`, controller.signal);
    if (loadId !== loadIdRef.current) return;
    const scoreboard = (section.json?.data?.scoreboard as WeeklyScoreboard | undefined) ?? null;
    setBoard((prev) => ({
      weekStart,
      scoreboard: scoreboard ?? (prev?.weekStart === weekStart ? prev.scoreboard : null),
      loading: false,
      failed: !section.ok || scoreboard == null,
    }));
  }, []);

  const writeUrl = (weekStart: string | null) => {
    const url = new URL(window.location.href);
    if (weekStart) url.searchParams.set(WEEK_PARAM, weekStart);
    else url.searchParams.delete(WEEK_PARAM);
    // replaceState, inte router.replace: en router-navigering hade kostat en server-rundtur per tryck,
    // och "bakåt" ska inte stega genom varje vecka man bläddrat förbi. Se DashboardSchedule.tsx.
    window.history.replaceState({}, '', url.toString());
  };

  /**
   * Välj en vecka (måndagens datum). `currentWeekStart` är veckan som denna vecka-tavlan faktiskt
   * laddat — inte klockans — så att etiketten och siffrorna aldrig namnger olika veckor i en flik
   * som stått öppen över en söndagsnatt. Denna vecka, eller null, går tillbaka till nuläget.
   */
  const select = useCallback((weekStart: string | null, currentWeekStart: string) => {
    const next = weekStart === currentWeekStart ? null : weekStart;
    if (next == null) cancel();
    setSelected(next);
    writeUrl(next);
    if (next) void fetchWeek(next);
  }, [fetchWeek]);

  // URL:en läses i en effekt, aldrig i en state-initierare: sidan server-renderas, och ett
  // `typeof window`-undantag hade gett servern förvalet och klienten den sparade veckan —
  // en hydreringskrock. Samma mönster som DashboardSchedule.tsx.
  useEffect(() => {
    const week = parseWeekParam(new URLSearchParams(window.location.search).get(WEEK_PARAM));
    if (week) select(week, getCrmOverviewWindow().weekStart);
    return cancel;
  }, [select]);

  /** Läs om den valda veckan (Uppdatera). Denna vecka läses om av översiktens egen laddning. */
  const reload = useCallback(() => {
    if (selected) void fetchWeek(selected);
  }, [fetchWeek, selected]);

  return { selected, board: selected && board?.weekStart === selected ? board : null, select, reload };
}
