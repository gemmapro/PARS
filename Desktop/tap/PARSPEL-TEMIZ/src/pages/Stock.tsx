import { useState, useRef } from 'react';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { useSoundFeedback } from '@/hooks/useSoundFeedback';
import { exportToExcel } from '@/lib/excelExport';
import { genId, formatDate } from '@/lib/utils-tr';
import type { DB } from '@/types';

interface Props { db: DB; save: (fn: (prev: DB) => DB) => void; }

export default function Stock({ db, save }: Props) {
  const { showToast } = useToast();
  const { playSound } = useSoundFeedback();
  const [adjustModal, setAdjustModal] = useState(false);
  const [form, setForm] = useState({ productId: '', type: 'giris' as 'giris' | 'cikis' | 'duzeltme', amount: '', note: '' });
  const [tab, setTab] = useState<'products' | 'history'>('products');
  const [search, setSearch] = useState('');
  const [histSearch, setHistSearch] = useState('');
  const [histTypeFilter, setHistTypeFilter] = useState('');
  const [histPage, setHistPage] = useState(1);
  const HIST_PAGE_SIZE = 50;
  const movTableRef = useRef<HTMLDivElement>(null);

  let products = db.products.filter(p => !p.deleted);
  if (search) products = products.filter(p => p.name.toLowerCase().includes(search.toLowerCase()));
  const sortedProducts = [...products].sort((a, b) => a.stock - b.stock);

  let movements = db.stockMovements;
  if (histSearch) movements = movements.filter(m => m.productName.toLowerCase().includes(histSearch.toLowerCase()));
  if (histTypeFilter) movements = movements.filter(m => m.type === histTypeFilter);
  const sortedMovements = [...movements].sort((a, b) => new Date(b.date || b.id).getTime() - new Date(a.date || a.id).getTime());
  const totalHistPages = Math.ceil(sortedMovements.length / HIST_PAGE_SIZE);
  const pagedMovements = sortedMovements.slice((histPage - 1) * HIST_PAGE_SIZE, histPage * HIST_PAGE_SIZE);

  const scrollToMovTable = () => movTableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const handleAdjust = () => {
    const product = db.products.find(p => p.id === form.productId);
    if (!product) { showToast('Ürün seçin!', 'error'); return; }
    const amount = parseInt(form.amount);
    if (!amount || amount <= 0) { showToast('Geçerli miktar girin!', 'error'); return; }

    const nowIso = new Date().toISOString();
    const before = product.stock;
    const after = form.type === 'giris' ? before + amount : form.type === 'cikis' ? Math.max(0, before - amount) : amount;

    save(prev => ({
      ...prev,
      products: prev.products.map(p => p.id === form.productId ? { ...p, stock: after, updatedAt: nowIso } : p),
      stockMovements: [...prev.stockMovements, {
        id: genId(), productId: form.productId, productName: product.name,
        type: form.type, amount: form.type === 'duzeltme' ? after - before : amount,
        before, after, note: form.note, date: nowIso,
      }],
    }));

    playSound('success');
    showToast(`Stok güncellendi: ${product.name} → ${after}`, 'success');
    setForm({ productId: '', type: 'giris', amount: '', note: '' });
    setAdjustModal(false);
  };

  const activeProducts = db.products.filter(p => !p.deleted);
  const totalValue = activeProducts.reduce((s, p) => s + p.cost * p.stock, 0);
  const outOfStock = activeProducts.filter(p => p.stock === 0).length;
  const lowStock = activeProducts.filter(p => p.stock > 0 && p.stock <= p.minStock).length;

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 14, marginBottom: 20 }}>
        <StatCard label="Toplam Ürün" value={String(activeProducts.length)} color="#3b82f6" />
        <StatCard label="Stok Değeri" value={`₺${(totalValue / 1000).toFixed(1)}K`} color="#10b981" />
        <StatCard label="Biten Stok" value={String(outOfStock)} color="#ef4444" />
        <StatCard label="Az Stok" value={String(lowStock)} color="#f59e0b" />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={() => setAdjustModal(true)} style={{ background: '#ff5722', border: 'none', borderRadius: 10, color: '#fff', padding: '10px 20px', fontWeight: 700, cursor: 'pointer' }}>⚙️ Stok Ayarla</button>
        <button onClick={() => { exportToExcel(db, { sheets: ['stok'] }); showToast('Excel indirildi!', 'success'); }} style={{ background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 10, color: '#10b981', padding: '10px 16px', fontWeight: 700, cursor: 'pointer', fontSize: '0.85rem' }}>📊 Excel İndir</button>
        {(['products', 'history'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: '9px 16px', border: 'none', borderRadius: 10, cursor: 'pointer', fontWeight: 600, background: tab === t ? '#ff5722' : '#273548', color: tab === t ? '#fff' : '#94a3b8' }}>
            {t === 'products' ? '📦 Ürünler' : '📋 Hareketler'}
          </button>
        ))}
      </div>

      {tab === 'products' && (
        <>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Ürün ara..." style={{ marginBottom: 14, width: '100%', padding: '9px 13px', background: '#1e293b', border: '1px solid #334155', borderRadius: 10, color: '#f1f5f9', boxSizing: 'border-box' }} />
          <div style={{ background: '#1e293b', borderRadius: 14, border: '1px solid #334155', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'rgba(15,23,42,0.6)' }}>
                  {['Ürün', 'Kategori', 'Stok', 'Min.Stok', 'Durum', ''].map(h => (
                    <th key={h} style={{ padding: '12px 16px', textAlign: 'left', color: '#64748b', fontSize: '0.78rem', fontWeight: 600, textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedProducts.length === 0 ? (
                  <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>Ürün bulunamadı</td></tr>
                ) : sortedProducts.map(p => {
                  const stockStatus = p.stock === 0 ? { color: '#ef4444', label: '🔴 Bitti', bg: 'rgba(239,68,68,0.1)' } : p.stock <= p.minStock ? { color: '#f59e0b', label: '⚠️ Az', bg: 'rgba(245,158,11,0.1)' } : { color: '#10b981', label: '✓ Normal', bg: 'rgba(16,185,129,0.1)' };
                  const catIcon = (db.productCategories || []).find(c => c.id === p.category)?.icon || '📦';
                  const catName = (db.productCategories || []).find(c => c.id === p.category)?.name || p.category;
                  return (
                    <tr key={p.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <td style={{ padding: '12px 16px', color: '#f1f5f9', fontWeight: 600 }}>{catIcon} {p.name}</td>
                      <td style={{ padding: '12px 16px', color: '#94a3b8', fontSize: '0.85rem' }}>{catName}</td>
                      <td style={{ padding: '12px 16px', color: p.stock === 0 ? '#ef4444' : p.stock <= p.minStock ? '#f59e0b' : '#10b981', fontWeight: 700, fontSize: '1rem' }}>{p.stock}</td>
                      <td style={{ padding: '12px 16px', color: '#64748b' }}>{p.minStock}</td>
                      <td style={{ padding: '12px 16px' }}>
                        <span style={{ background: stockStatus.bg, color: stockStatus.color, borderRadius: 6, padding: '3px 10px', fontSize: '0.82rem', fontWeight: 600 }}>{stockStatus.label}</span>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <button onClick={() => { setForm(f => ({ ...f, productId: p.id })); setAdjustModal(true); }} style={{ background: 'rgba(255,87,34,0.1)', border: 'none', borderRadius: 6, color: '#ff5722', padding: '5px 10px', cursor: 'pointer', fontSize: '0.82rem' }}>⚙️ Ayarla</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'history' && (
        <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
            <input value={histSearch} onChange={e => { setHistSearch(e.target.value); setHistPage(1); }} placeholder="🔍 Ürün ara..." style={{ flex: 1, minWidth: 160, padding: '9px 13px', background: '#1e293b', border: '1px solid #334155', borderRadius: 10, color: '#f1f5f9', boxSizing: 'border-box' }} />
            <select value={histTypeFilter} onChange={e => { setHistTypeFilter(e.target.value); setHistPage(1); }} style={{ padding: '9px 13px', background: '#1e293b', border: '1px solid #334155', borderRadius: 10, color: '#f1f5f9', cursor: 'pointer' }}>
              <option value="">Tüm İşlemler</option>
              <option value="satis">🛒 Satış</option>
              <option value="iade">↩️ İade</option>
              <option value="giris">📥 Giriş</option>
              <option value="cikis">📤 Çıkış</option>
              <option value="duzeltme">⚙️ Düzeltme</option>
            </select>
          </div>
          <div ref={movTableRef} style={{ background: '#1e293b', borderRadius: 14, border: '1px solid #334155', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', whiteSpace: 'nowrap' }}>
              <thead>
                <tr style={{ background: 'rgba(15,23,42,0.6)' }}>
                  {['Tarih', 'Ürün', 'İşlem', 'Miktar', 'Önceki', 'Sonraki', 'Not'].map(h => (
                    <th key={h} style={{ padding: '12px 16px', textAlign: 'left', color: '#64748b', fontSize: '0.78rem', fontWeight: 600, textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pagedMovements.length === 0 ? (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>Hareket bulunamadı</td></tr>
                ) : pagedMovements.map(m => {
                  const typeMap: Record<string, { label: string; color: string }> = { giris: { label: '📥 Giriş', color: '#10b981' }, cikis: { label: '📤 Çıkış', color: '#ef4444' }, satis: { label: '🛒 Satış', color: '#3b82f6' }, iade: { label: '↩️ İade', color: '#8b5cf6' }, duzeltme: { label: '⚙️ Düzeltme', color: '#f59e0b' }, siparis: { label: '📦 Sipariş', color: '#8b5cf6' } };
                  const t = typeMap[m.type] || { label: m.type, color: '#94a3b8' };
                  return (
                    <tr key={m.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <td style={{ padding: '11px 16px', color: '#64748b', fontSize: '0.82rem' }}>{formatDate(m.date)}</td>
                      <td style={{ padding: '11px 16px', color: '#f1f5f9', fontWeight: 600 }}>{m.productName}</td>
                      <td style={{ padding: '11px 16px' }}><span style={{ color: t.color, fontWeight: 600, fontSize: '0.85rem' }}>{t.label}</span></td>
                      <td style={{ padding: '11px 16px', color: m.amount >= 0 ? '#10b981' : '#ef4444', fontWeight: 700 }}>{m.amount > 0 ? '+' : ''}{m.amount}</td>
                      <td style={{ padding: '11px 16px', color: '#94a3b8' }}>{m.before}</td>
                      <td style={{ padding: '11px 16px', color: '#f1f5f9', fontWeight: 600 }}>{m.after}</td>
                      <td style={{ padding: '11px 16px', color: '#64748b', fontSize: '0.82rem' }}>{m.note || '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {totalHistPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 14 }}>
              <button onClick={() => { setHistPage(p => Math.max(1, p - 1)); scrollToMovTable(); }} disabled={histPage === 1} style={{ padding: '6px 14px', background: histPage === 1 ? '#1e293b' : '#273548', border: '1px solid #334155', borderRadius: 8, color: histPage === 1 ? '#334155' : '#94a3b8', cursor: histPage === 1 ? 'default' : 'pointer', fontWeight: 600 }}>← Önceki</button>
              <span style={{ color: '#64748b', fontSize: '0.85rem' }}>Sayfa {histPage} / {totalHistPages} (toplam {sortedMovements.length} kayıt)</span>
              <button onClick={() => { setHistPage(p => Math.min(totalHistPages, p + 1)); scrollToMovTable(); }} disabled={histPage === totalHistPages} style={{ padding: '6px 14px', background: histPage === totalHistPages ? '#1e293b' : '#273548', border: '1px solid #334155', borderRadius: 8, color: histPage === totalHistPages ? '#334155' : '#94a3b8', cursor: histPage === totalHistPages ? 'default' : 'pointer', fontWeight: 600 }}>Sonraki →</button>
            </div>
          )}
        </>
      )}

      <Modal open={adjustModal} onClose={() => setAdjustModal(false)} title="⚙️ Stok Ayarla">
        <div style={{ display: 'grid', gap: 14 }}>
          <div>
            <label style={lbl}>Ürün *</label>
            <select value={form.productId} onChange={e => setForm(f => ({ ...f, productId: e.target.value }))} style={inp}>
              <option value="">-- Ürün Seç --</option>
              {activeProducts.map(p => <option key={p.id} value={p.id}>{p.name} (Stok: {p.stock})</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>İşlem Türü</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['giris', 'cikis', 'duzeltme'] as const).map(t => (
                <button key={t} onClick={() => setForm(f => ({ ...f, type: t }))} style={{ flex: 1, padding: '9px 0', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem', background: form.type === t ? '#ff5722' : '#273548', color: form.type === t ? '#fff' : '#94a3b8' }}>
                  {t === 'giris' ? '📥 Giriş' : t === 'cikis' ? '📤 Çıkış' : '⚙️ Düzeltme'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label style={lbl}>{form.type === 'duzeltme' ? 'Yeni Stok Miktarı' : 'Miktar'}</label>
            <input type="number" inputMode="decimal" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} style={inp} min={0} placeholder="0" />
          </div>
          <div>
            <label style={lbl}>Not</label>
            <input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} style={inp} placeholder="Opsiyonel not..." />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button onClick={handleAdjust} style={{ flex: 1, background: '#10b981', border: 'none', borderRadius: 10, color: '#fff', padding: '11px 0', fontWeight: 700, cursor: 'pointer' }}>💾 Kaydet</button>
          <button onClick={() => setAdjustModal(false)} style={{ background: '#273548', border: '1px solid #334155', borderRadius: 10, color: '#94a3b8', padding: '11px 20px', cursor: 'pointer' }}>İptal</button>
        </div>
      </Modal>
    </div>
  );
}

const lbl: React.CSSProperties = { display: 'block', marginBottom: 6, color: '#94a3b8', fontSize: '0.85rem', fontWeight: 500 };
const inp: React.CSSProperties = { width: '100%', padding: '10px 14px', background: 'rgba(15,23,42,0.6)', border: '1px solid #334155', borderRadius: 10, color: '#f1f5f9', fontSize: '0.9rem', boxSizing: 'border-box' };

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ background: '#1e293b', borderRadius: 12, padding: '16px 18px', border: `1px solid ${color}22` }}>
      <div style={{ fontSize: '1.4rem', fontWeight: 800, color }}>{value}</div>
      <div style={{ color: '#64748b', fontSize: '0.78rem', marginTop: 4 }}>{label}</div>
    </div>
  );
}
