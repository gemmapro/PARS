import { useState } from 'react';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/ConfirmDialog';
import { genId, formatMoney, formatDate } from '@/lib/utils-tr';
import type { DB, PeletSupplier, PeletOrder } from '@/types';

interface Props { db: DB; save: (fn: (prev: DB) => DB) => void; }

export default function Pelet({ db, save }: Props) {
  const { showToast } = useToast();
  const { showConfirm } = useConfirm();
  const [tab, setTab] = useState<'suppliers' | 'orders'>('suppliers');
  const [supModal, setSupModal] = useState(false);
  const [orderModal, setOrderModal] = useState(false);
  const [editSupId, setEditSupId] = useState<string | null>(null);
  const [supForm, setSupForm] = useState<Partial<PeletSupplier>>({ name: '', phone: '', email: '', address: '', note: '', tonPrice: 0 });
  const [orderForm, setOrderForm] = useState({ supplierId: '', qty: '', unitPrice: '', deliveryDate: '', note: '' });

  const saveSupplier = () => {
    if (!supForm.name) { showToast('Ad gerekli!', 'error'); return; }
    const nowIso = new Date().toISOString();
    save(prev => {
      const arr = [...prev.peletSuppliers];
      if (editSupId) {
        const i = arr.findIndex(s => s.id === editSupId);
        if (i >= 0) arr[i] = { ...arr[i], ...supForm, updatedAt: nowIso } as PeletSupplier;
        showToast('Güncellendi!');
      } else {
        arr.push({ id: genId(), createdAt: nowIso, updatedAt: nowIso, name: '', ...supForm } as PeletSupplier);
        showToast('Eklendi!');
      }
      return { ...prev, peletSuppliers: arr };
    });
    setSupModal(false);
  };

  const saveOrder = () => {
    if (!orderForm.supplierId) { showToast('Tedarikçi seçin!', 'error'); return; }
    const qty = parseFloat(orderForm.qty);
    const unitPrice = parseFloat(orderForm.unitPrice);
    if (!qty || !unitPrice) { showToast('Miktar ve fiyat girin!', 'error'); return; }
    const nowIso = new Date().toISOString();
    save(prev => ({
      ...prev,
      peletOrders: [...prev.peletOrders, {
        id: genId(), supplierId: orderForm.supplierId, qty, unitPrice, totalAmount: qty * unitPrice,
        deliveryDate: orderForm.deliveryDate, note: orderForm.note, status: 'bekliyor', createdAt: nowIso, updatedAt: nowIso,
      }],
    }));
    showToast('Sipariş oluşturuldu!');
    setOrderForm({ supplierId: '', qty: '', unitPrice: '', deliveryDate: '', note: '' });
    setOrderModal(false);
  };

  const deleteSupplier = (id: string) => {
    showConfirm('Sil', 'Emin misiniz?', () => {
      save(prev => ({ ...prev, peletSuppliers: prev.peletSuppliers.filter(s => s.id !== id) }));
      showToast('Silindi!');
    });
  };

  const updateOrderStatus = (id: string, status: PeletOrder['status']) => {
    save(prev => ({ ...prev, peletOrders: prev.peletOrders.map(o => o.id === id ? { ...o, status, updatedAt: new Date().toISOString() } : o) }));
  };

  const pellet = db.pelletSettings || { gramaj: 14, kgFiyat: 6.5, cuvalKg: 15, critDays: 3 };
  const statusColor: Record<string, string> = { bekliyor: '#f59e0b', yolda: '#3b82f6', tamamlandi: '#10b981', iptal: '#ef4444' };
  const statusLabel: Record<string, string> = { bekliyor: '⏳ Bekliyor', yolda: '🚚 Yolda', tamamlandi: '✓ Tamamlandı', iptal: '✕ İptal' };

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 14, marginBottom: 20 }}>
        <div style={{ background: '#1e293b', borderRadius: 12, padding: 18, border: '1px solid #334155' }}>
          <div style={{ color: '#64748b', fontSize: '0.78rem' }}>🪵 Saatlik Maliyet</div>
          <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#ff5722', marginTop: 4 }}>₺{((pellet.gramaj / 1000) * pellet.kgFiyat).toFixed(4)}</div>
          <div style={{ color: '#475569', fontSize: '0.75rem', marginTop: 2 }}>{pellet.gramaj}g/saat × ₺{pellet.kgFiyat}/kg</div>
        </div>
        <div style={{ background: '#1e293b', borderRadius: 12, padding: 18, border: '1px solid #334155' }}>
          <div style={{ color: '#64748b', fontSize: '0.78rem' }}>📦 Çuval Fiyatı</div>
          <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#10b981', marginTop: 4 }}>{formatMoney(pellet.cuvalKg * pellet.kgFiyat)}</div>
          <div style={{ color: '#475569', fontSize: '0.75rem', marginTop: 2 }}>{pellet.cuvalKg}kg × ₺{pellet.kgFiyat}</div>
        </div>
        <div style={{ background: '#1e293b', borderRadius: 12, padding: 18, border: '1px solid #334155' }}>
          <div style={{ color: '#64748b', fontSize: '0.78rem' }}>🏭 Tedarikçi Sayısı</div>
          <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#3b82f6', marginTop: 4 }}>{db.peletSuppliers.length}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['suppliers', 'orders'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: '9px 18px', border: 'none', borderRadius: 10, cursor: 'pointer', fontWeight: 700, background: tab === t ? '#ff5722' : '#273548', color: tab === t ? '#fff' : '#94a3b8' }}>
            {t === 'suppliers' ? '🏭 Tedarikçiler' : '📦 Siparişler'}
          </button>
        ))}
        <button onClick={() => { setSupForm({ name: '', phone: '', email: '', address: '', note: '', tonPrice: 0 }); setEditSupId(null); setSupModal(true); }} style={{ marginLeft: 'auto', background: 'rgba(255,87,34,0.1)', border: '1px solid rgba(255,87,34,0.2)', borderRadius: 10, color: '#ff5722', padding: '9px 16px', cursor: 'pointer', fontWeight: 600 }}>+ Tedarikçi</button>
        <button onClick={() => setOrderModal(true)} style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: 10, color: '#60a5fa', padding: '9px 16px', cursor: 'pointer', fontWeight: 600 }}>+ Sipariş</button>
      </div>

      {tab === 'suppliers' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px,1fr))', gap: 14 }}>
          {db.peletSuppliers.length === 0 ? (
            <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: 48, color: '#64748b' }}>Tedarikçi eklenmedi</div>
          ) : db.peletSuppliers.map(s => (
            <div key={s.id} style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #334155', padding: 18 }}>
              <h4 style={{ fontWeight: 700, color: '#f1f5f9', marginBottom: 6 }}>🪵 {s.name}</h4>
              {s.phone && <p style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: 4 }}>📞 {s.phone}</p>}
              {s.tonPrice && <p style={{ color: '#10b981', fontSize: '0.88rem', fontWeight: 700, marginBottom: 4 }}>₺{s.tonPrice}/ton</p>}
              {s.note && <p style={{ color: '#64748b', fontSize: '0.8rem' }}>{s.note}</p>}
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button onClick={() => { setSupForm({ ...s }); setEditSupId(s.id); setSupModal(true); }} style={{ flex: 1, background: 'rgba(59,130,246,0.1)', border: 'none', borderRadius: 8, color: '#60a5fa', padding: '7px 0', cursor: 'pointer', fontSize: '0.82rem' }}>✏️ Düzenle</button>
                <button onClick={() => deleteSupplier(s.id)} style={{ background: 'rgba(239,68,68,0.1)', border: 'none', borderRadius: 8, color: '#ef4444', padding: '7px 10px', cursor: 'pointer' }}>🗑️</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'orders' && (
        <div style={{ background: '#1e293b', borderRadius: 14, border: '1px solid #334155', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', whiteSpace: 'nowrap' }}>
            <thead>
              <tr style={{ background: 'rgba(15,23,42,0.6)' }}>
                {['Tarih', 'Tedarikçi', 'Miktar (ton)', 'Birim Fiyat', 'Toplam', 'Durum', ''].map(h => (
                  <th key={h} style={{ padding: '12px 16px', textAlign: 'left', color: '#64748b', fontSize: '0.78rem', fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {db.peletOrders.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>Sipariş bulunamadı</td></tr>
              ) : [...db.peletOrders].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map(o => (
                <tr key={o.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <td style={{ padding: '12px 16px', color: '#64748b', fontSize: '0.82rem' }}>{formatDate(o.createdAt)}</td>
                  <td style={{ padding: '12px 16px', color: '#f1f5f9', fontWeight: 600 }}>{db.peletSuppliers.find(s => s.id === o.supplierId)?.name || '-'}</td>
                  <td style={{ padding: '12px 16px', color: '#94a3b8' }}>{o.qty} ton</td>
                  <td style={{ padding: '12px 16px', color: '#94a3b8' }}>₺{o.unitPrice}/ton</td>
                  <td style={{ padding: '12px 16px', color: '#10b981', fontWeight: 700 }}>{formatMoney(o.totalAmount)}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ background: `${statusColor[o.status]}22`, color: statusColor[o.status], borderRadius: 6, padding: '2px 8px', fontSize: '0.8rem', fontWeight: 600 }}>{statusLabel[o.status]}</span>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    {o.status !== 'tamamlandi' && o.status !== 'iptal' && (
                      <button onClick={() => updateOrderStatus(o.id, 'tamamlandi')} style={{ background: 'rgba(16,185,129,0.1)', border: 'none', borderRadius: 6, color: '#10b981', padding: '4px 8px', cursor: 'pointer', fontSize: '0.8rem' }}>✓ Tamamla</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={supModal} onClose={() => setSupModal(false)} title={editSupId ? '✏️ Tedarikçi Düzenle' : '➕ Yeni Pelet Tedarikçisi'}>
        <div style={{ display: 'grid', gap: 14 }}>
          <div><label style={lbl}>Ad *</label><input value={supForm.name || ''} onChange={e => setSupForm(f => ({ ...f, name: e.target.value }))} style={inp} /></div>
          <div><label style={lbl}>Telefon</label><input value={supForm.phone || ''} onChange={e => setSupForm(f => ({ ...f, phone: e.target.value }))} style={inp} /></div>
          <div><label style={lbl}>Ton Fiyatı (₺)</label><input type="number" inputMode="decimal" value={supForm.tonPrice || ''} onChange={e => setSupForm(f => ({ ...f, tonPrice: parseFloat(e.target.value) || 0 }))} style={inp} step={0.01} /></div>
          <div><label style={lbl}>Not</label><textarea value={supForm.note || ''} onChange={e => setSupForm(f => ({ ...f, note: e.target.value }))} style={{ ...inp, minHeight: 60 }} /></div>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button onClick={saveSupplier} style={{ flex: 1, background: '#10b981', border: 'none', borderRadius: 10, color: '#fff', padding: '11px 0', fontWeight: 700, cursor: 'pointer' }}>💾 Kaydet</button>
          <button onClick={() => setSupModal(false)} style={{ background: '#273548', border: '1px solid #334155', borderRadius: 10, color: '#94a3b8', padding: '11px 20px', cursor: 'pointer' }}>İptal</button>
        </div>
      </Modal>

      <Modal open={orderModal} onClose={() => setOrderModal(false)} title="📦 Pelet Sipariş Ver">
        <div style={{ display: 'grid', gap: 14 }}>
          <div>
            <label style={lbl}>Tedarikçi *</label>
            <select value={orderForm.supplierId} onChange={e => setOrderForm(f => ({ ...f, supplierId: e.target.value }))} style={inp}>
              <option value="">-- Seçin --</option>
              {db.peletSuppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div><label style={lbl}>Miktar (ton)</label><input type="number" inputMode="decimal" value={orderForm.qty} onChange={e => setOrderForm(f => ({ ...f, qty: e.target.value }))} style={inp} step={0.1} /></div>
            <div><label style={lbl}>Birim Fiyat (₺/ton)</label><input type="number" inputMode="decimal" value={orderForm.unitPrice} onChange={e => setOrderForm(f => ({ ...f, unitPrice: e.target.value }))} style={inp} step={0.01} /></div>
          </div>
          <div><label style={lbl}>Teslim Tarihi</label><input type="date" value={orderForm.deliveryDate} onChange={e => setOrderForm(f => ({ ...f, deliveryDate: e.target.value }))} style={inp} /></div>
          <div><label style={lbl}>Not</label><textarea value={orderForm.note} onChange={e => setOrderForm(f => ({ ...f, note: e.target.value }))} style={{ ...inp, minHeight: 50 }} /></div>
          {orderForm.qty && orderForm.unitPrice && (
            <div style={{ background: '#0f172a', borderRadius: 8, padding: '10px 14px' }}>
              <span style={{ color: '#94a3b8' }}>Toplam: </span>
              <strong style={{ color: '#10b981' }}>{formatMoney(parseFloat(orderForm.qty) * parseFloat(orderForm.unitPrice))}</strong>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button onClick={saveOrder} style={{ flex: 1, background: '#ff5722', border: 'none', borderRadius: 10, color: '#fff', padding: '11px 0', fontWeight: 700, cursor: 'pointer' }}>📦 Sipariş Ver</button>
          <button onClick={() => setOrderModal(false)} style={{ background: '#273548', border: '1px solid #334155', borderRadius: 10, color: '#94a3b8', padding: '11px 20px', cursor: 'pointer' }}>İptal</button>
        </div>
      </Modal>
    </div>
  );
}

const lbl: React.CSSProperties = { display: 'block', marginBottom: 6, color: '#94a3b8', fontSize: '0.85rem', fontWeight: 500 };
const inp: React.CSSProperties = { width: '100%', padding: '10px 14px', background: 'rgba(15,23,42,0.6)', border: '1px solid #334155', borderRadius: 10, color: '#f1f5f9', fontSize: '0.9rem', boxSizing: 'border-box' };
