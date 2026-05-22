"use client";
import React from 'react';
import AdminUsers from './users/AdminUsers';
import dynamic from 'next/dynamic';
import AdminBlikkUsersMapping from './blikk/AdminBlikkUsersMapping';
import Badge from '../../components/ui/Badge';
import PageShell from '../../components/ui/PageShell';
import { TabsList, TabsTrigger } from '../../components/ui/Tabs';

const AdminContacts = dynamic(() => import('./contacts/AdminContacts'), { ssr: false });
const AdminDepotUsage = dynamic(() => import('./depots/AdminDepotUsage'), { ssr: false });
const AdminNews = dynamic(() => import('./news/AdminNews'), { ssr: false });

type AdminTab = 'users'|'contacts'|'depots'|'blikk'|'news';

const tabs: Array<{ id: AdminTab; label: string; summary: string }> = [
  { id: 'users', label: 'Användare', summary: 'Konton, roller och taggar' },
  { id: 'contacts', label: 'Kontakter', summary: 'Kategorier, personer och adresser' },
  { id: 'depots', label: 'Depå-uttag', summary: 'Förbrukning och senaste uttag' },
  { id: 'blikk', label: 'Blikk-koppling', summary: 'Matchning mellan profiler och Blikk' },
  { id: 'news', label: 'Nyheter', summary: 'Skapa och publicera dashboardnyheter' },
];

function resolveAdminTab(fromQuery: string | null, fromStorage: string | null): AdminTab | null {
  return [fromQuery, fromStorage].find((value): value is AdminTab => tabs.some((tabDef) => tabDef.id === value)) ?? null;
}

export default function AdminTabsClient() {
  const [tab, setTab] = React.useState<AdminTab>('users');
  const [hasResolvedInitialTab, setHasResolvedInitialTab] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get('tab');
    const fromStorage = window.localStorage.getItem('admin.activeTab');
    const candidate = resolveAdminTab(fromQuery, fromStorage);
    if (candidate) setTab(candidate);
    setHasResolvedInitialTab(true);
  }, []);

  React.useEffect(() => {
    if (typeof window === 'undefined' || !hasResolvedInitialTab) return;
    window.localStorage.setItem('admin.activeTab', tab);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tab);
    window.history.replaceState({}, '', url.toString());
  }, [hasResolvedInitialTab, tab]);

  const currentTab = tabs.find((item) => item.id === tab) || tabs[0];

  return (
    <PageShell className="max-w-[1460px] gap-5">
      <section className="grid gap-4 rounded-[28px] border border-ui-border bg-[linear-gradient(180deg,#ffffff_0%,#f7fbff_100%)] p-5 shadow-[0_18px_46px_rgba(15,23,42,0.05)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="grid max-w-[760px] gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="accent" className="px-2.5 py-1 text-[11px] uppercase tracking-[0.35px]">
                Admincenter
              </Badge>
              <Badge>{tabs.length} arbetsytor</Badge>
              <Badge>Aktiv: {currentTab.label}</Badge>
            </div>
            <div className="grid gap-1.5">
              <h1 className="m-0 text-[34px] leading-[1.04] text-slate-900">Administration med bättre överblick</h1>
              <p className="m-0 text-sm leading-[1.55] text-slate-600">
                Hantera användare, kontakter, depåer, Blikk-matchning och nyheter från en tydligare gemensam adminyta.
              </p>
            </div>
          </div>

          <div className="grid min-w-[220px] gap-2">
            <div className="grid gap-1.5 rounded-[18px] border border-ui-border bg-white px-3.5 py-3">
              <span className="text-[11px] font-extrabold uppercase tracking-[0.3px] text-slate-500">Aktiv vy</span>
              <strong className="text-lg font-extrabold text-slate-900">{currentTab.label}</strong>
              <span className="text-xs text-slate-500">{currentTab.summary}</span>
            </div>
          </div>
        </div>

        <TabsList aria-label="Adminytor" className="gap-2.5">
          {tabs.map((tabDef) => {
            const active = tab === tabDef.id;

            return (
              <TabsTrigger
                key={tabDef.id}
                onClick={() => setTab(tabDef.id)}
                active={active}
                variant="card"
                className="min-w-[168px]"
              >
                <span className="font-bold">{tabDef.label}</span>
                <span className={active ? 'text-xs opacity-90' : 'text-xs opacity-75'}>{tabDef.summary}</span>
              </TabsTrigger>
            );
          })}
        </TabsList>
      </section>

      <section className="rounded-[30px] border border-slate-200 bg-[linear-gradient(180deg,#f8fbff_0%,#ffffff_100%)] shadow-[0_18px_44px_rgba(15,23,42,0.04)]">
        {tab==='users' && <AdminUsers />}
        {tab==='contacts' && <AdminContacts />}
        {tab==='depots' && <AdminDepotUsage />}
        {tab==='blikk' && <AdminBlikkUsersMapping />}
        {tab==='news' && <AdminNews />}
      </section>
    </PageShell>
  );
}
