"use client";
import React, { useEffect, useState, useMemo } from 'react';
import { DataTable, DataTableCell, DataTableHeaderCell } from '../../../components/ui/DataTable';
import Input from '../../../components/ui/Input';
import { TabsList, TabsTrigger } from '../../../components/ui/Tabs';
import { crm } from '../../crm/lib/crmTokens';
import { cn } from '../../../lib/shared/cn';
import AdminPromptDialog from '../components/AdminPromptDialog';
import { ADMIN_CARD, ADMIN_COLHEAD, ADMIN_ERROR_BOX, ADMIN_INSET, ADMIN_LABEL, AdminEmptyState } from '../components/adminUi';

type ContactsDialog =
  | { kind: 'deleteCategory'; id: string; name: string }
  | { kind: 'renameCategory'; id: string; name: string }
  | { kind: 'deleteContact'; id: string; name: string }
  | { kind: 'deleteAddress'; id: string; name: string };

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
  const [dialog, setDialog] = useState<ContactsDialog | null>(null);

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
      const nextCategories = catJson.data?.categories || [];
      setCategories(nextCategories);
      setContacts(peopleJson.data?.contacts || []);
      setAddresses(addrJson.data?.addresses || []);
      if (!activeCat && nextCategories.length) setActiveCat(nextCategories[0].id);
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
    if (res.ok) { const j = await res.json(); const category = j.data?.category; if (!category) return; setCategories(c=>[...c, category]); if (!activeCat) setActiveCat(category.id); }
  }
  async function updateCategory(id: string, patch: any) {
    const res = await fetch(`/api/admin/contacts/categories/${id}`, { method: 'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify(patch) });
    if (res.ok) { const j = await res.json(); const category = j.data?.category; if (!category) return; setCategories(list=>list.map(c=>c.id===id?category:c)); }
  }
  async function deleteCategory(id: string) {
    const res = await fetch(`/api/admin/contacts/categories/${id}`, { method: 'DELETE' });
    if (res.ok) { setCategories(c=>c.filter(x=>x.id!==id)); setContacts(p=>p.filter(x=>x.category_id!==id)); if (activeCat===id) setActiveCat(null); }
  }
  async function createContact(d: Partial<Contact>) {
    const res = await fetch('/api/admin/contacts/people', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(d) });
    if (res.ok) { const j = await res.json(); const contact = j.data?.contact; if (!contact) return; setContacts(p=>[...p, contact]); }
  }
  async function updateContact(id: string, patch: any) {
    const res = await fetch(`/api/admin/contacts/people/${id}`, { method: 'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify(patch) });
    if (res.ok) { const j = await res.json(); const contact = j.data?.contact; if (!contact) return; setContacts(list=>list.map(c=>c.id===id?contact:c)); }
  }
  async function deleteContact(id: string) {
    const res = await fetch(`/api/admin/contacts/people/${id}`, { method: 'DELETE' });
    if (res.ok) setContacts(list=>list.filter(c=>c.id!==id));
  }
  async function createAddress(payload: Partial<Address>) {
    const res = await fetch('/api/admin/contacts/addresses', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    if (res.ok) { const j = await res.json(); const address = j.data?.address; if (!address) return; setAddresses(a=>[...a, address]); }
  }
  async function updateAddress(id: string, patch: any) {
    const res = await fetch(`/api/admin/contacts/addresses/${id}`, { method: 'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify(patch) });
    if (res.ok) { const j = await res.json(); const address = j.data?.address; if (!address) return; setAddresses(list=>list.map(a=>a.id===id?address:a)); }
  }
  async function deleteAddress(id: string) {
    const res = await fetch(`/api/admin/contacts/addresses/${id}`, { method: 'DELETE' });
    if (res.ok) setAddresses(list=>list.filter(a=>a.id!==id));
  }

  async function runDialogConfirm(value: string) {
    if (!dialog) return;
    switch (dialog.kind) {
      case 'deleteCategory': await deleteCategory(dialog.id); break;
      case 'renameCategory': if (value) await updateCategory(dialog.id, { name: value }); break;
      case 'deleteContact': await deleteContact(dialog.id); break;
      case 'deleteAddress': await deleteAddress(dialog.id); break;
    }
    setDialog(null);
  }

  return (
    <div className="grid gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h2 className="m-0 text-lg font-bold text-slate-900">Kontakter</h2>
          <p className="m-0 text-sm text-slate-600">Kategorier, personer och adresser för hela appen.</p>
        </div>
        <button type="button" onClick={loadAll} disabled={loading} className={crm.ghostButton}>
          {loading ? 'Laddar…' : 'Uppdatera'}
        </button>
      </div>

      {error && <div role="alert" className={ADMIN_ERROR_BOX}>{error}</div>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabsList aria-label="Kontaktregister-vy" className="gap-2">
          <TabsTrigger onClick={()=>setView('contacts')} active={view === 'contacts'}>
            Kontakter
          </TabsTrigger>
          <TabsTrigger onClick={()=>setView('addresses')} active={view === 'addresses'}>
            Adresser
          </TabsTrigger>
        </TabsList>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={view === 'contacts' ? 'Sök namn, telefon, plats eller roll' : 'Sök namn eller adress'}
          className="sm:w-[360px]"
        />
      </div>

      {view==='contacts' && (
        <div className="grid items-start gap-4 xl:[grid-template-columns:minmax(250px,300px)_minmax(0,1fr)]">
          <div className={cn(ADMIN_CARD, 'min-w-0 flex flex-col gap-3 self-start p-4')}>
            <h3 className="m-0 text-base font-bold text-slate-900">Kategorier</h3>
            <div className="flex flex-col gap-1.5">
              <div className="flex">
                <CategoryButton active={!activeCat} onClick={()=>setActiveCat(null)}>Alla kategorier</CategoryButton>
              </div>
              {categories.map(cat => (
                // flex-wrap + basis: i den smala kategorikolumnen (250–300px) far
                // annars namn + två textknappar ut ur kortet. Knapparna hoppar ned
                // på egen rad i stället för att spilla över grannkortet.
                <div key={cat.id} className="flex flex-wrap items-center gap-1.5">
                  <CategoryButton active={activeCat===cat.id} onClick={()=>setActiveCat(cat.id)}>{cat.name}</CategoryButton>
                  <button
                    type="button"
                    onClick={()=>setDialog({ kind:'renameCategory', id:cat.id, name:cat.name })}
                    className={cn(crm.ghostButton, 'shrink-0')}
                  >
                    Byt namn
                  </button>
                  <button
                    type="button"
                    onClick={()=>setDialog({ kind:'deleteCategory', id:cat.id, name:cat.name })}
                    className={cn(crm.dangerButton, 'h-8 shrink-0')}
                    aria-label={`Ta bort kategorin ${cat.name}`}
                  >
                    Ta bort
                  </button>
                </div>
              ))}
            </div>
            <form onSubmit={e=>{e.preventDefault(); const fd=new FormData(e.currentTarget); const name=String(fd.get('name')||'').trim(); if(name) { (e.currentTarget as HTMLFormElement).reset(); createCategory(name);} }} className="mt-2 flex gap-2">
              <Input name="name" placeholder="Ny kategori" className="min-h-9 px-2.5 py-2 text-[13px]" />
              <button type="submit" className={crm.formButton} style={{ backgroundColor: 'var(--ek-green)' }}>Lägg till</button>
            </form>
          </div>

          <div className={cn(ADMIN_CARD, 'min-w-0 flex flex-col gap-4 p-4')}>
            <h3 className="m-0 text-base font-bold text-slate-900">Kontakter {activeCat && '• ' + (categories.find(c=>c.id===activeCat)?.name || '')}</h3>
            <div className="grid gap-3 md:hidden">
              {filteredContacts.map(c => (
                <article key={c.id} className={cn(ADMIN_INSET, 'grid gap-3 p-3.5')}>
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-[13px] font-bold text-slate-900">{c.name}</span>
                    <button
                      type="button"
                      onClick={()=>setDialog({ kind:'deleteContact', id:c.id, name:c.name })}
                      className={cn(crm.dangerButton, 'h-8')}
                    >
                      Ta bort
                    </button>
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
              <DataTable className="min-w-[700px]" containerClassName="border-[#e0e8dc]">
                <thead>
                  <tr className="bg-[#f9fbf7]">
                    {['Namn','Telefon','Plats','Roll',' '].map(h=> <DataTableHeaderCell key={h} className={ADMIN_COLHEAD}>{h}</DataTableHeaderCell>)}
                  </tr>
                </thead>
                <tbody>
                  {filteredContacts.map(c => (
                    <tr key={c.id} className="bg-white">
                      <DataTableCell><Editable value={c.name} onSave={v=> updateContact(c.id,{ name:v })} /></DataTableCell>
                      <DataTableCell><Editable value={c.phone||''} placeholder="—" onSave={v=> updateContact(c.id,{ phone:v })} /></DataTableCell>
                      <DataTableCell><Editable value={c.location||''} placeholder="—" onSave={v=> updateContact(c.id,{ location:v })} /></DataTableCell>
                      <DataTableCell><Editable value={c.role||''} placeholder="—" onSave={v=> updateContact(c.id,{ role:v })} /></DataTableCell>
                      <DataTableCell className="text-right">
                        <button
                          type="button"
                          onClick={()=>setDialog({ kind:'deleteContact', id:c.id, name:c.name })}
                          className={cn(crm.dangerButton, 'h-8')}
                        >
                          Ta bort
                        </button>
                      </DataTableCell>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            </div>
            {loading && <p role="status" className="m-0 text-sm text-slate-400">Laddar…</p>}
            {!loading && filteredContacts.length === 0 && !error && (
              <AdminEmptyState title="Inga kontakter matchar" description="Byt kategori eller justera sökningen för att visa fler träffar." />
            )}
            {activeCat && (
              <form onSubmit={e=>{e.preventDefault(); const fd=new FormData(e.currentTarget); const name=String(fd.get('name')||'').trim(); if(!name) return; const phone=String(fd.get('phone')||'').trim(); const location=String(fd.get('location')||'').trim(); const role=String(fd.get('role')||'').trim(); createContact({ category_id: activeCat, name, phone, location, role }); (e.currentTarget as HTMLFormElement).reset(); }} className="grid items-end gap-2 [grid-template-columns:repeat(auto-fit,minmax(140px,1fr))]">
                <Input name="name" placeholder="Namn" required />
                <Input name="phone" placeholder="Telefon" />
                <Input name="location" placeholder="Plats" />
                <Input name="role" placeholder="Roll" />
                <button type="submit" className={crm.formButton} style={{ backgroundColor: 'var(--ek-green)' }}>Lägg till</button>
              </form>
            )}
          </div>
        </div>
      )}

      {view==='addresses' && (
        <div className={cn(ADMIN_CARD, 'min-w-0 flex flex-col gap-4 p-4')}>
          <h3 className="m-0 text-base font-bold text-slate-900">Adresser</h3>
          <div className="grid gap-3 md:hidden">
            {filteredAddresses.map(a => (
              <article key={a.id} className={cn(ADMIN_INSET, 'grid gap-3 p-3.5')}>
                <div className="flex items-start justify-between gap-3">
                  <span className="text-[13px] font-bold text-slate-900">{a.name}</span>
                  <button
                    type="button"
                    onClick={()=>setDialog({ kind:'deleteAddress', id:a.id, name:a.name })}
                    className={cn(crm.dangerButton, 'h-8')}
                  >
                    Ta bort
                  </button>
                </div>
                <div className="grid gap-3">
                  <FieldBlock label="Namn"><Editable value={a.name} onSave={v=> updateAddress(a.id,{ name:v })} /></FieldBlock>
                  <FieldBlock label="Adress"><Editable value={a.address} onSave={v=> updateAddress(a.id,{ address:v })} /></FieldBlock>
                </div>
              </article>
            ))}
          </div>
          <div className="hidden md:block">
            <DataTable className="min-w-[600px]" containerClassName="border-[#e0e8dc]">
              <thead>
                <tr className="bg-[#f9fbf7]">
                  {['Namn','Adress',' '].map(h=> <DataTableHeaderCell key={h} className={ADMIN_COLHEAD}>{h}</DataTableHeaderCell>)}
                </tr>
              </thead>
              <tbody>
                {filteredAddresses.map(a => (
                  <tr key={a.id} className="bg-white">
                    <DataTableCell><Editable value={a.name} onSave={v=> updateAddress(a.id,{ name:v })} /></DataTableCell>
                    <DataTableCell><Editable value={a.address} onSave={v=> updateAddress(a.id,{ address:v })} /></DataTableCell>
                    <DataTableCell className="text-right">
                      <button
                        type="button"
                        onClick={()=>setDialog({ kind:'deleteAddress', id:a.id, name:a.name })}
                        className={cn(crm.dangerButton, 'h-8')}
                      >
                        Ta bort
                      </button>
                    </DataTableCell>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          </div>
          {loading && <p role="status" className="m-0 text-sm text-slate-400">Laddar…</p>}
          {!loading && filteredAddresses.length === 0 && !error && (
            <AdminEmptyState title="Inga adresser matchar" description="Justera sökningen eller lägg till en ny adress." />
          )}
          <form onSubmit={e=>{e.preventDefault(); const fd=new FormData(e.currentTarget); const name=String(fd.get('name')||'').trim(); const address=String(fd.get('address')||'').trim(); if(!name||!address) return; createAddress({ name, address }); (e.currentTarget as HTMLFormElement).reset(); }} className="grid items-end gap-2 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">
            <Input name="name" placeholder="Namn" required />
            <Input name="address" placeholder="Adress" required />
            <button type="submit" className={crm.formButton} style={{ backgroundColor: 'var(--ek-green)' }}>Lägg till</button>
          </form>
        </div>
      )}

      {dialog && (dialog.kind === 'renameCategory' ? (
        <AdminPromptDialog
          title="Byt namn på kategori"
          inputLabel="Nytt namn"
          defaultValue={dialog.name}
          confirmLabel="Spara"
          onConfirm={runDialogConfirm}
          onClose={() => setDialog(null)}
        />
      ) : (
        <AdminPromptDialog
          title={
            dialog.kind === 'deleteCategory' ? 'Ta bort kategori'
            : dialog.kind === 'deleteContact' ? 'Ta bort kontakt'
            : 'Ta bort adress'
          }
          message={
            dialog.kind === 'deleteCategory'
              ? `Ta bort ”${dialog.name}” och alla dess kontakter? Det går inte att ångra.`
              : `Ta bort ”${dialog.name}”? Det går inte att ångra.`
          }
          confirmLabel="Ta bort"
          danger
          onConfirm={runDialogConfirm}
          onClose={() => setDialog(null)}
        />
      ))}
    </div>
  );
}

function CategoryButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex min-h-9 min-w-0 flex-1 basis-[140px] items-center justify-start truncate rounded-xl border px-3 text-sm font-semibold transition',
        active ? 'border-transparent text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-800',
      )}
      style={active ? { backgroundColor: 'var(--ek-green)' } : undefined}
    >
      {children}
    </button>
  );
}

function Editable({ value, onSave, placeholder }: { value: string; onSave: (v:string)=>void; placeholder?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(()=>{ setDraft(value); }, [value]);
  if (!editing) return (
    <div className="flex items-center gap-1.5">
      <span className={cn('text-sm', value ? 'text-slate-900' : 'text-slate-400')}>{value || placeholder || '—'}</span>
      <button type="button" onClick={()=>setEditing(true)} className={cn(crm.ghostButton, 'shrink-0')}>Redigera</button>
    </div>
  );
  return (
    <form onSubmit={e=>{e.preventDefault(); onSave(draft.trim()); setEditing(false);}} className="flex gap-1.5">
      <Input autoFocus value={draft} onChange={e=>setDraft(e.target.value)} className="min-h-8 px-2 py-1.5 text-[13px]" />
      <button type="submit" className={crm.formButton} style={{ backgroundColor: 'var(--ek-green)' }}>Spara</button>
      <button type="button" onClick={()=>{ setEditing(false); setDraft(value); }} className={crm.ghostButton}>Avbryt</button>
    </form>
  );
}

// Medvetet div + span, inte AdminField: blocken innehåller knappar (Editable),
// och en <label> utan htmlFor aktiverar sin första knapp vid klick på rubriken.
function FieldBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <span className={ADMIN_LABEL}>{label}</span>
      {children}
    </div>
  );
}
