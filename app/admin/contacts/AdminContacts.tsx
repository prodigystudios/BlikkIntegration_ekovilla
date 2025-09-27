"use client";
import React, { useEffect, useState, useMemo } from 'react';

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
  const [saving, setSaving] = useState(false);

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

  const filteredContacts = useMemo(() => contacts.filter(c => !activeCat || c.category_id === activeCat), [contacts, activeCat]);

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
    <main style={{ padding: 32, maxWidth: 1300, margin: '0 auto', display:'flex', flexDirection:'column', gap:32 }}>
      <header style={{ display:'flex', alignItems:'center', gap:16, flexWrap:'wrap' }}>
        <h1 style={{ margin:0, fontSize:30 }}>Admin • Kontakter</h1>
        <div style={{ marginLeft:'auto', display:'flex', gap:12 }}>
          <button onClick={loadAll} disabled={loading} style={btnSecondary}>{loading? 'Laddar...' : 'Uppdatera'}</button>
        </div>
      </header>
      {error && <div style={{ color:'#b91c1c', fontSize:14 }}>{error}</div>}
      <section style={{ display:'grid', gap:24 }}> 
        <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
          <button onClick={()=>setView('contacts')} className={view==='contacts'?'tab--active':'tab'}>Kontakter</button>
          <button onClick={()=>setView('addresses')} className={view==='addresses'?'tab--active':'tab'}>Adresser</button>
        </div>
        {view==='contacts' && (
          <div style={{ display:'grid', gap:24, gridTemplateColumns:'240px 1fr' }}>
            <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
              <h2 style={{ margin:0, fontSize:16 }}>Kategorier</h2>
              <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                {categories.map(cat => (
                  <div key={cat.id} style={{ display:'flex', alignItems:'center', gap:6 }}>
                    <button onClick={()=>setActiveCat(cat.id)} style={{ ...catBtn, ...(activeCat===cat.id? catBtnActive : {}) }}>{cat.name}</button>
                    <button onClick={()=>{ const name=prompt('Nytt namn', cat.name); if(name) updateCategory(cat.id,{ name }); }} style={iconBtn} aria-label="Byt namn">✏️</button>
                    <button onClick={()=>deleteCategory(cat.id)} style={{ ...iconBtn, color:'#b91c1c' }} aria-label="Ta bort">🗑️</button>
                  </div>
                ))}
              </div>
              <form onSubmit={e=>{e.preventDefault(); const fd=new FormData(e.currentTarget); const name=String(fd.get('name')||'').trim(); if(name) { (e.currentTarget as HTMLFormElement).reset(); createCategory(name);} }} style={{ display:'flex', gap:6, marginTop:8 }}>
                <input name="name" placeholder="Ny kategori" style={inputSmall} />
                <button style={btnPrimary}>Lägg till</button>
              </form>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
              <h2 style={{ margin:0, fontSize:16 }}>Kontakter {activeCat && '• ' + (categories.find(c=>c.id===activeCat)?.name || '')}</h2>
              <div style={{ overflowX:'auto', border:'1px solid #e5e7eb', borderRadius:12 }}>
                <table style={{ width:'100%', borderCollapse:'collapse', minWidth:700 }}>
                  <thead>
                    <tr style={{ background:'#f9fafb' }}>
                      {['Namn','Telefon','Plats','Roll',' '].map(h=> <th key={h} style={th}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredContacts.map(c => (
                      <tr key={c.id} style={tr}> 
                        <td style={td}><Editable value={c.name} onSave={v=> updateContact(c.id,{ name:v })} /></td>
                        <td style={td}><Editable value={c.phone||''} placeholder="—" onSave={v=> updateContact(c.id,{ phone:v })} /></td>
                        <td style={td}><Editable value={c.location||''} placeholder="—" onSave={v=> updateContact(c.id,{ location:v })} /></td>
                        <td style={td}><Editable value={c.role||''} placeholder="—" onSave={v=> updateContact(c.id,{ role:v })} /></td>
                        <td style={tdLast}><button onClick={()=>deleteContact(c.id)} style={{ ...iconBtn, color:'#b91c1c' }}>🗑️</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {activeCat && (
                <form onSubmit={e=>{e.preventDefault(); const fd=new FormData(e.currentTarget); const name=String(fd.get('name')||'').trim(); if(!name) return; const phone=String(fd.get('phone')||'').trim(); const location=String(fd.get('location')||'').trim(); const role=String(fd.get('role')||'').trim(); createContact({ category_id: activeCat, name, phone, location, role }); (e.currentTarget as HTMLFormElement).reset(); }} style={{ display:'grid', gap:8, gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))', alignItems:'end' }}>
                  <input name="name" placeholder="Namn" required style={input} />
                  <input name="phone" placeholder="Telefon" style={input} />
                  <input name="location" placeholder="Plats" style={input} />
                  <input name="role" placeholder="Roll" style={input} />
                  <button style={btnPrimary}>Lägg till</button>
                </form>
              )}
            </div>
          </div>
        )}
        {view==='addresses' && (
          <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
            <h2 style={{ margin:0, fontSize:16 }}>Adresser</h2>
            <div style={{ overflowX:'auto', border:'1px solid #e5e7eb', borderRadius:12 }}>
              <table style={{ width:'100%', borderCollapse:'collapse', minWidth:600 }}>
                <thead><tr style={{ background:'#f9fafb' }}>{['Namn','Adress',' '].map(h=> <th key={h} style={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {addresses.map(a => (
                    <tr key={a.id} style={tr}>
                      <td style={td}><Editable value={a.name} onSave={v=> updateAddress(a.id,{ name:v })} /></td>
                      <td style={td}><Editable value={a.address} onSave={v=> updateAddress(a.id,{ address:v })} /></td>
                      <td style={tdLast}><button onClick={()=>deleteAddress(a.id)} style={{ ...iconBtn, color:'#b91c1c' }}>🗑️</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <form onSubmit={e=>{e.preventDefault(); const fd=new FormData(e.currentTarget); const name=String(fd.get('name')||'').trim(); const address=String(fd.get('address')||'').trim(); if(!name||!address) return; createAddress({ name, address }); (e.currentTarget as HTMLFormElement).reset(); }} style={{ display:'grid', gap:8, gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))', alignItems:'end' }}>
              <input name="name" placeholder="Namn" required style={input} />
              <input name="address" placeholder="Adress" required style={input} />
              <button style={btnPrimary}>Lägg till</button>
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
  if (!editing) return <div style={{ display:'flex', alignItems:'center', gap:6 }}><span style={{ color: value? '#111827':'#9ca3af' }}>{value || placeholder || '—'}</span><button onClick={()=>setEditing(true)} style={iconBtn} aria-label="Redigera">✏️</button></div>;
  return (
    <form onSubmit={e=>{e.preventDefault(); onSave(draft.trim()); setEditing(false);}} style={{ display:'flex', gap:6 }}>
      <input autoFocus value={draft} onChange={e=>setDraft(e.target.value)} style={{ ...input, padding:'4px 6px', fontSize:13 }} />
      <button style={{ ...miniBtn }}>{'Spara'}</button>
      <button type="button" onClick={()=>{ setEditing(false); setDraft(value); }} style={{ ...miniBtn, background:'#fff', color:'#111827', border:'1px solid #d1d5db' }}>Avbryt</button>
    </form>
  );
}

const input: React.CSSProperties = { padding:'8px 10px', border:'1px solid #d1d5db', borderRadius:8, fontSize:14, outline:'none' };
const inputSmall: React.CSSProperties = { ...input, padding:'6px 8px', fontSize:13 };
const btnPrimary: React.CSSProperties = { padding:'8px 12px', borderRadius:8, border:'1px solid #111827', background:'#111827', color:'#fff', fontSize:13, cursor:'pointer', fontWeight:500 };
const btnSecondary: React.CSSProperties = { ...btnPrimary, background:'#fff', color:'#111827' };
const iconBtn: React.CSSProperties = { padding:'2px 6px', fontSize:12, lineHeight:1, cursor:'pointer', background:'#f3f4f6', borderRadius:6, border:'1px solid #e5e7eb' };
const miniBtn: React.CSSProperties = { padding:'4px 8px', background:'#111827', color:'#fff', borderRadius:6, fontSize:12, cursor:'pointer', border:'1px solid #111827' };
const th: React.CSSProperties = { padding:'8px 10px', fontSize:11, textTransform:'uppercase', letterSpacing:0.5, textAlign:'left', color:'#374151' };
const td: React.CSSProperties = { padding:'6px 10px', fontSize:14, borderTop:'1px solid #f1f5f9', verticalAlign:'middle' };
const tdLast: React.CSSProperties = { ...td, width:50, textAlign:'right' };
const tr: React.CSSProperties = { background:'#fff' };
const catBtn: React.CSSProperties = { padding:'6px 10px', background:'#f3f4f6', border:'1px solid #e5e7eb', borderRadius:8, fontSize:13, cursor:'pointer', flexGrow:1, textAlign:'left' };
const catBtnActive: React.CSSProperties = { background:'#111827', color:'#fff', border:'1px solid #111827' };
