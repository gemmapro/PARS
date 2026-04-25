import { useState } from 'react';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/ConfirmDialog';
import { exportToExcel, exportArrayToExcel } from '@/lib/excelExport';
import { genId, formatMoney, formatDate } from '@/lib/utils-tr';
import { normalizeTR, similarity, isExactMatch } from '@/lib/similarity';
import type { DB, Cari as CariType } from '@/types';

interface Props { db: DB; save: (fn: (prev: DB) => DB) => void; }

const empty: Omit<CariType, 'id' | 'createdAt' | 'updatedAt'> = { name: '', type: 'musteri', taxNo: '', phone: '', email: '', address: '', balance: 0, note: '' };

// Bir carinin borcunun kaç gündür beklendiğini hesapla
function calcDebtDays(cari: CariType, db: { sales: import('@/types').Sale[]; kasa: import('@/types').KasaEntry[] }): number | null {
  if (cari.balance <= 0) return null;
  const lastPayment = db.kasa
    .filter(k => !k.deleted && k.cariId === cari.id && k.type === 'gelir')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  const lastPaymentDate = lastPayment ? new Date(lastPayment.createdAt) : null;
  const unpaidSales = db.sales
    .filter(s => !s.deleted && s.status === 'tamamlandi' && (s.cariId === cari.id || s.customerId === cari.id))
    .filter(s => !lastPaymentDate || new Date(s.createdAt) > lastPaymentDate)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const oldestUnpaid = unpaidSales[0];
  if (oldestUnpaid) return Math.floor((Date.now() - new Date(oldestUnpaid.createdAt).getTime()) / 86400000);
  if (cari.lastTransaction) return Math.floor((Date.now() - new Date(cari.lastTransaction).getTime()) / 86400000);
  return null;
}

function debtColor(days: number | null): { color: string; bg: string; label: string } {
  if (days === null) return { color: '#64748b', bg: 'transparent', label: '' };
  if (days <= 7)  return { color: '#10b981', bg: 'rgba(16,185,129,0.1)',  label: `${days}g` };
  if (days <= 30) return { color: '#f59e0b', bg: 'rgba(245,158,11,0.1)',  label: `${days}g` };
  if (days <= 60) return { color: '#ef4444', bg: 'rgba(239,68,68,0.12)',  label: `${days}g ⚠️` };
  return              { color: '#dc2626', bg: 'rgba(220,38,38,0.18)',   label: `${days}g 🔴` };
}

export default function Cari({ db, save }: Props) {
  const { showToast } = useToast();
  const { showConfirm } = useConfirm();
  const [modalOpen, setModalOpen] = useState(false);
  const [filter, setFilter] = useState<'all' | 'musteri' | 'tedarikci'>('all');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'balance' | 'debt_days'>('name');
  const [showOnlyDebt, setShowOnlyDebt] = useState(false);
  const [form, setForm] = useState<Partial<CariType>>(empty);
  const [editId, setEditId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [islemModal, setIslemModal] = useState<{ cariId: string; cariName: string; type: 'musteri' | 'tedarikci' } | null>(null);
  const [islemForm, setIslemForm] = useState({ amount: '', kasa: 'nakit', description: '' });

  let cari = db.cari.filter(c => !c.deleted);
  if (filter !== 'all') cari = cari.filter(c => c.type === filter);
  if (showOnlyDebt) cari = cari.filter(c => c.balance > 0);
  if (search) cari = cari.filter(c => c.name.toLowerCase().includes(search.toLowerCase()) || (c.phone || '').includes(search));

  const cariWithDays = cari.map(c => ({ ...c, debtDays: calcDebtDays(c, db) }));
  const sorted = [...cariWithDays].sort((a, b) => {
    if (sortBy === 'balance') return b.balance - a.balance;
    if (sortBy === 'debt_days') return (b.debtDays ?? -1) - (a.debtDays ?? -1);
    return (a.name || '').localeCompare(b.name || '', 'tr');
  });

  const aging = {
    '0-7':   cariWithDays.filter(c => c.type === 'musteri' && c.debtDays !== null && c.debtDays <= 7),
    '8-30':  cariWithDays.filter(c => c.type === 'musteri' && c.debtDays !== null && c.debtDays > 7 && c.debtDays <= 30),
    '31-60': cariWithDays.filter(c => c.type === 'musteri' && c.debtDays !== null && c.debtDays > 30 && c.debtDays <= 60),
    '60+':   cariWithDays.filter(c => c.type === 'musteri' && c.debtDays !== null && c.debtDays > 60),
  };

  const totalReceivable = db.cari.filter(c => !c.deleted && c.type === 'musteri' && c.balance > 0).reduce((s, c) => s + c.balance, 0);
  const totalPayable = db.cari.filter(c => !c.deleted && c.type === 'tedarikci' && c.balance > 0).reduce((s, c) => s + c.balance, 0);

  const openAdd = () => { setForm({ ...empty }); setEditId(null); setModalOpen(true); };
  const openEdit = (c: CariType) => { setForm({ ...c }); setEditId(c.id); setModalOpen(true); };

  const handleSave = () => {
    const trimmedName = (form.name || '').trim();
    if (!trimmedName) { showToast('Ad gerekli!', 'error'); return; }
    const nowIso = new Date().toISOString();

    if (!editId || !isExactMatch(trimmedName, db.cari.find(c => c.id === editId)?.name || '')) {
      const aktifCari = db.cari.filter(c => !c.deleted && c.id !== editId);
      const tamEslesme = aktifCari.find(c => isExactMatch(c.name, trimmedName));
      if (tamEslesme) {
        showToast(`"${tamEslesme.name}" adında cari zaten var! Kayıt engellendi.`, 'error');
        return;
      }
      const benzer = aktifCari.find(c => similarity(c.name, trimmedName) >= 70);
      if (benzer) {
        const devamEt = window.confirm(`⚠️ "${benzer.name}" adında benzer bir cari mevcut.\nYine de kaydetmek istiyor musunuz?`);
        if (!devamEt) return;
      }
    }

    save(prev => {
      const cari = [...prev.cari];
      if (editId) {
        const i = cari.findIndex(c => c.id === editId);
        if (i >= 0) cari[i] = { ...cari[i], ...form, name: trimmedName, updatedAt: nowIso } as CariType;
        showToast('Cari güncellendi!', 'success');
      } else {
        cari.push({ id: genId(), createdAt: nowIso, updatedAt: nowIso, name: trimmedName, type: 'musteri', balance: 0, ...form } as CariType);
        showToast('Cari eklendi!', 'success');
      }
      return { ...prev, cari };
    });
    setModalOpen(false);
  };

  const handleIslem = () => {
    if (!islemModal) return;
    const amount = parseFloat(islemForm.amount);
    if (!amount || amount <= 0) { showToast('Geçerli tutar girin!', 'error'); return; }
    const nowIso = new Date().toISOString();
    const isTahsilat = islemModal.type === 'musteri'; // müşteriden tahsilat = gelir; tedarikçiye ödeme = gider
    const kasaType = isTahsilat ? 'gelir' as const : 'gider' as const;
    const category = isTahsilat ? 'tahsilat' : 'tedarik';
    const desc = islemForm.description || (isTahsilat ? `Tahsilat: ${islemModal.cariName}` : `Ödeme: ${islemModal.cariName}`);

    save(prev => {
      const kasaEntry = {
        id: genId(), type: kasaType, category, amount,
        kasa: islemForm.kasa, description: desc,
        cariId: islemModal.cariId, relatedId: islemModal.cariId,
        createdAt: nowIso, updatedAt: nowIso,
      };
      // Her iki durumda da cari bakiye azalır (alacak tahsil edildi / borç ödendi)
      const cari = prev.cari.map(c =>
        c.id === islemModal.cariId
          ? { ...c, balance: (c.balance || 0) - amount, lastTransaction: nowIso, updatedAt: nowIso }
          : c
      );

      // Ortak cari ise → kasadan çekim ortakEmanetler'e de yazılır
      const cariRec = prev.cari.find(c => c.id === islemModal.cariId);
      let ortakEmanetler = prev.ortakEmanetler || [];
      if (cariRec?.ortak && cariRec?.partnerId && kasaType === 'gider') {
        ortakEmanetler = [
          ...ortakEmanetler,
          {
            id: genId(),
            partnerId: cariRec.partnerId,
            description: desc || `Kasadan çekim: ${islemModal.cariName}`,
            amount,
            note: `Kasa: ${islemForm.kasa}`,
            type: 'emanet' as const,
            createdAt: nowIso,
            updatedAt: nowIso,
          }
        ];
      }

      return { ...prev, kasa: [...prev.kasa, kasaEntry], cari, ortakEmanetler };
    });

    showToast(isTahsilat ? `Tahsilat kaydedildi: ${formatMoney(amount)}` : `Ödeme kaydedildi: ${formatMoney(amount)}`, 'success');
    setIslemModal(null);
    setIslemForm({ amount: '', kasa: 'nakit', description: '' });
  };

  const handleDelete = (id: string) => {
    // İlişkili kayıt kontrolü
    const relatedSales = db.sales.filter(s => !s.deleted && (s.customerId === id || s.cariId === id));
    const relatedKasa = db.kasa.filter(k => !k.deleted && k.cariId === id);
    const hasRelated = relatedSales.length > 0 || relatedKasa.length > 0;
    const msg = hasRelated
      ? `Bu cariye ait ${relatedSales.length} satış ve ${relatedKasa.length} kasa kaydı var. Silinen cari gizlenecek ancak geçmiş kayıtlar korunacak.`
      : 'Bu cari kaydını silmek istediğinizden emin misiniz?';
    showConfirm('Cari Sil', msg, () => {
      const nowIso = new Date().toISOString();
      save(prev => ({ ...prev, cari: prev.cari.map(c => c.id === id ? { ...c, deleted: true, updatedAt: nowIso } : c) }));
      showToast('Cari silindi!', 'success');
    });
  };

  const detail = detailId ? db.cari.find(c => c.id === detailId) : null;
  const detailDebtDays = detail ? calcDebtDays(detail, db) : null;
  const detailKasa = detailId ? db.kasa.filter(k => !k.deleted && k.cariId === detailId).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 30) : [];
  const detailSales = detailId && detail ? db.sales.filter(s => s.cariId === detailId || s.cariName === detail.name || s.customerName === detail.name).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 20) : [];
  const detailInvoices = detailId ? (db.invoices || []).filter(inv => inv.cariId === detailId || (detail && inv.cariName === detail.name)).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 20) : [];
  const totalPaid = detailKasa.filter(k => k.type === 'gelir').reduce((s, k) => s + k.amount, 0);
  const totalPurchased = detailSales.reduce((s, s2) => s + s2.total, 0) + detailInvoices.filter(i => i.type === 'satis').reduce((s, i) => s + i.total, 0);
  const [histTab, setHistTab] = useState<'kasa' | 'satis' | 'fatura'>('kasa');

  return (
    <div>
      {/* Stat kartları */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 16 }}>
        <StatCard label="Toplam Cari" value={String(db.cari.filter(c => !c.deleted).length)} color="#3b82f6" />
        <StatCard label="Alacak" value={formatMoney(totalReceivable)} color="#10b981" sub="Müşterilerden" />
        <StatCard label="Borç" value={formatMoney(totalPayable)} color="#ef4444" sub="Tedarikçilere" />
      </div>

      {/* Alacak Yaşlandırma Bandı */}
      {(aging['8-30'].length > 0 || aging['31-60'].length > 0 || aging['60+'].length > 0) && (
        <div style={{ background: 'rgba(15,23,42,0.6)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, padding: '14px 18px', marginBottom: 16 }}>
          <div style={{ color: '#94a3b8', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 12 }}>⏱️ Alacak Yaşlandırma</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {[
              { label: '0–7 gün',   items: aging['0-7'],   color: '#10b981', bg: 'rgba(16,185,129,0.1)' },
              { label: '8–30 gün',  items: aging['8-30'],  color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
              { label: '31–60 gün', items: aging['31-60'], color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
              { label: '60+ gün',   items: aging['60+'],   color: '#dc2626', bg: 'rgba(220,38,38,0.18)' },
            ].map(bucket => (
              <div key={bucket.label} onClick={() => { setFilter('musteri'); setShowOnlyDebt(true); setSortBy('debt_days'); }}
                style={{ flex: '1 1 120px', background: bucket.bg, border: `1px solid ${bucket.color}30`, borderRadius: 10, padding: '10px 14px', cursor: 'pointer', transition: 'all 0.2s' }}>
                <div style={{ color: bucket.color, fontSize: '1.2rem', fontWeight: 900, lineHeight: 1 }}>
                  {bucket.items.length}<span style={{ fontSize: '0.72rem', fontWeight: 600, marginLeft: 4 }}>müşteri</span>
                </div>
                <div style={{ color: bucket.color, fontSize: '0.75rem', fontWeight: 700, marginTop: 3 }}>{formatMoney(bucket.items.reduce((s, c) => s + c.balance, 0))}</div>
                <div style={{ color: '#475569', fontSize: '0.65rem', marginTop: 2 }}>{bucket.label}</div>
              </div>
            ))}
          </div>
          {aging['60+'].length > 0 && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ color: '#dc2626', fontSize: '0.72rem', fontWeight: 700 }}>🔴 60+ gün bekleyen alacaklar:</div>
              {aging['60+'].slice(0, 5).map(c => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(220,38,38,0.08)', borderRadius: 8, padding: '7px 12px' }}>
                  <span style={{ color: '#f1f5f9', fontWeight: 600, fontSize: '0.85rem', flex: 1 }}>{c.name}</span>
                  {c.phone && <span style={{ color: '#64748b', fontSize: '0.78rem' }}>📞 {c.phone}</span>}
                  <span style={{ color: '#ef4444', fontWeight: 700, fontSize: '0.85rem' }}>{formatMoney(c.balance)}</span>
                  <span style={{ color: '#dc2626', fontSize: '0.72rem', fontWeight: 700, background: 'rgba(220,38,38,0.2)', borderRadius: 5, padding: '2px 7px' }}>{c.debtDays}g</span>
                  <button onClick={e => { e.stopPropagation(); setIslemModal({ cariId: c.id, cariName: c.name, type: 'musteri' }); setIslemForm({ amount: String(c.balance), kasa: 'nakit', description: '' }); }}
                    style={{ background: 'rgba(16,185,129,0.15)', border: 'none', borderRadius: 6, color: '#10b981', padding: '4px 10px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
                    💰 Tahsil Et
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={openAdd} style={{ background: '#ff5722', border: 'none', borderRadius: 10, color: '#fff', padding: '10px 20px', fontWeight: 700, cursor: 'pointer' }}>+ Yeni Cari</button>
        <button onClick={() => { exportToExcel(db, { sheets: ['cari'] }); showToast('Excel indirildi!', 'success'); }} style={{ background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)', borderRadius: 10, color: '#a78bfa', padding: '10px 16px', fontWeight: 700, cursor: 'pointer', fontSize: '0.85rem' }}>📊 Excel İndir</button>
        <button onClick={() => {
          const rows = sorted.map(c => ({ Ad: c.name, Tür: c.type === 'musteri' ? 'Müşteri' : 'Tedarikçi', Bakiye: c.balance, 'Borç Gün': c.debtDays ?? '', Telefon: c.phone || '', 'E-posta': c.email || '', 'Vergi No': c.taxNo || '', Adres: c.address || '', Not: (c as any).note || '' }));
          exportArrayToExcel(rows, 'cari-listesi');
          showToast('Ekstre indirildi!', 'success');
        }} style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 10, color: '#10b981', padding: '10px 16px', fontWeight: 700, cursor: 'pointer', fontSize: '0.85rem' }}>📥 Ekstre</button>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Ara..." style={{ flex: 1, padding: '9px 13px', background: '#1e293b', border: '1px solid #334155', borderRadius: 10, color: '#f1f5f9' }} />
        {(['all', 'musteri', 'tedarikci'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{ padding: '8px 14px', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem', background: filter === f ? '#ff5722' : '#273548', color: filter === f ? '#fff' : '#94a3b8' }}>
            {f === 'all' ? 'Tümü' : f === 'musteri' ? '👤 Müşteri' : '🏭 Tedarikçi'}
          </button>
        ))}
        <button onClick={() => setShowOnlyDebt(v => !v)} style={{ padding: '8px 14px', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem', background: showOnlyDebt ? '#ef4444' : '#273548', color: showOnlyDebt ? '#fff' : '#94a3b8' }}>
          {showOnlyDebt ? '🔴 Borçlular' : 'Borçlular'}
        </button>
        <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)}
          style={{ padding: '8px 12px', background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#94a3b8', fontSize: '0.82rem', cursor: 'pointer' }}>
          <option value="name">A–Z</option>
          <option value="balance">Bakiye ↓</option>
          <option value="debt_days">En Eski Borç</option>
        </select>
      </div>

      <div style={{ background: '#1e293b', borderRadius: 14, border: '1px solid #334155', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'rgba(15,23,42,0.6)' }}>
              {['Ad', 'Tür', 'Telefon', 'Bakiye', 'Borç Süresi', 'Son İşlem', ''].map(h => (
                <th key={h} style={{ padding: '12px 16px', textAlign: 'left', color: '#64748b', fontSize: '0.78rem', fontWeight: 600, textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>Cari bulunamadı</td></tr>
            ) : sorted.map(c => {
              const dc = debtColor(c.balance > 0 ? c.debtDays : null);
              return (
              <tr key={c.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', cursor: 'pointer' }} onClick={() => setDetailId(c.id)}>
                <td style={{ padding: '12px 16px', color: '#f1f5f9', fontWeight: 600 }}>{c.name}</td>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{ background: c.type === 'musteri' ? 'rgba(59,130,246,0.15)' : 'rgba(245,158,11,0.15)', color: c.type === 'musteri' ? '#60a5fa' : '#f59e0b', borderRadius: 6, padding: '2px 8px', fontSize: '0.8rem', fontWeight: 600 }}>
                    {c.type === 'musteri' ? '👤 Müşteri' : '🏭 Tedarikçi'}
                  </span>
                  {c.ortak && <span style={{ marginLeft: 6, background: 'rgba(168,85,247,0.15)', color: '#a78bfa', borderRadius: 6, padding: '2px 7px', fontSize: '0.75rem', fontWeight: 600 }}>🤝 Ortak</span>}
                </td>
                <td style={{ padding: '12px 16px', color: '#94a3b8' }}>{c.phone || '-'}</td>
                <td style={{ padding: '12px 16px', fontWeight: 700, color: c.balance > 0 ? (c.type === 'musteri' ? '#10b981' : '#f59e0b') : c.balance < 0 ? '#ef4444' : '#64748b' }}>
                  {formatMoney(Math.abs(c.balance))}
                  {c.balance > 0 ? (c.type === 'musteri' ? ' ↑ alacak' : ' ↑ borç') : c.balance < 0 ? ' ↓' : ''}
                </td>
                <td style={{ padding: '12px 16px' }}>
                  {c.balance > 0 && c.debtDays !== null ? (
                    <span style={{ background: dc.bg, color: dc.color, borderRadius: 6, padding: '3px 9px', fontSize: '0.78rem', fontWeight: 700 }}>{dc.label}</span>
                  ) : <span style={{ color: '#334155', fontSize: '0.78rem' }}>—</span>}
                </td>
                <td style={{ padding: '12px 16px', color: '#64748b', fontSize: '0.82rem' }}>{c.lastTransaction ? formatDate(c.lastTransaction) : '-'}</td>
                <td style={{ padding: '12px 16px' }}>
                  <div style={{ display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
                    {c.balance > 0 && (
                      <button
                        onClick={() => { setIslemModal({ cariId: c.id, cariName: c.name, type: c.type }); setIslemForm({ amount: '', kasa: 'nakit', description: '' }); }}
                        style={{ background: c.type === 'musteri' ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)', border: 'none', borderRadius: 6, color: c.type === 'musteri' ? '#10b981' : '#f59e0b', padding: '5px 10px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 700 }}>
                        {c.type === 'musteri' ? '💰 Tahsilat' : '💸 Öde'}
                      </button>
                    )}
                    <button onClick={() => openEdit(c)} style={{ background: 'rgba(59,130,246,0.1)', border: 'none', borderRadius: 6, color: '#60a5fa', padding: '5px 10px', cursor: 'pointer', fontSize: '0.82rem' }}>✏️</button>
                    <button onClick={() => handleDelete(c.id)} style={{ background: 'rgba(239,68,68,0.1)', border: 'none', borderRadius: 6, color: '#ef4444', padding: '5px 10px', cursor: 'pointer', fontSize: '0.82rem' }}>🗑️</button>
                  </div>
                </td>
              </tr>
            );
            })}
          </tbody>
        </table>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editId ? '✏️ Cari Düzenle' : '➕ Yeni Cari'}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div style={{ gridColumn: '1/-1' }}>
            <label style={lbl}>Ad *</label>
            <input value={form.name || ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={inp} />
          </div>
          <div>
            <label style={lbl}>Tür</label>
            <select value={form.type || 'musteri'} onChange={e => setForm(f => ({ ...f, type: e.target.value as 'musteri' | 'tedarikci' }))} style={inp}>
              <option value="musteri">👤 Müşteri</option>
              <option value="tedarikci">🏭 Tedarikçi</option>
            </select>
          </div>
          <div>
            <label style={lbl}>Telefon</label>
            <input value={form.phone || ''} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} style={inp} />
          </div>
          <div>
            <label style={lbl}>Vergi No</label>
            <input value={form.taxNo || ''} onChange={e => setForm(f => ({ ...f, taxNo: e.target.value }))} style={inp} />
          </div>
          <div>
            <label style={lbl}>E-posta</label>
            <input type="email" value={form.email || ''} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} style={inp} />
          </div>
          <div style={{ gridColumn: '1/-1' }}>
            <label style={lbl}>Adres</label>
            <textarea value={form.address || ''} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} style={{ ...inp, minHeight: 60 }} />
          </div>
          <div style={{ gridColumn: '1/-1' }}>
            <label style={lbl}>Not / Açıklama</label>
            <textarea value={(form as any).note || ''} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} style={{ ...inp, minHeight: 50 }} placeholder="Müşteri hakkında notlar..." />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button onClick={handleSave} style={{ flex: 1, background: '#10b981', border: 'none', borderRadius: 10, color: '#fff', padding: '11px 0', fontWeight: 700, cursor: 'pointer' }}>💾 Kaydet</button>
          <button onClick={() => setModalOpen(false)} style={{ background: '#273548', border: '1px solid #334155', borderRadius: 10, color: '#94a3b8', padding: '11px 20px', cursor: 'pointer' }}>İptal</button>
        </div>
      </Modal>

      {/* Tahsilat / Ödeme Modalı */}
      {islemModal && (
        <Modal open={!!islemModal} onClose={() => setIslemModal(null)} title={islemModal.type === 'musteri' ? `💰 Tahsilat — ${islemModal.cariName}` : `💸 Ödeme — ${islemModal.cariName}`}>
          <div style={{ display: 'grid', gap: 14 }}>
            <div>
              <label style={lbl}>Tutar (₺) *</label>
              <input type="number" inputMode="decimal" value={islemForm.amount} min={0} step={0.01} placeholder="0,00"
                onChange={e => setIslemForm(f => ({ ...f, amount: e.target.value }))} style={inp} autoFocus />
            </div>
            <div>
              <label style={lbl}>Kasa / Hesap</label>
              <select value={islemForm.kasa} onChange={e => setIslemForm(f => ({ ...f, kasa: e.target.value }))} style={inp}>
                {(db.kasalar || [{ id: 'nakit', name: 'Nakit', icon: '💵' }, { id: 'banka', name: 'Banka', icon: '🏦' }]).map(k => (
                  <option key={k.id} value={k.id}>{k.icon} {k.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={lbl}>Açıklama</label>
              <input value={islemForm.description} onChange={e => setIslemForm(f => ({ ...f, description: e.target.value }))} style={inp}
                placeholder={islemModal.type === 'musteri' ? 'Tahsilat açıklaması...' : 'Ödeme açıklaması...'} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
            <button onClick={handleIslem} style={{ flex: 1, background: islemModal.type === 'musteri' ? '#10b981' : '#f59e0b', border: 'none', borderRadius: 10, color: '#fff', padding: '11px 0', fontWeight: 700, cursor: 'pointer' }}>
              💾 {islemModal.type === 'musteri' ? 'Tahsilatı Kaydet' : 'Ödemeyi Kaydet'}
            </button>
            <button onClick={() => setIslemModal(null)} style={{ background: '#273548', border: '1px solid #334155', borderRadius: 10, color: '#94a3b8', padding: '11px 20px', cursor: 'pointer' }}>İptal</button>
          </div>
        </Modal>
      )}

      {detail && (
        <Modal open={!!detailId} onClose={() => { setDetailId(null); setHistTab('kasa'); }} title={`📋 ${detail.name}`} maxWidth={680}>
          {/* Hızlı işlem butonu */}
          {detail.balance > 0 && (
            <button
              onClick={() => { setIslemModal({ cariId: detail.id, cariName: detail.name, type: detail.type }); setIslemForm({ amount: String(detail.balance), kasa: 'nakit', description: '' }); }}
              style={{ width: '100%', marginBottom: 14, padding: '10px 0', background: detail.type === 'musteri' ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)', border: `1px solid ${detail.type === 'musteri' ? 'rgba(16,185,129,0.4)' : 'rgba(245,158,11,0.4)'}`, borderRadius: 10, color: detail.type === 'musteri' ? '#10b981' : '#f59e0b', fontWeight: 700, cursor: 'pointer', fontSize: '0.88rem' }}>
              {detail.type === 'musteri' ? `💰 Tahsilat Al — Bakiye: ${formatMoney(detail.balance)}` : `💸 Ödeme Yap — Borç: ${formatMoney(detail.balance)}`}
            </button>
          )}
          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 16 }}>
            {[
              { label: 'Bakiye', value: formatMoney(Math.abs(detail.balance)), color: detail.balance > 0 ? '#10b981' : detail.balance < 0 ? '#ef4444' : '#64748b', icon: detail.balance > 0 ? '↑' : '↓' },
              { label: 'Toplam Alışveriş', value: formatMoney(totalPurchased), color: '#3b82f6', icon: '🛒' },
              { label: 'Tahsil Edilen', value: formatMoney(totalPaid), color: '#10b981', icon: '💰' },
              { label: 'Fatura Sayısı', value: String(detailInvoices.length), color: '#8b5cf6', icon: '🧾' },
            ].map(s => (
              <div key={s.label} style={{ background: 'rgba(0,0,0,0.25)', borderRadius: 10, padding: '10px 12px', textAlign: 'center', border: `1px solid ${s.color}15` }}>
                <div style={{ fontSize: '0.85rem', marginBottom: 3 }}>{s.icon}</div>
                <div style={{ fontSize: '1.05rem', fontWeight: 800, color: s.color }}>{s.value}</div>
                <div style={{ color: '#475569', fontSize: '0.68rem', marginTop: 2, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{s.label}</div>
              </div>
            ))}
          </div>
          {/* Info Row */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            {[['Tür', detail.type === 'musteri' ? '👤 Müşteri' : '🏭 Tedarikçi'], ['Telefon', detail.phone || '-'], ['E-posta', detail.email || '-'], ['Vergi No', detail.taxNo || '-']].map(([l, v]) => (
              <div key={l} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '6px 12px', fontSize: '0.82rem' }}>
                <span style={{ color: '#475569' }}>{l}: </span><span style={{ color: '#e2e8f0', fontWeight: 600 }}>{v}</span>
              </div>
            ))}
            <button onClick={() => {
              const rows = [
                ...detailSales.map(s => ({ Tarih: formatDate(s.createdAt), İşlem: 'Satış', Tutar: s.total, Açıklama: s.productName, Ödeme: s.payment })),
                ...detailKasa.map(k => ({ Tarih: formatDate(k.createdAt), İşlem: k.type === 'gelir' ? 'Tahsilat' : 'Ödeme', Tutar: k.type === 'gelir' ? k.amount : -k.amount, Açıklama: k.description || '', Ödeme: k.kasa })),
              ].sort((a, b) => a.Tarih.localeCompare(b.Tarih));
              exportArrayToExcel(rows, `ekstre-${detail.name}`);
              showToast('Ekstre indirildi!', 'success');
            }} style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 8, color: '#10b981', padding: '6px 14px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700, marginLeft: 'auto' }}>
              📥 Ekstre İndir
            </button>
          </div>
          {(detail as any).note && (
            <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 9, padding: '9px 13px', marginBottom: 14, fontSize: '0.83rem', color: '#fcd34d' }}>
              📝 {(detail as any).note}
            </div>
          )}
          {/* History Tabs */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 12, background: 'rgba(0,0,0,0.2)', borderRadius: 10, padding: 4 }}>
            {[{ id: 'kasa' as const, label: `💰 Ödemeler (${detailKasa.length})` }, { id: 'satis' as const, label: `🛒 Satışlar (${detailSales.length})` }, { id: 'fatura' as const, label: `🧾 Faturalar (${detailInvoices.length})` }].map(t => (
              <button key={t.id} onClick={() => setHistTab(t.id)} style={{ flex: 1, padding: '7px 4px', border: 'none', borderRadius: 7, cursor: 'pointer', fontWeight: 700, fontSize: '0.78rem', background: histTab === t.id ? 'linear-gradient(135deg,#ff5722,#ff7043)' : 'transparent', color: histTab === t.id ? '#fff' : '#64748b' }}>{t.label}</button>
            ))}
          </div>
          {histTab === 'kasa' && (
            detailKasa.length === 0 ? <EmptyState /> : (
              <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem' }}>
                  <thead><tr>{['Tarih', 'Açıklama', 'Tutar', 'Hesap'].map(h => <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: '#334155', fontSize: '0.7rem', fontWeight: 700 }}>{h}</th>)}</tr></thead>
                  <tbody>
                    {detailKasa.map(k => (
                      <tr key={k.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <td style={{ padding: '8px 10px', color: '#64748b' }}>{formatDate(k.createdAt)}</td>
                        <td style={{ padding: '8px 10px', color: '#e2e8f0' }}>{k.description || '-'}</td>
                        <td style={{ padding: '8px 10px', color: k.type === 'gelir' ? '#10b981' : '#ef4444', fontWeight: 700 }}>{k.type === 'gelir' ? '+' : '-'}{formatMoney(k.amount)}</td>
                        <td style={{ padding: '8px 10px', color: '#64748b' }}>{k.kasa}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
          {histTab === 'satis' && (
            detailSales.length === 0 ? <EmptyState /> : (
              <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem' }}>
                  <thead><tr>{['Tarih', 'Ürün', 'Adet', 'Toplam', 'Ödeme'].map(h => <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: '#334155', fontSize: '0.7rem', fontWeight: 700 }}>{h}</th>)}</tr></thead>
                  <tbody>
                    {detailSales.map(s => (
                      <tr key={s.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <td style={{ padding: '8px 10px', color: '#64748b' }}>{formatDate(s.createdAt)}</td>
                        <td style={{ padding: '8px 10px', color: '#e2e8f0' }}>{s.productName || (s.items?.[0]?.productName) || '-'}</td>
                        <td style={{ padding: '8px 10px', color: '#94a3b8' }}>{s.quantity || (s.items?.reduce((a: number, i: { quantity: number }) => a + i.quantity, 0)) || '-'}</td>
                        <td style={{ padding: '8px 10px', color: '#10b981', fontWeight: 700 }}>{formatMoney(s.total)}</td>
                        <td style={{ padding: '8px 10px', color: '#64748b' }}>{s.payment}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
          {histTab === 'fatura' && (
            detailInvoices.length === 0 ? <EmptyState /> : (
              <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem' }}>
                  <thead><tr>{['No', 'Tür', 'Tarih', 'Tutar', 'Durum'].map(h => <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: '#334155', fontSize: '0.7rem', fontWeight: 700 }}>{h}</th>)}</tr></thead>
                  <tbody>
                    {detailInvoices.map(inv => (
                      <tr key={inv.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <td style={{ padding: '8px 10px', color: '#ff7043', fontFamily: 'monospace', fontWeight: 700 }}>{inv.invoiceNo}</td>
                        <td style={{ padding: '8px 10px', color: '#94a3b8' }}>{inv.type === 'satis' ? '📤 Satış' : '📥 Alış'}</td>
                        <td style={{ padding: '8px 10px', color: '#64748b' }}>{formatDate(inv.createdAt)}</td>
                        <td style={{ padding: '8px 10px', color: '#10b981', fontWeight: 700 }}>{formatMoney(inv.total)}</td>
                        <td style={{ padding: '8px 10px' }}>
                          <span style={{ background: inv.status === 'odendi' ? 'rgba(16,185,129,0.12)' : inv.status === 'onaylandi' ? 'rgba(59,130,246,0.12)' : 'rgba(245,158,11,0.12)', color: inv.status === 'odendi' ? '#10b981' : inv.status === 'onaylandi' ? '#60a5fa' : '#f59e0b', borderRadius: 5, padding: '2px 7px', fontSize: '0.72rem', fontWeight: 700 }}>{inv.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </Modal>
      )}
    </div>
  );
}

const lbl: React.CSSProperties = { display: 'block', marginBottom: 6, color: '#94a3b8', fontSize: '0.85rem', fontWeight: 500 };
const inp: React.CSSProperties = { width: '100%', padding: '10px 14px', background: 'rgba(15,23,42,0.6)', border: '1px solid #334155', borderRadius: 10, color: '#f1f5f9', fontSize: '0.9rem', boxSizing: 'border-box' };

function StatCard({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <div style={{ background: '#1e293b', borderRadius: 12, padding: '16px 18px', border: `1px solid ${color}22` }}>
      <div style={{ fontSize: '1.4rem', fontWeight: 800, color }}>{value}</div>
      <div style={{ color: '#64748b', fontSize: '0.78rem', marginTop: 4 }}>{label}</div>
      {sub && <div style={{ color: '#475569', fontSize: '0.75rem', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function EmptyState() {
  return <p style={{ color: '#334155', textAlign: 'center', padding: '20px 0', fontSize: '0.85rem' }}>Kayıt bulunamadı</p>;
}
