"use client";
import React from 'react';
import AdminUsers from './users/AdminUsers';
import dynamic from 'next/dynamic';
import AdminBlikkUsersMapping from './blikk/AdminBlikkUsersMapping';
import Badge from '../../components/ui/Badge';
import PageShell from '../../components/ui/PageShell';
import { TabsList, TabsTrigger } from '../../components/ui/Tabs';
import { crm } from '../crm/lib/crmTokens';
import { cn } from '../../lib/shared/cn';

const AdminContacts = dynamic(() => import('./contacts/AdminContacts'), { ssr: false });
const AdminDepotUsage = dynamic(() => import('./depots/AdminDepotUsage'), { ssr: false });
const AdminNews = dynamic(() => import('./news/AdminNews'), { ssr: false });
const AdminPermissions = dynamic(() => import('./permissions/AdminPermissions'), { ssr: false });

type AdminTab = 'users'|'permissions'|'contacts'|'depots'|'blikk'|'news';

const tabs: Array<{ id: AdminTab; label: string; summary: string }> = [
  { id: 'users', label: 'Användare', summary: 'Konton, roller och taggar' },
  { id: 'permissions', label: 'Behörigheter', summary: 'Roller och per-användar-behörigheter' },
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

  return (
    <PageShell className="max-w-[1460px]">
      <section className={cn(crm.cardInner, 'grid gap-4')}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid max-w-[760px] gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="accent" className="px-2.5 py-1 text-[11px] uppercase tracking-[0.35px]">
                Admincenter
              </Badge>
              <Badge>{tabs.length} arbetsytor</Badge>
            </div>
            <h1 className={crm.pageTitle}>Administration</h1>
            <p className={crm.pageSubtitle}>
              Hantera användare, behörigheter, kontakter, depåer, Blikk-matchning och nyheter från en gemensam adminyta.
            </p>
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

      <section className={crm.card}>
        {tab==='users' && <AdminUsers />}
        {tab==='permissions' && <AdminPermissions />}
        {tab==='contacts' && <AdminContacts />}
        {tab==='depots' && <AdminDepotUsage />}
        {tab==='blikk' && <AdminBlikkUsersMapping />}
        {tab==='news' && <AdminNews />}
      </section>
    </PageShell>
  );
}
