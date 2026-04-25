import { useState } from 'react';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/ConfirmDialog';
import { genId, formatMoney, formatDate } from '@/lib/utils-tr';
import type { DB, BoruSupplier, BoruOrder } from '@/types';

interface Props { db: DB; save: (fn: (prev: DB) => DB) => void; }

export default function BoruTed({ db, save }: Props) {
  const { showToast } = useToast();
  const { showConfirm } = useConfirm();
  const [tab, setTab] = useState<'suppliers' | 'orders'>('suppliers');
  const [supModal, setSupModal] = useState(false);
  const [orderModal, setOrderModal] = useState(false);
  const [editSupId, setEditSupId] = useState<string | null>(null);
  const [supForm, setSupForm] = useState<Partial<BoruSupplier>>({ name: '', type: '', phone: '', email: '', address: '', note: '' });
  const [orderForm, setOrderForm] = useState({ supplierId: '', items: '', amount: '', deliveryDate: '', note: '' });

  const saveSupplier = () => {
    if (!supForm.name) { showToast('Ad gerekli!', 'error'); return; }
    const nowIso = new Date().toISOString();
    save(prev => {
      const arr = [...prev.boruSuppliers];
      if (editSupId) {
        const i = arr.findIndex(s => s.id === editSupId);
        if (i >= 0) arr[i] = { ...arr[i], ...supForm, updatedAt: nowIso } as BoruSupplier;
        showToast('Güncellendi!');
      } else {
        arr.push({ id: genId(), createdAt: nowIso, updatedAt: nowIso, name: '', phone: '', ...supForm } as BoruSupplier);
        showToast('Tedarikçi eklendi!');
      }
      return { ...prev, boruSuppliers: arr };
    });
    setSupModal(false);
  };

  const saveOrder = () => {
    if (!orderForm.supplierId || !orderForm.amount) { showToast('Tedarikçi ve tutar zorunlu!', 'error'); return; }
    const nowIso = new Date().toISOString();
    save(prev => ({
      ...prev,
      boruOrders: [...prev.boruOrders, {
        id: genId(), supplierId: orderForm.supplierId, items: orderForm.items, amount: parseFloat(orderForm.amount) || 0,
        deliveryDate: orderForm.deliveryDate, note: orderForm.note, status: 'bekliyor', createdAt: nowIso, updatedAt: nowIso,
      }],
    }));
    showToast('Sipariş oluşturuldu!');
    setOrderForm({ supplierId: '', items: '', amount: '', deliveryDate: '', note: '' });
    setOrderModal(false);
  };

  const deleteSupplier = (id: string) => {
    showConfirm('Sil', 'Emin misiniz?', () => {
      save(prev => ({ ...prev, boruSuppliers: prev.boruSuppliers.filter(s => s.id !== id) }));
      showToast('Silindi!');
    });
  };

  const updateStatus = (id: string, status: BoruOrder['status']) => {
    save(prev => ({ ...prev, boruOrders: prev.boruOrders.map(o => o.id === id ? { ...o, status, updatedAt: new Date().toISOString() } : o) }));
    showToast('Durum güncellendi!');
  };

  const statusColor: Record<string, string> = { bekliyor: '#f59e0b', yolda: '#3b82f6', tamamlandi: '#10b981', iptal: '#ef4444' };
  const statusLabel: Record<string, string> = { bekliyor: '⏳ Bekliyor', yolda: '🚚 Yolda', tamamlandi: '✓ Tamamlandı', iptal: '✕ İptal' };

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 14, marginBottom: 20 }}>
        {[
          { label: 'Tedarikçi', value: String(db.boruSuppliers.length), color: '#3b82f6' },
          { label: 'Toplam Sipariş', value: String(db.boruOrders.length), color: '#10b981' },
          { label: 'Bekl. Sipariş', value: String(db.boruOrders.filter(o => o.status === 'bekliyor').length), color: '#f59e0b' },
        ].map(s => (
          <div key={s.label} style={{ background: `linear-gradient(135deg, ${s.color}15, ${s.color}06)`, borderRadius: 14, padding: '18px 20px', border: `1px solid ${s.color}22` }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 900, color: s.color }}>{s.value}</div>
            <div style={{ color: '#64748b', fontSize: '0.78rem', marginTop: 4 }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        {(['suppliers', 'orders'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: '9px 18px', border: 'none', borderRadius: 10, cursor: 'pointer', fontWeight: 700, background: tab === t ? '#ff5722' : '#1e293b', color: tab === t ? '#fff' : '#64748b' }}>
            {t === 'suppliers' ? '🔩 Tedarikçiler' : '📦 Siparişler'}
          </button>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={() => { setSupForm({ name: '', type: '', phone: '', email: '', address: '', note: '' }); setEditSupId(null); setSupModal(true); }} style={{ background: 'rgba(255,87,34,0.1)', border: '1px solid rgba(255,87,34,0.2)', borderRadius: 10, color: '#ff7043', padding: '9px 16px', cursor: 'pointer', fontWeight: 600 }}>+ Tedarikçi</button>
          <button onClick={() => setOrderModal(true)} style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: 10, color: '#60a5fa', padding: '9px 16px', cursor: 'pointer', fontWeight: 600 }}>+ Sipariş</button>
        </div>
      </div>

      {tab === 'suppliers' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px,1fr))', gap: 14 }}>
          {db.boruSuppliers.length === 0 ? (
            <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: 48, color: '#334155' }}>
              <div style={{ fontSize: '3rem', marginBottom: 12 }}>🔩</div><p>Boru tedarikçisi eklenmedi</p>
            </div>
          ) : db.boruSuppliers.map(s => (
            <div key={s.id} style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))', borderRadius: 14, border: '1px solid rgba(255,255,255,0.07)', padding: 18 }}>
              <h4 style={{ fontWeight: 700, color: '#f1f5f9', marginBottom: 4 }}>🔩 {s.name}</h4>
              {s.type && <p style={{ color: '#f59e0b', fontSize: '0.82rem', marginBottom: 6 }}>{s.type}</p>}
              {s.phone && <p style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: 4 }}>📞 {s.phone}</p>}
              {s.email && <p style={{ color: '#94a3b8', fontSize: '0.82rem', marginBottom: 4 }}>📧 {s.email}</p>}
              {s.note && <p style={{ color: '#64748b', fontSize: '0.8rem', marginTop: 6 }}>{s.note}</p>}
              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                <button onClick={() => { setSupForm({ ...s }); setEditSupId(s.id); setSupModal(true); }} style={{ flex: 1, background: 'rgba(59,130,246,0.1)', border: 'none', borderRadius: 8, color: '#60a5fa', padding: '7px 0', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600 }}>✏️ Düzenle</button>
                <button onClick={() => deleteSupplier(s.id)} style={{ background: 'rgba(239,68,68,0.1)', border: 'none', borderRadius: 8, color: '#ef4444', padding: '7px 10px', cursor: 'pointer' }}>🗑️</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'orders' && (
        <div style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))', borderRadius: 14, border: '1px solid rgba(255,255,255,0.07)', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', whiteSpace: 'nowrap' }}>
            <thead>
              <tr style={{ background: 'rgba(0,0,0,0.3)' }}>
                {['Tarih', 'Tedarikçi', 'Malzemeler', 'Tutar', 'Durum', ''].map(h => (
                  <th key={h} style={{ padding: '12px 16px', textAlign: 'left', color: '#334155', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {db.boruOrders.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40, color: '#334155' }}>Sipariş bulunamadı</td></tr>
              ) : [...db.boruOrders].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map(o => (
                <tr key={o.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                  <td style={{ padding: '12px 16px', color: '#475569', fontSize: '0.82rem' }}>{formatDate(o.createdAt)}</td>
                  <td style={{ padding: '12px 16px', color: '#f1f5f9', fontWeight: 600 }}>{db.boruSuppliers.find(s => s.id === o.supplierId)?.name || '-'}</td>
                  <td style={{ padding: '12px 16px', color: '#94a3b8', fontSize: '0.85rem', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.items || '-'}</td>
                  <td style={{ padding: '12px 16px', color: '#10b981', fontWeight: 700 }}>{formatMoney(o.amount)}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ background: `${statusColor[o.status]}18`, color: statusColor[o.status], borderRadius: 6, padding: '2px 8px', fontSize: '0.8rem', fontWeight: 600 }}>{statusLabel[o.status]}</span>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    {o.status !== 'tamamlandi' && o.status !== 'iptal' && (
                      <button onClick={() => updateStatus(o.id, 'tamamlandi')} style={{ background: 'rgba(16,185,129,0.1)', border: 'none', borderRadius: 6, color: '#10b981', padding: '4px 8px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600 }}>✓ Tamamla</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={supModal} onClose={() => setSupModal(false)} title={editSupId ? '✏️ Tedarikçi Düzenle' : '➕ Boru Tedarikçisi Ekle'}>
        <div style={{ display: 'grid', gap: 14 }}>
          <FV label="Ad *" value={supForm.name || ''} onChange={v => setSupForm(f => ({ ...f, name: v }))} />
          <FV label="Tür" value={supForm.type || ''} onChange={v => setSupForm(f => ({ ...f, type: v }))} placeholder="Örn: Çelik Boru, PVC..." />
          <FV label="Telefon" value={supForm.phone || ''} onChange={v => setSupForm(f => ({ ...f, phone: v }))} />
          <FV label="E-posta" type="email" value={supForm.email || ''} onChange={v => setSupForm(f => ({ ...f, email: v }))} />
          <div><label style={lbl}>Not</label><textarea value={supForm.note || ''} onChange={e => setSupForm(f => ({ ...f, note: e.target.value }))} style={{ ...inp, minHeight: 60 }} /></div>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button onClick={saveSupplier} style={btnPrimary}>💾 Kaydet</button>
          <button onClick={() => setSupModal(false)} style={btnSecondary}>İptal</button>
        </div>
      </Modal>

      <Modal open={orderModal} onClose={() => setOrderModal(false)} title="📦 Boru Siparişi Ver">
        <div style={{ display: 'grid', gap: 14 }}>
          <div>
            <label style={lbl}>Tedarikçi *</label>
            <select value={orderForm.supplierId} onChange={e => setOrderForm(f => ({ ...f, supplierId: e.target.value }))} style={inp}>
              <option value="">-- Seçin --</option>
              {db.boruSuppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div><label style={lbl}>Malzeme Listesi</label><textarea value={orderForm.items} onChange={e => setOrderForm(f => ({ ...f, items: e.target.value }))} style={{ ...inp, minHeight: 60 }} placeholder="Örn: DN100 10mt, DN80 5mt..." /></div>
          <FV label="Toplam Tutar (₺) *" type="number" inputMode="decimal" value={orderForm.amount} onChange={v => setOrderForm(f => ({ ...f, amount: v }))} />
          <FV label="Teslim Tarihi" type="date" value={orderForm.deliveryDate} onChange={v => setOrderForm(f => ({ ...f, deliveryDate: v }))} />
          <div><label style={lbl}>Not</label><textarea value={orderForm.note} onChange={e => setOrderForm(f => ({ ...f, note: e.target.value }))} style={{ ...inp, minHeight: 50 }} /></div>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button onClick={saveOrder} style={btnPrimary}>📦 Sipariş Ver</button>
          <button onClick={() => setOrderModal(false)} style={btnSecondary}>İptal</button>
        </div>
      </Modal>
    </div>
  );
}

const lbl: React.CSSProperties = { display: 'block', marginBottom: 6, color: '#64748b', fontSize: '0.82rem', fontWeight: 600 };
const inp: React.CSSProperties = { width: '100%', padding: '10px 14px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, color: '#f1f5f9', fontSize: '0.9rem', boxSizing: 'border-box' };
const btnPrimary: React.CSSProperties = { flex: 1, background: 'linear-gradient(135deg, #ff5722, #ff7043)', border: 'none', borderRadius: 10, color: '#fff', padding: '11px 0', fontWeight: 700, cursor: 'pointer', fontSize: '0.95rem' };
const btnSecondary: React.CSSProperties = { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, color: '#64748b', padding: '11px 20px', cursor: 'pointer' };

function FV({ label, value, onChange, type = 'text', placeholder, inputMode }: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'] }) {
  return (
    <div>
      <label style={lbl}>{label}</label>
      <input type={type} inputMode={inputMode} value={value} onChange={e => onChange(e.target.value)} style={inp} placeholder={placeholder} />
    </div>
  );
}
