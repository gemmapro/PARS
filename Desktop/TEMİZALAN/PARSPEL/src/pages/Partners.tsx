import { useState } from 'react';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/ConfirmDialog';
import { Modal } from '@/components/Modal';
import { genId, formatMoney, formatDate } from '@/lib/utils-tr';
import { normalizeTR, similarity, isExactMatch } from '@/lib/similarity';
import type { DB } from '@/types';

interface Partner { id: string; name: string; share?: number; phone?: string; email?: string; note?: string; createdAt: string; }
interface Emanet { id: string; partnerId: string; amount: number; note?: string; createdAt: string; }

interface Props { db: DB; save: (fn: (prev: DB) => DB) => void; }

export default function Partners({ db, save }: Props) {
  const { showToast } = useToast();
  const { showConfirm } = useConfirm();
  const [modal, setModal] = useState(false);
  const [emanetModal, setEmanetModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<Partner>>({ name: '', share: undefined, phone: '', note: '' });
  const [emanetForm, setEmanetForm] = useState({ partnerId: '', amount: '', note: '' });

  const partners: Partner[] = db.partners || [];
  const emanetler: Emanet[] = db.ortakEmanetler || [];

  // Cari çapraz kontrol
  const cariList = db.cari || [];

  const savePartner = () => {
    const trimmedName = (form.name || '').trim();
    if (!trimmedName) { showToast('Ad gerekli!', 'error'); return; }
    const nowIso = new Date().toISOString();

    if (!editId || !isExactMatch(trimmedName, partners.find(p => p.id === editId)?.name || '')) {
      // Ortak listesinde aynı isim var mı?
      const tamOrtak = partners.find(p => p.id !== editId && isExactMatch(p.name, trimmedName));
      if (tamOrtak) {
        showToast(`"${tamOrtak.name}" adında ortak zaten var! Kayıt engellendi.`, 'error');
        return;
      }
      // Cari listesinde aynı isim var mı?
      const tamCari = cariList.find((c: {name:string;deleted?:boolean}) => !c.deleted && isExactMatch(c.name, trimmedName));
      if (tamCari) {
        showToast(`"${tamCari.name}" cari listesinde zaten var! Kayıt engellendi.`, 'error');
        return;
      }
      // Benzer isim kontrolü (ortak + cari birlikte)
      const benzerOrtak = partners.find(p => p.id !== editId && similarity(p.name, trimmedName) >= 70);
      const benzerCari = cariList.find((c: {name:string;deleted?:boolean}) => !c.deleted && similarity(c.name, trimmedName) >= 70);
      const benzer = benzerOrtak || benzerCari;
      if (benzer) {
        const devamEt = window.confirm(`⚠️ "${benzer.name}" adında benzer bir kayıt mevcut.\nYine de kaydetmek istiyor musunuz?`);
        if (!devamEt) return;
      }
    }

    save(prev => {
      const arr = [...(prev.partners || [])];
      let cari = [...(prev.cari || [])];
      if (editId) {
        const i = arr.findIndex((p: Partner) => p.id === editId);
        if (i >= 0) {
          arr[i] = { ...arr[i], ...form, name: trimmedName };
          // Cari adını da güncelle
          const ci = cari.findIndex(c => c.partnerId === editId);
          if (ci >= 0) cari[ci] = { ...cari[ci], name: trimmedName, updatedAt: nowIso };
        }
        showToast('Ortak güncellendi!', 'success');
      } else {
        const newId = genId();
        arr.push({ id: newId, createdAt: nowIso, name: trimmedName, ...form });
        // Otomatik cari aç — ortak: true, partnerId bağlı
        cari.push({
          id: genId(), createdAt: nowIso, updatedAt: nowIso,
          name: trimmedName, type: 'musteri' as const,
          ortak: true, partnerId: newId,
          balance: 0, phone: (form as any).phone || '',
          taxNo: '', email: '', address: '',
        });
        showToast('Ortak eklendi, cari kaydı otomatik açıldı!', 'success');
      }
      return { ...prev, partners: arr, cari };
    });
    setModal(false);
  };

  const deletePartner = (id: string) => {
    showConfirm('Ortağı Sil', 'Emin misiniz?', () => {
      const nowIso = new Date().toISOString();
      let cariCount = 0;
      let emanetCount = 0;
      save(prev => {
        const updatedCari = prev.cari.map(c => {
          if (c.partnerId === id && !c.deleted) { cariCount++; return { ...c, deleted: true, updatedAt: nowIso }; }
          return c;
        });
        const updatedEmanetler = (prev.ortakEmanetler || []).map((e: Emanet) => {
          if (e.partnerId === id && !(e as any).deleted) { emanetCount++; return { ...e, deleted: true, updatedAt: nowIso }; }
          return e;
        });
        return {
          ...prev,
          partners: prev.partners.filter((p: Partner) => p.id !== id),
          cari: updatedCari,
          ortakEmanetler: updatedEmanetler,
        };
      });
      showToast(`Ortak silindi. ${cariCount} cari, ${emanetCount} emanet kaydı temizlendi.`, 'success');
    });
  };

  const saveEmanet = () => {
    if (!emanetForm.partnerId || !emanetForm.amount) { showToast('Ortak ve tutar gerekli!', 'error'); return; }
    const nowIso = new Date().toISOString();
    const tutar = parseFloat(emanetForm.amount);
    save(prev => {
      // ortakEmanetler'e yaz
      const yeniEmanet = {
        id: genId(), partnerId: emanetForm.partnerId, amount: tutar,
        note: emanetForm.note, description: emanetForm.note || 'Emanet',
        type: 'emanet' as const, createdAt: nowIso, updatedAt: nowIso,
      };
      // Kasadan gider yaz
      const kasaEntry = {
        id: genId(), type: 'gider' as const, category: 'ortak_emanet',
        amount: tutar, kasa: 'nakit',
        description: `Ortak emanet: ${partners.find(p => p.id === emanetForm.partnerId)?.name || ''}${emanetForm.note ? ' — ' + emanetForm.note : ''}`,
        relatedId: emanetForm.partnerId, createdAt: nowIso, updatedAt: nowIso,
      };
      // Ortağın cari bakiyesini artır (borç verilen para)
      const cari = prev.cari.map(c =>
        c.ortak && c.partnerId === emanetForm.partnerId
          ? { ...c, balance: (c.balance || 0) + tutar, lastTransaction: nowIso, updatedAt: nowIso }
          : c
      );
      return {
        ...prev,
        ortakEmanetler: [...(prev.ortakEmanetler || []), yeniEmanet],
        kasa: [...prev.kasa, kasaEntry],
        cari,
      };
    });
    showToast('Emanet kaydedildi!', 'success');
    setEmanetForm({ partnerId: '', amount: '', note: '' });
    setEmanetModal(false);
  };

  const totalProfit = db.sales.filter(s => s.status === 'tamamlandi').reduce((s, x) => s + x.profit, 0);

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        <button onClick={() => { setForm({ name: '', share: undefined, phone: '', note: '' }); setEditId(null); setModal(true); }} style={{ background: '#ff5722', border: 'none', borderRadius: 10, color: '#fff', padding: '10px 20px', fontWeight: 700, cursor: 'pointer' }}>+ Ortak Ekle</button>
        <button onClick={() => setEmanetModal(true)} style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: 10, color: '#60a5fa', padding: '10px 16px', cursor: 'pointer', fontWeight: 600 }}>💰 Emanet Kaydet</button>
      </div>

      <div style={{ background: '#1e293b', borderRadius: 14, padding: 20, border: '1px solid #334155', marginBottom: 20 }}>
        <h3 style={{ fontWeight: 700, color: '#f1f5f9', marginBottom: 4 }}>📊 Toplam Kâr Paylaşımı</h3>
        <p style={{ color: '#10b981', fontSize: '1.5rem', fontWeight: 800 }}>{formatMoney(totalProfit)}</p>
        {partners.map(p => (
          <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, padding: '8px 0', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
            <span style={{ color: '#94a3b8' }}>{p.name}{p.share != null ? ` (%${p.share})` : ''}</span>
            <span style={{ color: '#10b981', fontWeight: 700 }}>{p.share != null ? formatMoney(totalProfit * (p.share / 100)) : '—'}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px,1fr))', gap: 14, marginBottom: 20 }}>
        {partners.length === 0 ? (
          <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: 48, color: '#64748b' }}>
            <div style={{ fontSize: '3rem' }}>🤝</div>
            <p style={{ marginTop: 12 }}>Ortak eklenmedi</p>
          </div>
        ) : partners.map(p => {
          const totalEmanet = emanetler.filter(e => e.partnerId === p.id).reduce((s, e) => s + e.amount, 0);
          return (
            <div key={p.id} style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #334155', padding: 18 }}>
              <h4 style={{ fontWeight: 700, color: '#f1f5f9', marginBottom: 4 }}>🤝 {p.name}</h4>
              <p style={{ color: '#ff5722', fontSize: '1rem', fontWeight: 700, marginBottom: 8 }}>{p.share != null ? `%${p.share} pay` : 'Pay belirtilmedi'}</p>
              {p.phone && <p style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: 4 }}>📞 {p.phone}</p>}
              <p style={{ color: '#64748b', fontSize: '0.82rem' }}>Toplam emanet: <strong style={{ color: '#f59e0b' }}>{formatMoney(totalEmanet)}</strong></p>
              <p style={{ color: '#64748b', fontSize: '0.82rem' }}>Kâr payı: <strong style={{ color: '#10b981' }}>{p.share != null ? formatMoney(totalProfit * (p.share / 100)) : '—'}</strong></p>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button onClick={() => { setForm({ ...p }); setEditId(p.id); setModal(true); }} style={{ flex: 1, background: 'rgba(59,130,246,0.1)', border: 'none', borderRadius: 8, color: '#60a5fa', padding: '7px 0', cursor: 'pointer', fontSize: '0.82rem' }}>✏️</button>
                <button onClick={() => deletePartner(p.id)} style={{ background: 'rgba(239,68,68,0.1)', border: 'none', borderRadius: 8, color: '#ef4444', padding: '7px 10px', cursor: 'pointer' }}>🗑️</button>
              </div>
            </div>
          );
        })}
      </div>

      {emanetler.length > 0 && (
        <div style={{ background: '#1e293b', borderRadius: 14, border: '1px solid #334155' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <h3 style={{ fontWeight: 700, color: '#f1f5f9' }}>💰 Emanet Hareketleri</h3>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'rgba(15,23,42,0.6)' }}>
                  {['Tarih', 'Ortak', 'Tutar', 'Not'].map(h => (
                    <th key={h} style={{ padding: '12px 16px', textAlign: 'left', color: '#64748b', fontSize: '0.78rem', fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...emanetler].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map(e => (
                  <tr key={e.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <td style={{ padding: '11px 16px', color: '#64748b', fontSize: '0.82rem' }}>{formatDate(e.createdAt)}</td>
                    <td style={{ padding: '11px 16px', color: '#f1f5f9', fontWeight: 600 }}>{partners.find(p => p.id === e.partnerId)?.name || '-'}</td>
                    <td style={{ padding: '11px 16px', color: '#f59e0b', fontWeight: 700 }}>{formatMoney(e.amount)}</td>
                    <td style={{ padding: '11px 16px', color: '#94a3b8', fontSize: '0.85rem' }}>{e.note || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title={editId ? '✏️ Ortak Düzenle' : '➕ Yeni Ortak'}>
        <div style={{ display: 'grid', gap: 14 }}>
          <div><label style={lbl}>Ad *</label><input value={form.name || ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={inp} /></div>
          <div>
            <label style={lbl}>Hisse Oranı (%) <span style={{ color: '#475569', fontWeight: 400 }}>— isteğe bağlı</span></label>
            <input
              type="number" inputMode="decimal"
              value={form.share ?? ''}
              onChange={e => setForm(f => ({ ...f, share: e.target.value === '' ? undefined : parseFloat(e.target.value) }))}
              style={inp} min={0} max={100} placeholder="Boş bırakılabilir"
            />
          </div>
          <div><label style={lbl}>Telefon</label><input value={form.phone || ''} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} style={inp} /></div>
          <div><label style={lbl}>Not</label><textarea value={form.note || ''} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} style={{ ...inp, minHeight: 50 }} /></div>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button onClick={savePartner} style={{ flex: 1, background: '#10b981', border: 'none', borderRadius: 10, color: '#fff', padding: '11px 0', fontWeight: 700, cursor: 'pointer' }}>💾 Kaydet</button>
          <button onClick={() => setModal(false)} style={{ background: '#273548', border: '1px solid #334155', borderRadius: 10, color: '#94a3b8', padding: '11px 20px', cursor: 'pointer' }}>İptal</button>
        </div>
      </Modal>

      <Modal open={emanetModal} onClose={() => setEmanetModal(false)} title="💰 Emanet Kaydet">
        <div style={{ display: 'grid', gap: 14 }}>
          <div>
            <label style={lbl}>Ortak *</label>
            <select value={emanetForm.partnerId} onChange={e => setEmanetForm(f => ({ ...f, partnerId: e.target.value }))} style={inp}>
              <option value="">-- Seçin --</option>
              {partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div><label style={lbl}>Tutar *</label><input type="number" inputMode="decimal" value={emanetForm.amount} onChange={e => setEmanetForm(f => ({ ...f, amount: e.target.value }))} style={inp} step={0.01} /></div>
          <div><label style={lbl}>Not</label><input value={emanetForm.note} onChange={e => setEmanetForm(f => ({ ...f, note: e.target.value }))} style={inp} /></div>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button onClick={saveEmanet} style={{ flex: 1, background: '#10b981', border: 'none', borderRadius: 10, color: '#fff', padding: '11px 0', fontWeight: 700, cursor: 'pointer' }}>💾 Kaydet</button>
          <button onClick={() => setEmanetModal(false)} style={{ background: '#273548', border: '1px solid #334155', borderRadius: 10, color: '#94a3b8', padding: '11px 20px', cursor: 'pointer' }}>İptal</button>
        </div>
      </Modal>
    </div>
  );
}

const lbl: React.CSSProperties = { display: 'block', marginBottom: 6, color: '#94a3b8', fontSize: '0.85rem', fontWeight: 500 };
const inp: React.CSSProperties = { width: '100%', padding: '10px 14px', background: 'rgba(15,23,42,0.6)', border: '1px solid #334155', borderRadius: 10, color: '#f1f5f9', fontSize: '0.9rem', boxSizing: 'border-box' };
