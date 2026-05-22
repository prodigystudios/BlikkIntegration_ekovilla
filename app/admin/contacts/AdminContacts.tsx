"use client";
import React, { useEffect, useState, useMemo } from 'react';
import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';
import { DataTable, DataTableCell, DataTableHeaderCell } from '../../../components/ui/DataTable';
import EmptyState from '../../../components/ui/EmptyState';
import ErrorState from '../../../components/ui/ErrorState';
import Input from '../../../components/ui/Input';
import { TabsList, TabsTrigger } from '../../../components/ui/Tabs';
import { cn } from '../../../lib/shared/cn';

interface Category { id: string; name: string; sort: number; }
interface Contact { id: string; category_id: string; name: string; phone?: string | null; location?: string | null; role?: string | null; sort: number; }
interface Address { id: string; name: string; address: string; sort: number; }

export default function AdminContacts() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [view, setView] = useState<'contacts'|'addresses'>('contacts');
  const [search, setSearch] = useState('');

  async function loadAll() {
    setLoading(true); setError(null);
    try {
      const [catRes, peopleRes, addrRes] = await Promise.all([
        fetch('/api/admin/contacts/categories'),
        fetch('/api/admin/contacts/people'),
        fetch('/api/admin/contacts/addresses')
      ]);
      if (!catRes.ok || !peopleRes.ok || !addrRes.ok) throw new Error('Fel vid hämtning');
      const catJson = await catRes.json();
      const peopleJson = await peopleRes.json();
      const addrJson = await addrRes.json();
      setCategories(catJson.categories || []);
      setContacts(peopleJson.contacts || []);
      setAddresses(addrJson.addresses || []);
      if (!activeCat && (catJson.categories||[]).length) setActiveCat(catJson.categories[0].id);
    } catch (e:any) {
      setError(e.message || 'Något gick fel');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { loadAll(); }, []);

  const filteredContacts = useMemo(() => {
    const term = search.trim().toLowerCase();
    return contacts.filter(c => {
      const categoryMatch = !activeCat || c.category_id === activeCat;
      const termMatch = !term ? true : [c.name, c.phone || '', c.location || '', c.role || ''].some((value) => value.toLowerCase().includes(term));
      return categoryMatch && termMatch;
    });
  }, [contacts, activeCat, search]);

  const filteredAddresses = useMemo(() => {
    const term = search.trim().toLowerCase();
    return addresses.filter((address) => !term || [address.name, address.address].some((value) => value.toLowerCase().includes(term)));
  }, [addresses, search]);

  async function createCategory(name: string) {
    const res = await fetch('/api/admin/contacts/categories', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name }) });
    if (res.ok) { const j = await res.json(); setCategories(c=>[...c, j.category]); if (!activeCat) setActiveCat(j.category.id); }
  }
  async function updateCategory(id: string, patch: any) {
    const res = await fetch(`/api/admin/contacts/categories/${id}`, { method: 'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify(patch) });
    if (res.ok) { const j = await res.json(); setCategories(list=>list.map(c=>c.id===id?j.category:c)); }
  }
  async function deleteCategory(id: string) {
    if (!confirm('Ta bort kategori och alla dess kontakter?')) return;
    const res = await fetch(`/api/admin/contacts/categories/${id}`, { method: 'DELETE' });
    if (res.ok) { setCategories(c=>c.filter(x=>x.id!==id)); setContacts(p=>p.filter(x=>x.category_id!==id)); if (activeCat===id) setActiveCat(null); }
  }
  async function createContact(d: Partial<Contact>) {
    const res = await fetch('/api/admin/contacts/people', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(d) });
    if (res.ok) { const j = await res.json(); setContacts(p=>[...p, j.contact]); }
  }
  async function updateContact(id: string, patch: any) {
    const res = await fetch(`/api/admin/contacts/people/${id}`, { method: 'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify(patch) });
    if (res.ok) { const j = await res.json(); setContacts(list=>list.map(c=>c.id===id?j.contact:c)); }
  }
  async function deleteContact(id: string) {
    if (!confirm('Ta bort kontakt?')) return;
    const res = await fetch(`/api/admin/contacts/people/${id}`, { method: 'DELETE' });
    if (res.ok) setContacts(list=>list.filter(c=>c.id!==id));
  }
  async function createAddress(payload: Partial<Address>) {
    const res = await fetch('/api/admin/contacts/addresses', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    if (res.ok) { const j = await res.json(); setAddresses(a=>[...a, j.address]); }
  }
  async function updateAddress(id: string, patch: any) {
    const res = await fetch(`/api/admin/contacts/addresses/${id}`, { method: 'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify(patch) });
    if (res.ok) { const j = await res.json(); setAddresses(list=>list.map(a=>a.id===id?j.address:a)); }
  }
  async function deleteAddress(id: string) {
    if (!confirm('Ta bort adress?')) return;
    const res = await fetch(`/api/admin/contacts/addresses/${id}`, { method: 'DELETE' });
    if (res.ok) setAddresses(list=>list.filter(a=>a.id!==id));
  }

  return (
    <main className="mx-auto box-border grid w-full max-w-[1400px] gap-5 p-3">
      <section className="grid gap-4 rounded-[24px] border border-ui-border bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] p-5 shadow-[0_14px_36px_rgba(15,23,42,0.04)]">
        <div className="flex flex-wrap items-start gap-4">
          <div className="grid max-w-[760px] gap-1.5">
            <div className="flex flex-wrap gap-2">
              <Badge variant="accent" className="px-2.5 py-1 text-[11px] uppercase tracking-[0.35px]">Kontakter</Badge>
              <Badge>{categories.length} kategorier</Badge>
              <Badge>{contacts.length} personer</Badge>
              <Badge>{addresses.length} adresser</Badge>
            </div>
            <h1 className="m-0 text-[30px] text-slate-900">Kontaktregister med tydligare arbetsyta</h1>
            <p className="m-0 text-sm leading-[1.55] text-slate-600">Hantera kategorier, personer och adresser i samma vy med bättre filtrering och snabbare redigering.</p>
          </div>
          <div className="ml-auto flex flex-wrap gap-3">
            <Button onClick={loadAll} disabled={loading} variant="secondary">{loading ? 'Laddar...' : 'Uppdatera'}</Button>
          </div>
        </div>

        <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))]">
          <div className="grid gap-1 rounded-2xl border border-ui-border bg-white px-3 py-2.5">
            <span className="text-[11px] font-extrabold uppercase tracking-[0.3px] text-slate-500">Aktiv vy</span>
            <strong className="text-xl font-extrabold text-slate-900">{view === 'contacts' ? 'Kontakter' : 'Adresser'}</strong>
          </div>
          <div className="grid gap-1 rounded-2xl border border-ui-border bg-white px-3 py-2.5">
            <span className="text-[11px] font-extrabold uppercase tracking-[0.3px] text-slate-500">Vald kategori</span>
            <strong className="text-xl font-extrabold text-slate-900">{activeCat ? (categories.find(c=>c.id===activeCat)?.name || 'Vald') : 'Alla'}</strong>
          </div>
          <div className="grid gap-1 rounded-2xl border border-ui-border bg-white px-3 py-2.5">
            <span className="text-[11px] font-extrabold uppercase tracking-[0.3px] text-slate-500">Visar</span>
            <strong className="text-xl font-extrabold text-slate-900">{view === 'contacts' ? filteredContacts.length : filteredAddresses.length}</strong>
          </div>
        </div>
      </section>

      {error && <ErrorState title="Kunde inte läsa kontaktregistret" message={error} />}
      <section className="grid gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList aria-label="Kontaktregister-vy" className="gap-3">
            <TabsTrigger
              onClick={()=>setView('contacts')}
              active={view === 'contacts'}
            >
              Kontakter
            </TabsTrigger>
            <TabsTrigger
              onClick={()=>setView('addresses')}
              active={view === 'addresses'}
            >
              Adresser
            </TabsTrigger>
          </TabsList>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={view === 'contacts' ? 'Sök namn, telefon, plats eller roll' : 'Sök namn eller adress'}
            className="min-w-[280px] sm:w-[360px]"
          />
        </div>
        {view==='contacts' && (
          <div className="grid items-start gap-6 xl:[grid-template-columns:minmax(250px,300px)_minmax(0,1fr)]">
            <div className="min-w-0 flex flex-col gap-3 self-start rounded-[20px] border border-ui-border bg-white p-[18px] shadow-[0_10px_28px_rgba(15,23,42,0.03)]">
              <h2 className="m-0 text-base text-slate-900">Kategorier</h2>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-1.5">
                  <Button onClick={()=>setActiveCat(null)} variant={!activeCat ? 'accent' : 'secondary'} size="sm" fullWidth className="justify-start">Alla kategorier</Button>
                </div>
                {categories.map(cat => (
                  <div key={cat.id} className="flex items-center gap-1.5">
                    <Button onClick={()=>setActiveCat(cat.id)} variant={activeCat===cat.id ? 'accent' : 'secondary'} size="sm" fullWidth className="justify-start">{cat.name}</Button>
                    <Button onClick={()=>{ const name=prompt('Nytt namn', cat.name); if(name) updateCategory(cat.id,{ name }); }} variant="secondary" size="sm" className="min-h-8 px-2 text-xs" aria-label="Byt namn">✏️</Button>
                    <Button onClick={()=>deleteCategory(cat.id)} variant="secondary" size="sm" className="min-h-8 px-2 text-xs text-red-700 hover:bg-red-50" aria-label="Ta bort">🗑️</Button>
                  </div>
                ))}
              </div>
              <form onSubmit={e=>{e.preventDefault(); const fd=new FormData(e.currentTarget); const name=String(fd.get('name')||'').trim(); if(name) { (e.currentTarget as HTMLFormElement).reset(); createCategory(name);} }} className="mt-2 flex gap-2">
                <Input name="name" placeholder="Ny kategori" className="min-h-9 px-2.5 py-2 text-[13px]" />
                <Button type="submit" variant="primary" size="sm">Lägg till</Button>
              </form>
            </div>
            <div className="min-w-0 flex flex-col gap-4 rounded-[20px] border border-ui-border bg-white p-[18px] shadow-[0_10px_28px_rgba(15,23,42,0.03)]">
              <div className="grid gap-1">
                <h2 className="m-0 text-lg text-slate-900">Kontakter {activeCat && '• ' + (categories.find(c=>c.id===activeCat)?.name || '')}</h2>
                <span className="text-[13px] text-slate-500">Inline-redigering med snabb filtrering och tydligare tabellstruktur.</span>
              </div>
              <div className="grid gap-3 md:hidden">
                {filteredContacts.map(c => (
                  <article key={c.id} className="grid gap-3 rounded-[18px] border border-slate-200 bg-slate-50/60 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]">
                    <div className="flex items-start justify-between gap-3">
                      <div className="grid min-w-0 gap-1">
                        <span className="text-base font-bold text-slate-900">{c.name}</span>
                        <span className="text-xs text-slate-500">Kontakt</span>
                      </div>
                      <Button onClick={()=>deleteContact(c.id)} variant="secondary" size="sm" className="min-h-8 px-2 text-xs text-red-700 hover:bg-red-50">🗑️</Button>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <FieldBlock label="Namn"><Editable value={c.name} onSave={v=> updateContact(c.id,{ name:v })} /></FieldBlock>
                      <FieldBlock label="Telefon"><Editable value={c.phone||''} placeholder="—" onSave={v=> updateContact(c.id,{ phone:v })} /></FieldBlock>
                      <FieldBlock label="Plats"><Editable value={c.location||''} placeholder="—" onSave={v=> updateContact(c.id,{ location:v })} /></FieldBlock>
                      <FieldBlock label="Roll"><Editable value={c.role||''} placeholder="—" onSave={v=> updateContact(c.id,{ role:v })} /></FieldBlock>
                    </div>
                  </article>
                ))}
              </div>
              <div className="hidden md:block">
                <DataTable className="min-w-[700px]">
                  <thead>
                    <tr className="bg-slate-50">
                      {['Namn','Telefon','Plats','Roll',' '].map(h=> <DataTableHeaderCell key={h}>{h}</DataTableHeaderCell>)}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredContacts.map(c => (
                      <tr key={c.id} className="bg-white"> 
                        <DataTableCell><Editable value={c.name} onSave={v=> updateContact(c.id,{ name:v })} /></DataTableCell>
                        <DataTableCell><Editable value={c.phone||''} placeholder="—" onSave={v=> updateContact(c.id,{ phone:v })} /></DataTableCell>
                        <DataTableCell><Editable value={c.location||''} placeholder="—" onSave={v=> updateContact(c.id,{ location:v })} /></DataTableCell>
                        <DataTableCell><Editable value={c.role||''} placeholder="—" onSave={v=> updateContact(c.id,{ role:v })} /></DataTableCell>
                        <DataTableCell className="w-[50px] text-right"><Button onClick={()=>deleteContact(c.id)} variant="secondary" size="sm" className="min-h-8 px-2 text-xs text-red-700 hover:bg-red-50">🗑️</Button></DataTableCell>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
              </div>
              {filteredContacts.length === 0 && <EmptyState title="Inga kontakter matchar" description="Byt kategori eller justera sökningen för att visa fler träffar." />}
              {activeCat && (
                <form onSubmit={e=>{e.preventDefault(); const fd=new FormData(e.currentTarget); const name=String(fd.get('name')||'').trim(); if(!name) return; const phone=String(fd.get('phone')||'').trim(); const location=String(fd.get('location')||'').trim(); const role=String(fd.get('role')||'').trim(); createContact({ category_id: activeCat, name, phone, location, role }); (e.currentTarget as HTMLFormElement).reset(); }} className="grid items-end gap-2 [grid-template-columns:repeat(auto-fit,minmax(140px,1fr))]">
                  <Input name="name" placeholder="Namn" required />
                  <Input name="phone" placeholder="Telefon" />
                  <Input name="location" placeholder="Plats" />
                  <Input name="role" placeholder="Roll" />
                  <Button type="submit" variant="primary">Lägg till</Button>
                </form>
              )}
            </div>
          </div>
        )}
        {view==='addresses' && (
          <div className="min-w-0 flex flex-col gap-4 rounded-[20px] border border-ui-border bg-white p-[18px] shadow-[0_10px_28px_rgba(15,23,42,0.03)]">
            <div className="grid gap-1">
              <h2 className="m-0 text-lg text-slate-900">Adresser</h2>
              <span className="text-[13px] text-slate-500">Håll platsregistret uppdaterat för snabbare återanvändning i andra flöden.</span>
            </div>
            <div className="grid gap-3 md:hidden">
              {filteredAddresses.map(a => (
                <article key={a.id} className="grid gap-3 rounded-[18px] border border-slate-200 bg-slate-50/60 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]">
                  <div className="flex items-start justify-between gap-3">
                    <div className="grid min-w-0 gap-1">
                      <span className="text-base font-bold text-slate-900">{a.name}</span>
                      <span className="text-xs text-slate-500">Adresspost</span>
                    </div>
                    <Button onClick={()=>deleteAddress(a.id)} variant="secondary" size="sm" className="min-h-8 px-2 text-xs text-red-700 hover:bg-red-50">🗑️</Button>
                  </div>
                  <div className="grid gap-3">
                    <FieldBlock label="Namn"><Editable value={a.name} onSave={v=> updateAddress(a.id,{ name:v })} /></FieldBlock>
                    <FieldBlock label="Adress"><Editable value={a.address} onSave={v=> updateAddress(a.id,{ address:v })} /></FieldBlock>
                  </div>
                </article>
              ))}
            </div>
            <div className="hidden md:block">
              <DataTable className="min-w-[600px]">
                <thead><tr className="bg-slate-50">{['Namn','Adress',' '].map(h=> <DataTableHeaderCell key={h}>{h}</DataTableHeaderCell>)}</tr></thead>
                <tbody>
                  {filteredAddresses.map(a => (
                    <tr key={a.id} className="bg-white">
                      <DataTableCell><Editable value={a.name} onSave={v=> updateAddress(a.id,{ name:v })} /></DataTableCell>
                      <DataTableCell><Editable value={a.address} onSave={v=> updateAddress(a.id,{ address:v })} /></DataTableCell>
                      <DataTableCell className="w-[50px] text-right"><Button onClick={()=>deleteAddress(a.id)} variant="secondary" size="sm" className="min-h-8 px-2 text-xs text-red-700 hover:bg-red-50">🗑️</Button></DataTableCell>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            </div>
            {filteredAddresses.length === 0 && <EmptyState title="Inga adresser matchar" description="Justera sökningen eller lägg till en ny adress." />}
            <form onSubmit={e=>{e.preventDefault(); const fd=new FormData(e.currentTarget); const name=String(fd.get('name')||'').trim(); const address=String(fd.get('address')||'').trim(); if(!name||!address) return; createAddress({ name, address }); (e.currentTarget as HTMLFormElement).reset(); }} className="grid items-end gap-2 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">
              <Input name="name" placeholder="Namn" required />
              <Input name="address" placeholder="Adress" required />
              <Button type="submit" variant="primary">Lägg till</Button>
            </form>
          </div>
        )}
      </section>
    </main>
  );
}

function Editable({ value, onSave, placeholder }: { value: string; onSave: (v:string)=>void; placeholder?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(()=>{ setDraft(value); }, [value]);
  if (!editing) return <div className="flex items-center gap-1.5"><span className={cn('text-sm', value ? 'text-slate-900' : 'text-slate-400')}>{value || placeholder || '—'}</span><Button onClick={()=>setEditing(true)} variant="secondary" size="sm" className="min-h-8 px-2 text-xs" aria-label="Redigera">✏️</Button></div>;
  return (
    <form onSubmit={e=>{e.preventDefault(); onSave(draft.trim()); setEditing(false);}} className="flex gap-1.5">
      <Input autoFocus value={draft} onChange={e=>setDraft(e.target.value)} className="min-h-8 px-2 py-1.5 text-[13px]" />
      <Button type="submit" variant="primary" size="sm">Spara</Button>
      <Button type="button" onClick={()=>{ setEditing(false); setDraft(value); }} variant="secondary" size="sm">Avbryt</Button>
    </form>
  );
}

function FieldBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[11px] font-extrabold uppercase tracking-[0.35px] text-slate-500">{label}</span>
      {children}
    </label>
  );
}

