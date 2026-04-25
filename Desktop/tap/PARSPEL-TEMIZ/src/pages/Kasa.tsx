import { useState, useMemo } from 'react';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/ConfirmDialog';
import { useSoundFeedback } from '@/hooks/useSoundFeedback';
import { exportToExcel } from '@/lib/excelExport';
import { genId, formatMoney, formatDate } from '@/lib/utils-tr';
import type { DB } from '@/types';

interface Props { db: DB; save: (fn: (prev: DB) => DB) => void; }

export default function Kasa({ db, save }: Props) {
  const { showToast } = useToast();
  const { showConfirm } = useConfirm();
  const { playSound } = useSoundFeedback();
  const [incomeModal, setIncomeModal] = useState(false);
  const [expenseModal, setExpenseModal] = useState(false);
  const [filter, setFilter] = useState('all');
  const [kasaFilter, setKasaFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const catLabels: Record<string, string> = {
    satis: '🛒 Satış', tahsilat: '💰 Tahsilat', diger_gelir: '➕ Diğer Gelir',
    ortak_tahsilat: '🤝 Ortak Tahsilat',
    tedarik: '🏭 Tedarik', kira: '🏠 Kira', maas: '👤 Maaş',
    fatura: '📄 Fatura', nakliye: '🚛 Nakliye', diger_gider: '➖ Diğer Gider',
    iade: '🔄 İade',
  };
  const [form, setForm] = useState({ amount: '', description: '', kasa: 'nakit', cariId: '', partnerId: '', category: '' });

  const kasalar = db.kasalar || [{ id: 'nakit', name: 'Nakit', icon: '💵' }, { id: 'banka', name: 'Banka', icon: '🏦' }];

  const bakiyeler = useMemo(() => {
    const map: Record<string, number> = {};
    kasalar.forEach(k => map[k.id] = 0);
    db.kasa.filter(e => !e.deleted).forEach(e => {
      map[e.kasa] = (map[e.kasa] || 0) + (e.type === 'gelir' ? e.amount : -e.amount);
    });
    return map;
  }, [db.kasa, kasalar]);

  const totalBakiye = Object.values(bakiyeler).reduce((s, v) => s + v, 0);

  let entries = db.kasa.filter(e => !e.deleted);
  if (filter === 'gelir') entries = entries.filter(e => e.type === 'gelir');
  else if (filter === 'gider') entries = entries.filter(e => e.type === 'gider');
  if (kasaFilter !== 'all') entries = entries.filter(e => e.kasa === kasaFilter);
  if (search) entries = entries.filter(e => (e.description || '').toLowerCase().includes(search.toLowerCase()) || (catLabels[e.category] || e.category || '').toLowerCase().includes(search.toLowerCase()));
  if (dateFrom) entries = entries.filter(e => e.createdAt >= dateFrom);
  if (dateTo) entries = entries.filter(e => e.createdAt <= dateTo + 'T23:59:59');
  const sorted = [...entries].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const saveEntry = (type: 'gelir' | 'gider') => {
    const amount = parseFloat(form.amount);
    if (!amount || amount <= 0) { showToast('Geçerli tutar girin!', 'error'); return; }
    if (form.category === 'ortak_tahsilat' && !form.partnerId) { showToast('Ortak tahsilat için ortak seçin!', 'error'); return; }
    const nowIso = new Date().toISOString();
    const entry = {
      id: genId(), type, category: form.category || (type === 'gelir' ? 'diger_gelir' : 'diger_gider'),
      amount, kasa: form.kasa, description: form.description, cariId: form.cariId || undefined,
      createdAt: nowIso, updatedAt: nowIso,
    };
    save(prev => {
      let cari = prev.cari;
      if (form.cariId) {
        cari = cari.map(c => c.id === form.cariId ? { ...c, balance: (c.balance || 0) - amount, lastTransaction: nowIso, updatedAt: nowIso } : c);
      }
      // Ortak tahsilatı → ortakEmanetler'e de yaz
      let ortakEmanetler = prev.ortakEmanetler || [];
      if (form.partnerId && entry.category === 'ortak_tahsilat') {
        ortakEmanetler = [...ortakEmanetler, {
          id: genId(), partnerId: form.partnerId, amount,
          note: form.description || 'Kasa tahsilatı',
          description: form.description || 'Kasa tahsilatı',
          type: 'emanet' as const,
          createdAt: nowIso, updatedAt: nowIso,
        }];
      }
      return { ...prev, kasa: [...prev.kasa, entry], cari, ortakEmanetler };
    });
    playSound(type === 'gelir' ? 'success' : 'notification');
    showToast(`${type === 'gelir' ? 'Gelir' : 'Gider'} kaydedildi!`, 'success');
    setForm({ amount: '', description: '', kasa: 'nakit', cariId: '', partnerId: '', category: '' });
    setIncomeModal(false);
    setExpenseModal(false);
  };

  const deleteEntry = (id: string) => {
    showConfirm('Kaydı Sil', 'Bu kasa kaydını silmek istediğinizden emin misiniz?', () => {
      const nowIso = new Date().toISOString();
      save(prev => {
        const entry = prev.kasa.find(e => e.id === id);
        if (!entry) return prev;

        // Soft delete
        const kasa = prev.kasa.map(e => e.id === id ? { ...e, deleted: true, updatedAt: nowIso } : e);

        // Cari bakiyeyi geri al
        let cari = prev.cari;
        if (entry.cariId) {
          cari = cari.map(c =>
            c.id === entry.cariId
              ? { ...c, balance: (c.balance || 0) + entry.amount, lastTransaction: nowIso, updatedAt: nowIso }
              : c
          );
        }

        return { ...prev, kasa, cari };
      });
      showToast('Kayıt silindi!', 'success');
    });
  };

  const incomeCategories = ['satis', 'tahsilat', 'ortak_tahsilat', 'diger_gelir'];
  const expenseCategories = ['tedarik', 'kira', 'maas', 'fatura', 'nakliye', 'diger_gider'];

  const EntryModal = ({ type, open, onClose }: { type: 'gelir' | 'gider'; open: boolean; onClose: () => void }) => (
    <Modal open={open} onClose={onClose} title={type === 'gelir' ? '💚 Gelir Ekle' : '🔴 Gider Ekle'}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div style={{ gridColumn: '1/-1' }}>
          <label style={lbl}>Tutar (₺) *</label>
          <input type="number" inputMode="decimal" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} style={inp} placeholder="0,00" min={0} step={0.01} />
        </div>
        <div>
          <label style={lbl}>Kasa</label>
          <select value={form.kasa} onChange={e => setForm(f => ({ ...f, kasa: e.target.value }))} style={inp}>
            {kasalar.map(k => <option key={k.id} value={k.id}>{k.icon} {k.name}</option>)}
          </select>
        </div>
        <div>
          <label style={lbl}>Kategori</label>
          <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} style={inp}>
            <option value="">Seçin</option>
            {(type === 'gelir' ? incomeCategories : expenseCategories).map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div style={{ gridColumn: '1/-1' }}>
          <label style={lbl}>Cari (opsiyonel)</label>
          <select value={form.cariId} onChange={e => setForm(f => ({ ...f, cariId: e.target.value }))} style={inp}>
            <option value="">-- Cari Seç --</option>
            {db.cari.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        {type === 'gelir' && form.category === 'ortak_tahsilat' && (
          <div style={{ gridColumn: '1/-1' }}>
            <label style={lbl}>Ortak *</label>
            <select value={form.partnerId} onChange={e => setForm(f => ({ ...f, partnerId: e.target.value }))} style={inp}>
              <option value="">-- Ortak Seç --</option>
              {(db.partners || []).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        )}
        <div style={{ gridColumn: '1/-1' }}>
          <label style={lbl}>Açıklama</label>
          <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} style={inp} placeholder="Açıklama..." />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
        <button onClick={() => saveEntry(type)} style={{ flex: 1, background: type === 'gelir' ? '#10b981' : '#ef4444', border: 'none', borderRadius: 10, color: '#fff', padding: '11px 0', fontWeight: 700, cursor: 'pointer' }}>
          💾 Kaydet
        </button>
        <button onClick={onClose} style={{ background: '#273548', border: '1px solid #334155', borderRadius: 10, color: '#94a3b8', padding: '11px 20px', cursor: 'pointer' }}>İptal</button>
      </div>
    </Modal>
  );

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={{ background: '#1e293b', borderRadius: 14, padding: '16px 20px', border: '1px solid #334155', flex: '1 1 140px' }}>
          <div style={{ color: '#64748b', fontSize: '0.78rem', marginBottom: 4, textTransform: 'uppercase' }}>💰 Toplam Kasa</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: totalBakiye >= 0 ? '#10b981' : '#ef4444' }}>{formatMoney(totalBakiye)}</div>
        </div>
        {kasalar.map(k => (
          <div key={k.id} style={{ background: '#1e293b', borderRadius: 14, padding: '16px 20px', border: '1px solid #334155', flex: '1 1 120px', cursor: 'pointer' }} onClick={() => setKasaFilter(k.id)}>
            <div style={{ color: '#64748b', fontSize: '0.78rem', marginBottom: 4 }}>{k.icon} {k.name}</div>
            <div style={{ fontSize: '1.3rem', fontWeight: 800, color: (bakiyeler[k.id] || 0) >= 0 ? '#10b981' : '#ef4444' }}>{formatMoney(bakiyeler[k.id] || 0)}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={() => setIncomeModal(true)} style={{ background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 10, color: '#10b981', padding: '10px 18px', fontWeight: 700, cursor: 'pointer' }}>+ Gelir</button>
        <button onClick={() => setExpenseModal(true)} style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 10, color: '#ef4444', padding: '10px 18px', fontWeight: 700, cursor: 'pointer' }}>- Gider</button>
        <button onClick={() => { exportToExcel(db, { sheets: ['kasa'] }); showToast('Excel indirildi!', 'success'); }} style={{ background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: 10, color: '#60a5fa', padding: '10px 16px', fontWeight: 700, cursor: 'pointer', fontSize: '0.85rem' }}>📊 Excel İndir</button>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Ara..." style={{ padding: '9px 13px', background: '#1e293b', border: '1px solid #334155', borderRadius: 10, color: '#f1f5f9', fontSize: '0.9rem', flex: 1 }} />
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ padding: '9px 10px', background: '#1e293b', border: '1px solid #334155', borderRadius: 10, color: '#f1f5f9', fontSize: '0.85rem' }} />
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ padding: '9px 10px', background: '#1e293b', border: '1px solid #334155', borderRadius: 10, color: '#f1f5f9', fontSize: '0.85rem' }} />
        {(dateFrom || dateTo) && <button onClick={() => { setDateFrom(''); setDateTo(''); }} style={{ padding: '8px 10px', border: 'none', borderRadius: 8, background: '#334155', color: '#94a3b8', cursor: 'pointer', fontSize: '0.82rem' }}>✕</button>}
        {['all', 'gelir', 'gider'].map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{ padding: '8px 14px', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem', background: filter === f ? '#ff5722' : '#273548', color: filter === f ? '#fff' : '#94a3b8' }}>
            {f === 'all' ? 'Tümü' : f === 'gelir' ? '💚 Gelir' : '🔴 Gider'}
          </button>
        ))}
        {kasaFilter !== 'all' && <button onClick={() => setKasaFilter('all')} style={{ padding: '8px 12px', border: 'none', borderRadius: 8, background: '#334155', color: '#94a3b8', cursor: 'pointer', fontSize: '0.82rem' }}>✕ Filtre Kaldır</button>}
      </div>

      <div style={{ background: '#1e293b', borderRadius: 14, border: '1px solid #334155', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', whiteSpace: 'nowrap' }}>
          <thead>
            <tr style={{ background: 'rgba(15,23,42,0.6)' }}>
              {['Tarih', 'Açıklama', 'Kategori', 'Kasa', 'Tutar', 'Tür', ''].map(h => (
                <th key={h} style={{ padding: '12px 16px', textAlign: 'left', color: '#64748b', fontSize: '0.78rem', fontWeight: 600, textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>Kayıt bulunamadı</td></tr>
            ) : sorted.map(e => (
              <tr key={e.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <td style={{ padding: '11px 16px', color: '#64748b', fontSize: '0.82rem' }}>{formatDate(e.createdAt)}</td>
                <td style={{ padding: '11px 16px', color: '#f1f5f9', fontSize: '0.9rem', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.description || '-'}</td>
                <td style={{ padding: '11px 16px', color: '#94a3b8', fontSize: '0.82rem' }}>{catLabels[e.category] || e.category || '-'}</td>
                <td style={{ padding: '11px 16px', color: '#94a3b8' }}>{kasalar.find(k => k.id === e.kasa)?.icon} {e.kasa}</td>
                <td style={{ padding: '11px 16px', fontWeight: 700, color: e.type === 'gelir' ? '#10b981' : '#ef4444' }}>
                  {e.type === 'gelir' ? '+' : '-'}{formatMoney(e.amount)}
                </td>
                <td style={{ padding: '11px 16px' }}>
                  <span style={{ background: e.type === 'gelir' ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)', color: e.type === 'gelir' ? '#10b981' : '#ef4444', borderRadius: 6, padding: '2px 8px', fontSize: '0.8rem', fontWeight: 600 }}>
                    {e.type === 'gelir' ? '💚 Gelir' : '🔴 Gider'}
                  </span>
                </td>
                <td style={{ padding: '11px 16px' }}>
                  <button onClick={() => deleteEntry(e.id)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '0.9rem' }}>🗑️</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <EntryModal type="gelir" open={incomeModal} onClose={() => setIncomeModal(false)} />
      <EntryModal type="gider" open={expenseModal} onClose={() => setExpenseModal(false)} />
    </div>
  );
}

const lbl: React.CSSProperties = { display: 'block', marginBottom: 6, color: '#94a3b8', fontSize: '0.85rem', fontWeight: 500 };
const inp: React.CSSProperties = { width: '100%', padding: '10px 14px', background: 'rgba(15,23,42,0.6)', border: '1px solid #334155', borderRadius: 10, color: '#f1f5f9', fontSize: '0.9rem', boxSizing: 'border-box' };
