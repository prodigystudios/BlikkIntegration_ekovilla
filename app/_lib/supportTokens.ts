import type { TicketKind, TicketStatus } from '@/lib/domains/support/types';

// Visuella tokens för appärenden. Delade mellan rapportera-formuläret (app/components) och
// backloggen (app/admin/support) så ett ärende ser likadant ut var man än möter det. Ligger i
// app/_lib eftersom båda ytorna behöver dem men ingen äger dem — samma plats som appNav.
//
// FÄRGEN BETYDER STATUS, INGET ANNAT. Typen (bugg/förslag) visas med ett tecken och sitt ord i
// stället för en egen färgskala. Två färgskalor på samma rad gör att ingen av dem går att läsa
// snabbt — och statusen är det man skannar en backlog efter. Samma grepp som arbetsorderlistan,
// där railen alltid betyder status.

export const ticketStatusMeta: Record<TicketStatus, { badge: string; accent: string }> = {
  new: { badge: 'border-sky-200 bg-sky-50 text-sky-800', accent: 'bg-sky-400' },
  planned: { badge: 'border-violet-200 bg-violet-50 text-violet-700', accent: 'bg-violet-400' },
  in_progress: { badge: 'border-amber-200 bg-amber-50 text-amber-900', accent: 'bg-amber-400' },
  done: { badge: 'border-emerald-200 bg-emerald-50 text-emerald-800', accent: 'bg-emerald-500' },
  // Slate, inte rosa: "blir inte av" är ett beslut, inte ett fel. Rött hade läst som att något
  // gick sönder.
  declined: { badge: 'border-slate-200 bg-slate-50 text-slate-500', accent: 'bg-slate-300' },
};

// Ett tecken räcker för att skilja de två typerna åt i en lista, och skalar till radhöjd utan en
// ikonuppsättning att underhålla.
export const ticketKindGlyph: Record<TicketKind, string> = {
  bug: '!',
  idea: '+',
};

export const ticketKindGlyphClass: Record<TicketKind, string> = {
  bug: 'bg-rose-100 text-rose-700',
  idea: 'bg-[#e4efe0] text-emerald-800',
};
