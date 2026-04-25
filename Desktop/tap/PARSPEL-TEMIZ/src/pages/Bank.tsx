import { useState, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/ConfirmDialog';
import { genId, formatMoney, formatDate } from '@/lib/utils-tr';
import type { DB, BankTransaction } from '@/types';

interface Props { db: DB; save: (fn: (prev: DB) => DB) => void; }

const STATUS_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  unmatched: { label: '⏳ Bekliyor', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
  matched:   { label: '🔄 Eşlendi',  color: '#60a5fa', bg: 'rgba(59,130,246,0.1)' },
  confirmed: { label: '✓ Onaylı',    color: '#10b981', bg: 'rgba(16,185,129,0.1)' },
};

function StatCard({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <div style={{ background: `linear-gradient(135deg, ${color}12, ${color}04)`, borderRadius: 14, padding: '16px 18px', border: `1px solid ${color}22` }}>
      <div style={{ fontSize: '1.35rem', fontWeight: 900, color, letterSpacing: '-0.02em' }}>{value}</div>
      {sub && <div style={{ color, fontSize: '0.75rem', fontWeight: 600, marginTop: 2 }}>{sub}</div>}
      <div style={{ color: '#475569', fontSize: '0.72rem', marginTop: 5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
    </div>
  );
}

export default function Bank({ db, save }: Props) {
  const { showToast } = useToast();
  const { showConfirm } = useConfirm();

  const [filter, setFilter] = useState<'all' | 'unmatched' | 'matched' | 'confirmed'>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'income' | 'expense'>('all');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [addModal, setAddModal] = useState(false);
  const [form, setForm] = useState({ description: '', amount: '', type: 'income' as 'income' | 'expense', date: new Date().toISOString().split('T')[0], cariId: '' });

  // ── İşlem Ekle ──────────────────────────────────────────────────────────────
  const handleAdd = () => {
    const amount = parseFloat(form.amount);
    if (!form.description.trim()) { showToast('Açıklama gerekli!', 'error'); return; }
    if (!amount || amount <= 0) { showToast('Geçerli tutar girin!', 'error'); return; }
    const nowIso = new Date().toISOString();
    const tx: BankTransaction = {
      id: genId(),
      date: new Date(form.date).toISOString(),
      description: form.description.trim(),
      amount,
      type: form.type,
      status: form.cariId ? 'matched' : 'unmatched',
      matchedCariId: form.cariId || undefined,
      matchScore: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    save(prev => ({ ...prev, bankTransactions: [...prev.bankTransactions, tx] }));
    showToast('İşlem eklendi!', 'success');
    setAddModal(false);
    setForm({ description: '', amount: '', type: 'income', date: new Date().toISOString().split('T')[0], cariId: '' });
  };

  // ── Cari Eşleştir ───────────────────────────────────────────────────────────
  const matchToAccount = (transId: string, cariId: string) => {
    save(prev => ({
      ...prev,
      bankTransactions: prev.bankTransactions.map(t =>
        t.id === transId ? { ...t, matchedCariId: cariId, status: 'matched' as const, updatedAt: new Date().toISOString() } : t
      ),
    }));
    showToast('Cari eşleştirildi!', 'success');
  };

  // ── Onayla + Kasaya Aktar ───────────────────────────────────────────────────
  const confirm = (id: string) => {
    const tx = db.bankTransactions.find(t => t.id === id);
    if (!tx) return;
    const nowIso = new Date().toISOString();
    save(prev => {
      const isGelir = tx.type === 'income' || tx.type === 'credit';
      const kasaEntry = {
        id: genId(),
        type: isGelir ? 'gelir' as const : 'gider' as const,
        category: isGelir ? 'banka_gelir' : 'banka_gider',
        amount: tx.amount,
        kasa: 'banka',
        description: `[Banka] ${tx.description}`,
        cariId: tx.matchedCariId,
        relatedId: tx.id,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      // Cari bakiye: gelir (tahsilat) → müşteri borcu azalır (balance - amount)
      //              gider (ödeme)    → tedarikçi borcu azalır (balance - amount)
      // Her iki durumda da balance - amount doğru; silme sırasında ters yönde geri alınır
      let cari = prev.cari;
      if (tx.matchedCariId) {
        const isGelirOnay = isGelir;
        cari = cari.map(c => c.id === tx.matchedCariId
          ? { ...c, balance: (c.balance || 0) + (isGelirOnay ? -tx.amount : tx.amount), lastTransaction: nowIso, updatedAt: nowIso }
          : c
        );
      }
      return {
        ...prev,
        bankTransactions: prev.bankTransactions.map(t => t.id === id ? { ...t, status: 'confirmed' as const, updatedAt: nowIso } : t),
        kasa: [...prev.kasa, kasaEntry],
        cari,
      };
    });
    showToast('Onaylandı ve kasaya aktarıldı!', 'success');
  };

  // ── Toplu Onayla ────────────────────────────────────────────────────────────
  const confirmAll = () => {
    const pending = db.bankTransactions.filter(t => t.status === 'matched');
    if (!pending.length) { showToast('Onaylanacak eşleşmiş işlem yok!', 'warning'); return; }
    showConfirm('Toplu Onayla', `${pending.length} eşleşmiş işlemi onaylayıp kasaya aktarmak istiyor musunuz?`, () => {
      const nowIso = new Date().toISOString();
      save(prev => {
        let kasa = [...prev.kasa];
        let cari = [...prev.cari];
        const updated = prev.bankTransactions.map(t => {
          if (t.status !== 'matched') return t;
          const isGelir = t.type === 'income' || t.type === 'credit';
          kasa.push({ id: genId(), type: isGelir ? 'gelir' as const : 'gider' as const, category: isGelir ? 'banka_gelir' : 'banka_gider', amount: t.amount, kasa: 'banka', description: `[Banka] ${t.description}`, cariId: t.matchedCariId, relatedId: t.id, createdAt: nowIso, updatedAt: nowIso });
          if (t.matchedCariId) {
            cari = cari.map(c => c.id === t.matchedCariId ? { ...c, balance: (c.balance || 0) + (isGelir ? -t.amount : t.amount), lastTransaction: nowIso, updatedAt: nowIso } : c);
          }
          return { ...t, status: 'confirmed' as const, updatedAt: nowIso };
        });
        return { ...prev, bankTransactions: updated, kasa, cari };
      });
      showToast(`${pending.length} işlem onaylandı ve kasaya aktarıldı!`, 'success');
    });
  };

  // ── Sil ─────────────────────────────────────────────────────────────────────
  const handleDelete = (id: string) => {
    showConfirm('İşlemi Sil', 'Bu banka işlemini silmek istiyor musunuz?', () => {
      const nowIso = new Date().toISOString();
      save(prev => {
        const tx = prev.bankTransactions.find(t => t.id === id);
        if (!tx) return prev;

        let kasa = prev.kasa;
        let cari = prev.cari;

        // Onaylı işlemse ilişkili kasa kaydını soft-delete et ve cari bakiyeyi geri al
        if (tx.status === 'confirmed') {
          kasa = kasa.map(k => k.relatedId === tx.id ? { ...k, deleted: true, updatedAt: nowIso } : k);
          if (tx.matchedCariId) {
            // Onaylarken her zaman balance - amount yapıldı, geri alırken tersini yap
            const isGelir = tx.type === 'income' || tx.type === 'credit';
            cari = cari.map(c => c.id === tx.matchedCariId
              ? { ...c, balance: (c.balance || 0) + (isGelir ? tx.amount : -tx.amount), lastTransaction: nowIso, updatedAt: nowIso }
              : c
            );
          }
        }

        return { ...prev, bankTransactions: prev.bankTransactions.filter(t => t.id !== id), kasa, cari };
      });
      showToast('Silindi!', 'success');
    });
  };

  // ── Filtrele ────────────────────────────────────────────────────────────────
  let transactions = db.bankTransactions;
  if (filter !== 'all') transactions = transactions.filter(t => t.status === filter);
  if (typeFilter !== 'all') transactions = transactions.filter(t => t.type === typeFilter || (typeFilter === 'income' && t.type === 'credit') || (typeFilter === 'expense' && t.type === 'debit'));
  if (search) transactions = transactions.filter(t => t.description.toLowerCase().includes(search.toLowerCase()));
  if (dateFrom) transactions = transactions.filter(t => t.date >= dateFrom);
  if (dateTo) transactions = transactions.filter(t => t.date <= dateTo + 'T23:59:59');
  const sorted = [...transactions].sort((a, b) => new Date(b.date || b.createdAt).getTime() - new Date(a.date || a.createdAt).getTime());

  // ── Özet istatistikler ──────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const all = db.bankTransactions;
    return {
      totalIn:   all.filter(t => t.type === 'income' || t.type === 'credit').reduce((s, t) => s + t.amount, 0),
      totalOut:  all.filter(t => t.type === 'expense' || t.type === 'debit').reduce((s, t) => s + t.amount, 0),
      unmatched: all.filter(t => t.status === 'unmatched').length,
      matched:   all.filter(t => t.status === 'matched').length,
      confirmed: all.filter(t => t.status === 'confirmed').length,
    };
  }, [db.bankTransactions]);

  const inp: React.CSSProperties = { width: '100%', padding: '10px 14px', background: 'rgba(15,23,42,0.6)', border: '1px solid #334155', borderRadius: 10, color: '#f1f5f9', fontSize: '0.9rem', boxSizing: 'border-box' };
  const lbl: React.CSSProperties = { display: 'block', marginBottom: 6, color: '#94a3b8', fontSize: '0.82rem', fontWeight: 600 };

  return (
    <div>
      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, marginBottom: 20 }}>
        <StatCard label="Toplam Gelen" value={formatMoney(stats.totalIn)} color="#10b981" />
        <StatCard label="Toplam Giden" value={formatMoney(stats.totalOut)} color="#ef4444" />
        <StatCard label="Net Bakiye" value={formatMoney(stats.totalIn - stats.totalOut)} color={stats.totalIn >= stats.totalOut ? '#3b82f6' : '#ef4444'} />
        <StatCard label="Bekliyor" value={String(stats.unmatched)} color="#f59e0b" sub={stats.unmatched > 0 ? 'Eşleştirme gerekli' : undefined} />
        <StatCard label="Eşlendi" value={String(stats.matched)} color="#60a5fa" sub={stats.matched > 0 ? 'Onay bekliyor' : undefined} />
        <StatCard label="Onaylı" value={String(stats.confirmed)} color="#10b981" />
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={() => setAddModal(true)} style={{ background: '#ff5722', border: 'none', borderRadius: 10, color: '#fff', padding: '9px 18px', fontWeight: 700, cursor: 'pointer', fontSize: '0.88rem' }}>+ İşlem Ekle</button>
        {stats.matched > 0 && (
          <button onClick={confirmAll} style={{ background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 10, color: '#10b981', padding: '9px 16px', fontWeight: 700, cursor: 'pointer', fontSize: '0.85rem' }}>
            ✓ Tümünü Onayla ({stats.matched})
          </button>
        )}
        <button onClick={() => {
          const rows = sorted.map(t => ({
            Tarih: formatDate(t.date),
            Açıklama: t.description,
            Tutar: t.amount,
            Tür: (t.type === 'income' || t.type === 'credit') ? 'Gelen' : 'Giden',
            Durum: STATUS_LABEL[t.status || 'unmatched']?.label || '',
            Cari: t.matchedCariId ? (db.cari.find(c => c.id === t.matchedCariId)?.name || '') : '',
          }));
          const ws = XLSX.utils.json_to_sheet(rows.length > 0 ? rows : [{}]);
          ws['!cols'] = [{ wch: 18 }, { wch: 35 }, { wch: 15 }, { wch: 10 }, { wch: 14 }, { wch: 20 }];
          const wb = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(wb, ws, 'Banka İşlemleri');
          XLSX.writeFile(wb, `banka-islemleri-${new Date().toISOString().slice(0, 10)}.xlsx`);
          showToast('Excel indirildi!', 'success');
        }} style={{ background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 10, color: '#818cf8', padding: '9px 14px', fontWeight: 700, cursor: 'pointer', fontSize: '0.85rem' }}>📥 Excel</button>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Ara..." style={{ flex: 1, padding: '9px 13px', background: '#1e293b', border: '1px solid #334155', borderRadius: 10, color: '#f1f5f9', minWidth: 120 }} />
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ padding: '9px 10px', background: '#1e293b', border: '1px solid #334155', borderRadius: 10, color: '#f1f5f9', fontSize: '0.85rem' }} />
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ padding: '9px 10px', background: '#1e293b', border: '1px solid #334155', borderRadius: 10, color: '#f1f5f9', fontSize: '0.85rem' }} />
        {(dateFrom || dateTo) && <button onClick={() => { setDateFrom(''); setDateTo(''); }} style={{ padding: '8px 10px', border: 'none', borderRadius: 8, background: '#334155', color: '#94a3b8', cursor: 'pointer' }}>✕</button>}
      </div>

      {/* Filtre butonları */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {(['all', 'unmatched', 'matched', 'confirmed'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{ padding: '6px 14px', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem', background: filter === f ? '#ff5722' : '#273548', color: filter === f ? '#fff' : '#94a3b8' }}>
            {f === 'all' ? `Tümü (${db.bankTransactions.length})` : f === 'unmatched' ? `⏳ Bekliyor (${stats.unmatched})` : f === 'matched' ? `🔄 Eşlendi (${stats.matched})` : `✓ Onaylı (${stats.confirmed})`}
          </button>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {(['all', 'income', 'expense'] as const).map(f => (
            <button key={f} onClick={() => setTypeFilter(f)} style={{ padding: '6px 12px', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem', background: typeFilter === f ? (f === 'income' ? 'rgba(16,185,129,0.2)' : f === 'expense' ? 'rgba(239,68,68,0.2)' : '#273548') : '#1e293b', color: typeFilter === f ? (f === 'income' ? '#10b981' : f === 'expense' ? '#ef4444' : '#f1f5f9') : '#64748b' }}>
              {f === 'all' ? 'Tümü' : f === 'income' ? '📥 Gelen' : '📤 Giden'}
            </button>
          ))}
        </div>
      </div>

      {/* Tablo */}
      <div style={{ background: '#1e293b', borderRadius: 14, border: '1px solid #334155', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', whiteSpace: 'nowrap' }}>
          <thead>
            <tr style={{ background: 'rgba(15,23,42,0.6)' }}>
              {['Tarih', 'Açıklama', 'Tutar', 'Cari Eşleşme', 'Durum', ''].map(h => (
                <th key={h} style={{ padding: '11px 14px', textAlign: 'left', color: '#64748b', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 48, color: '#334155' }}>
                <div style={{ fontSize: '2.5rem', marginBottom: 10 }}>🏦</div>
                <div>İşlem bulunamadı</div>
              </td></tr>
            ) : sorted.map(t => {
              const isGelir = t.type === 'income' || t.type === 'credit';
              const st = STATUS_LABEL[t.status || 'unmatched'];
              const matchedCari = t.matchedCariId ? db.cari.find(c => c.id === t.matchedCariId) : null;
              return (
                <tr key={t.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <td style={{ padding: '11px 14px', color: '#64748b', fontSize: '0.82rem' }}>{formatDate(t.date)}</td>
                  <td style={{ padding: '11px 14px', color: '#e2e8f0', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 28, height: 28, borderRadius: 8, background: isGelir ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.85rem', flexShrink: 0 }}>
                        {isGelir ? '📥' : '📤'}
                      </span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.description}</span>
                    </div>
                  </td>
                  <td style={{ padding: '11px 14px', fontWeight: 800, color: isGelir ? '#10b981' : '#ef4444', fontSize: '0.95rem' }}>
                    {isGelir ? '+' : '-'}{formatMoney(t.amount)}
                  </td>
                  <td style={{ padding: '11px 14px' }}>
                    {t.status === 'confirmed' ? (
                      <span style={{ color: '#10b981', fontSize: '0.85rem', fontWeight: 600 }}>{matchedCari?.name || '—'}</span>
                    ) : (
                      <select
                        value={t.matchedCariId || ''}
                        onChange={e => { if (e.target.value) matchToAccount(t.id, e.target.value); }}
                        style={{ background: '#273548', border: '1px solid #334155', borderRadius: 7, color: t.matchedCariId ? '#f1f5f9' : '#64748b', padding: '5px 9px', fontSize: '0.82rem', cursor: 'pointer' }}
                      >
                        <option value="">— Cari Seç —</option>
                        {db.cari.filter(c => !c.deleted).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    )}
                  </td>
                  <td style={{ padding: '11px 14px' }}>
                    <span style={{ background: st.bg, color: st.color, borderRadius: 7, padding: '3px 10px', fontSize: '0.8rem', fontWeight: 700 }}>{st.label}</span>
                  </td>
                  <td style={{ padding: '11px 14px' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {t.status !== 'confirmed' && (
                        <button onClick={() => confirm(t.id)} title="Onayla ve kasaya aktar" style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 7, color: '#10b981', padding: '5px 10px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700 }}>✓</button>
                      )}
                      <button onClick={() => handleDelete(t.id)} style={{ background: 'rgba(239,68,68,0.08)', border: 'none', borderRadius: 7, color: '#ef4444', padding: '5px 8px', cursor: 'pointer', fontSize: '0.85rem' }}>🗑️</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* İşlem Ekle Modalı */}
      <Modal open={addModal} onClose={() => setAddModal(false)} title="+ Banka İşlemi Ekle" maxWidth={480}>
        <div style={{ display: 'grid', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={lbl}>Tarih</label>
              <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} style={inp} />
            </div>
            <div>
              <label style={lbl}>Tür</label>
              <div style={{ display: 'flex', gap: 6 }}>
                {(['income', 'expense'] as const).map(t => (
                  <button key={t} onClick={() => setForm(f => ({ ...f, type: t }))} style={{ flex: 1, padding: '10px 0', border: 'none', borderRadius: 9, cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem', background: form.type === t ? (t === 'income' ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)') : 'rgba(255,255,255,0.05)', color: form.type === t ? (t === 'income' ? '#10b981' : '#ef4444') : '#64748b' }}>
                    {t === 'income' ? '📥 Gelen' : '📤 Giden'}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div>
            <label style={lbl}>Açıklama *</label>
            <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} style={inp} placeholder="Ödeme açıklaması..." autoFocus />
          </div>
          <div>
            <label style={lbl}>Tutar (₺) *</label>
            <input type="number" inputMode="decimal" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} style={inp} placeholder="0,00" min={0} step={0.01} />
          </div>
          <div>
            <label style={lbl}>Cari Eşleştir (opsiyonel)</label>
            <select value={form.cariId} onChange={e => setForm(f => ({ ...f, cariId: e.target.value }))} style={inp}>
              <option value="">— Seçin —</option>
              {db.cari.filter(c => !c.deleted).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={handleAdd} style={{ flex: 1, background: 'linear-gradient(135deg,#ff5722,#ff7043)', border: 'none', borderRadius: 10, color: '#fff', padding: '12px 0', fontWeight: 800, cursor: 'pointer' }}>💾 Kaydet</button>
            <button onClick={() => setAddModal(false)} style={{ background: '#273548', border: '1px solid #334155', borderRadius: 10, color: '#94a3b8', padding: '12px 18px', cursor: 'pointer' }}>İptal</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
