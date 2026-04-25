import { useState, useMemo } from 'react';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/ConfirmDialog';
import { genId, formatMoney, formatDate } from '@/lib/utils-tr';
import type { DB, Invoice, InvoiceItem, Installment } from '@/types';

function createInstallmentPlan(
  invoiceId: string, total: number, count: number, firstDueDate: Date
): Installment[] {
  const base = Math.floor((total / count) * 100) / 100;
  const last = Math.round((total - base * (count - 1)) * 100) / 100;
  const nowIso = new Date().toISOString();
  return Array.from({ length: count }, (_, i) => ({
    id: crypto.randomUUID ? crypto.randomUUID() : `inst-${Date.now()}-${i}`,
    invoiceId,
    dueDate: new Date(firstDueDate.getFullYear(), firstDueDate.getMonth() + i, firstDueDate.getDate()).toISOString(),
    amount: i === count - 1 ? last : base,
    paid: false,
    paidAt: undefined,
    createdAt: nowIso,
    updatedAt: nowIso,
  }));
}

interface Props { db: DB; save: (fn: (prev: DB) => DB) => void; }

const emptyItem = (): InvoiceItem => ({ description: '', quantity: 1, unitPrice: 0, vatRate: 20, total: 0 });

function nextInvoiceNo(invoices: Invoice[], type: 'satis' | 'alis') {
  const prefix = type === 'satis' ? 'SFT' : 'AFT';
  const year = new Date().getFullYear();
  const existing = invoices.filter(i => i.invoiceNo.startsWith(`${prefix}-${year}`));
  const maxNum = existing.reduce((mx, i) => {
    const n = parseInt(i.invoiceNo.split('-')[2]) || 0;
    return n > mx ? n : mx;
  }, 0);
  return `${prefix}-${year}-${String(maxNum + 1).padStart(4, '0')}`;
}

const statusColors: Record<string, string> = { taslak: '#f59e0b', onaylandi: '#3b82f6', odendi: '#10b981', iptal: '#ef4444' };
const statusLabels: Record<string, string> = { taslak: '📝 Taslak', onaylandi: '✅ Onaylandı', odendi: '💰 Ödendi', iptal: '❌ İptal' };
const paymentLabels: Record<string, string> = { nakit: 'Nakit', kart: 'Kredi Kartı', havale: 'Havale/EFT', cari: 'Cari', cek: 'Çek' };

export default function Fatura({ db, save }: Props) {
  const { showToast } = useToast();
  const { showConfirm } = useConfirm();
  const [modal, setModal] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'satis' | 'alis'>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  const [form, setForm] = useState({
    type: 'satis' as 'satis' | 'alis',
    cariId: '', cariName: '', cariTaxNo: '', cariAddress: '',
    items: [emptyItem()] as InvoiceItem[],
    discount: 0,
    payment: 'nakit' as Invoice['payment'],
    dueDate: '', note: '',
    status: 'taslak' as Invoice['status'],
    saleId: '',
  });

  // Taksit planı state
  const [instForm, setInstForm] = useState({ count: 3, firstDueDate: new Date().toISOString().slice(0, 10) });
  const [showInstForm, setShowInstForm] = useState(false);

  const invoices = useMemo(() => {
    let list = (db.invoices || []).filter(i => !i.deleted);
    if (filter !== 'all') list = list.filter(i => i.type === filter);
    if (statusFilter !== 'all') list = list.filter(i => i.status === statusFilter);
    if (search) { const q = search.toLowerCase(); list = list.filter(i => i.invoiceNo.toLowerCase().includes(q) || i.cariName.toLowerCase().includes(q)); }
    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [db.invoices, filter, statusFilter, search]);

  const stats = useMemo(() => {
    const all = (db.invoices || []).filter(i => !i.deleted);
    const satisTotal = all.filter(i => i.type === 'satis' && i.status !== 'iptal').reduce((s, i) => s + i.total, 0);
    const alisTotal = all.filter(i => i.type === 'alis' && i.status !== 'iptal').reduce((s, i) => s + i.total, 0);
    const unpaid = all.filter(i => i.status === 'onaylandi').reduce((s, i) => s + i.total, 0);
    const draft = all.filter(i => i.status === 'taslak').length;
    return { satisTotal, alisTotal, unpaid, draft, total: all.length };
  }, [db.invoices]);

  const calcTotals = (items: InvoiceItem[], discount: number) => {
    const subtotal = items.reduce((s, it) => s + (it.quantity * it.unitPrice), 0);
    const vatTotal = items.reduce((s, it) => s + (it.quantity * it.unitPrice * it.vatRate / 100), 0);
    return { subtotal, vatTotal, total: subtotal + vatTotal - discount };
  };

  const updateItem = (idx: number, field: keyof InvoiceItem, value: string | number) => {
    setForm(f => {
      const items = [...f.items];
      items[idx] = { ...items[idx], [field]: value };
      items[idx].total = items[idx].quantity * items[idx].unitPrice * (1 + items[idx].vatRate / 100);
      return { ...f, items };
    });
  };

  const addItem = () => setForm(f => ({ ...f, items: [...f.items, emptyItem()] }));
  const removeItem = (idx: number) => setForm(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));

  const openNew = (type: 'satis' | 'alis') => {
    setForm({ type, cariId: '', cariName: '', cariTaxNo: '', cariAddress: '', items: [emptyItem()], discount: 0, payment: 'nakit', dueDate: '', note: '', status: 'taslak', saleId: '' });
    setEditId(null);
    setModal(true);
  };

  const openEdit = (inv: Invoice) => {
    setForm({ type: inv.type, cariId: inv.cariId || '', cariName: inv.cariName, cariTaxNo: inv.cariTaxNo || '', cariAddress: inv.cariAddress || '', items: [...inv.items], discount: inv.discount, payment: inv.payment, dueDate: inv.dueDate || '', note: inv.note || '', status: inv.status, saleId: inv.saleId || '' });
    setEditId(inv.id);
    setModal(true);
  };

  const handleSave = () => {
    if (!form.cariName) { showToast('Müşteri/Tedarikçi adı gerekli!', 'error'); return; }
    if (form.items.length === 0 || form.items.every(it => !it.description)) { showToast('En az bir kalem ekleyin!', 'error'); return; }
    const validItems = form.items.filter(it => it.description);
    const { subtotal, vatTotal, total } = calcTotals(validItems, form.discount);
    const nowIso = new Date().toISOString();

    save(prev => {
      const invoices = [...(prev.invoices || [])];
      if (editId) {
        const i = invoices.findIndex(inv => inv.id === editId);
        if (i >= 0) {
          // Mevcut kasaEntryId ve cariUpdated'ı koru (durum geçişlerinde kullanılıyor)
          const { kasaEntryId, cariUpdated } = invoices[i];
          invoices[i] = { ...invoices[i], ...form, items: validItems, subtotal, vatTotal, total, kasaEntryId, cariUpdated, updatedAt: nowIso };
        }
        showToast('Fatura güncellendi!');
      } else {
        invoices.push({ id: genId(), invoiceNo: nextInvoiceNo(invoices, form.type), ...form, items: validItems, subtotal, vatTotal, total, createdAt: nowIso, updatedAt: nowIso });
        showToast('Fatura oluşturuldu!');
      }
      return { ...prev, invoices };
    });
    setModal(false);
  };

  const updateStatus = (id: string, status: Invoice['status']) => {
    save(prev => {
      const nowIso = new Date().toISOString();
      const inv = (prev.invoices || []).find(i => i.id === id);
      if (!inv) return prev;

      let kasa = [...prev.kasa];
      let cari = [...prev.cari];
      let kasaEntryId = inv.kasaEntryId;
      let cariUpdated = inv.cariUpdated;

      if (status === 'odendi' && !inv.kasaEntryId && inv.payment !== 'cari') {
        const entry = {
          id: genId(),
          type: (inv.type === 'satis' ? 'gelir' : 'gider') as 'gelir' | 'gider',
          category: inv.type === 'satis' ? 'satis' : 'alis_fatura',
          amount: inv.total,
          kasa: (inv.payment === 'nakit' ? 'nakit' : 'banka') as 'nakit' | 'banka',
          description: `Fatura: ${inv.invoiceNo} — ${inv.cariName}`,
          relatedId: id,
          cariId: inv.cariId,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        kasa = [...kasa, entry];
        kasaEntryId = entry.id;
        showToast(`💰 Kasa otomatik güncellendi: ${inv.type === 'satis' ? '+' : '-'}${inv.total.toLocaleString('tr-TR')} ₺`);
      }

      if (status === 'onaylandi' && inv.payment === 'cari' && inv.cariId && !cariUpdated) {
        cari = cari.map(c => {
          if (c.id === inv.cariId) {
            const delta = inv.type === 'satis' ? inv.total : -inv.total;
            return { ...c, balance: (c.balance || 0) + delta, lastTransaction: nowIso, updatedAt: nowIso };
          }
          return c;
        });
        cariUpdated = true;
        showToast(`👤 Cari bakiye güncellendi: ${inv.cariName}`);
      }

      if (status === 'iptal') {
        // Kasa kaydını soft-delete et
        if (inv.kasaEntryId) {
          kasa = kasa.map(k => k.id === inv.kasaEntryId ? { ...k, deleted: true, updatedAt: nowIso } : k);
          kasaEntryId = undefined;
        }
        // Cari bakiyeyi geri al (onaylandi + cari ödeme ile güncellenmişse)
        if (inv.cariUpdated && inv.cariId && inv.payment === 'cari') {
          const delta = inv.type === 'satis' ? inv.total : -inv.total;
          cari = cari.map(c =>
            c.id === inv.cariId
              ? { ...c, balance: (c.balance || 0) - delta, lastTransaction: nowIso, updatedAt: nowIso }
              : c
          );
          cariUpdated = false;
        }
      }

      if (status === 'taslak') {
        // Kasa kaydını soft-delete et
        if (inv.kasaEntryId) {
          kasa = kasa.map(k => k.id === inv.kasaEntryId ? { ...k, deleted: true, updatedAt: nowIso } : k);
          kasaEntryId = undefined;
        }
        // Cari bakiyeyi geri al (onaylandi ile güncellenmişse)
        if (inv.cariUpdated && inv.cariId && inv.payment === 'cari') {
          const delta = inv.type === 'satis' ? inv.total : -inv.total;
          cari = cari.map(c =>
            c.id === inv.cariId
              ? { ...c, balance: (c.balance || 0) - delta, lastTransaction: nowIso, updatedAt: nowIso }
              : c
          );
          cariUpdated = false;
        }
      }

      const invoices = (prev.invoices || []).map(i => i.id === id ? { ...i, status, kasaEntryId, cariUpdated, updatedAt: nowIso } : i);
      return { ...prev, invoices, kasa, cari };
    });
    if (status !== 'odendi' && status !== 'onaylandi') showToast('Durum güncellendi!');
  };

  const deleteInvoice = (id: string) => {
    showConfirm('Fatura Sil', 'Bu fatura silinecek. Kasa ve cari etkileri de geri alınacak.', () => {
      const nowIso = new Date().toISOString();
      save(prev => {
        const inv = (prev.invoices || []).find(i => i.id === id);
        if (!inv) return prev;

        let kasa = prev.kasa;
        let cari = prev.cari;

        // Kasa kaydını soft-delete et
        if (inv.kasaEntryId) {
          kasa = kasa.map(k => k.id === inv.kasaEntryId ? { ...k, deleted: true, updatedAt: nowIso } : k);
        }

        // Cari güncellenmişse geri al
        if (inv.cariUpdated && inv.cariId && inv.payment === 'cari') {
          const delta = inv.type === 'satis' ? inv.total : -inv.total;
          cari = cari.map(c =>
            c.id === inv.cariId
              ? { ...c, balance: (c.balance || 0) - delta, lastTransaction: nowIso, updatedAt: nowIso }
              : c
          );
        }

        // Faturayı soft-delete et
        const invoices = (prev.invoices || []).map(i => i.id === id ? { ...i, deleted: true, updatedAt: nowIso } : i);
        return { ...prev, invoices, kasa, cari };
      });
      showToast('Fatura silindi!');
    });
  };

  const previewInv = previewId ? (db.invoices || []).find(i => i.id === previewId) : null;
  const formTotals = calcTotals(form.items.filter(it => it.description), form.discount);

  const payInstallment = (installmentId: string) => {
    const nowIso = new Date().toISOString();
    save(prev => {
      const inst = (prev.installments || []).find(i => i.id === installmentId);
      if (!inst) return prev;
      const inv = (prev.invoices || []).find(i => i.id === inst.invoiceId);

      const kasaEntry = {
        id: genId(),
        type: 'gelir' as const,
        category: 'taksit',
        amount: inst.amount,
        kasa: 'nakit' as const,
        description: `Taksit ödemesi — ${inv?.invoiceNo || inst.invoiceId}`,
        relatedId: inst.invoiceId,
        cariId: inv?.cariId,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      const installments = (prev.installments || []).map(i =>
        i.id === installmentId ? { ...i, paid: true, paidAt: nowIso, updatedAt: nowIso } : i
      );

      const kasa = [...prev.kasa, kasaEntry];

      let cari = prev.cari;
      if (inv?.cariId) {
        cari = prev.cari.map(c =>
          c.id === inv.cariId
            ? { ...c, balance: (c.balance || 0) - inst.amount, lastTransaction: nowIso, updatedAt: nowIso }
            : c
        );
      }

      return { ...prev, installments, kasa, cari };
    });
    showToast('✅ Taksit ödendi!');
  };

  const createInstallments = (invoiceId: string, total: number) => {
    const count = instForm.count;
    const firstDueDate = new Date(instForm.firstDueDate);
    const plan = createInstallmentPlan(invoiceId, total, count, firstDueDate);
    save(prev => ({
      ...prev,
      installments: [...(prev.installments || []), ...plan],
    }));
    setShowInstForm(false);
    showToast(`📅 ${count} taksitli plan oluşturuldu!`);
  };

  const selectCari = (cariId: string) => {
    const c = db.cari.find(ci => ci.id === cariId);
    if (c) setForm(f => ({ ...f, cariId: c.id, cariName: c.name, cariTaxNo: c.taxNo || '', cariAddress: c.address || '' }));
  };

  return (
    <div style={{ animation: 'fadeIn 0.3s ease' }}>
      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 18 }}>
        {[
          { icon: '📄', label: 'Toplam Fatura', value: String(stats.total), color: '#3b82f6' },
          { icon: '📤', label: 'Satış Faturaları', value: formatMoney(stats.satisTotal), color: '#10b981' },
          { icon: '📥', label: 'Alış Faturaları', value: formatMoney(stats.alisTotal), color: '#f59e0b' },
          { icon: '⏳', label: 'Ödenmemiş', value: formatMoney(stats.unpaid), color: '#ef4444' },
          { icon: '📝', label: 'Taslak', value: String(stats.draft), color: '#8b5cf6' },
        ].map(s => (
          <div key={s.label} style={{ background: `linear-gradient(135deg, ${s.color}12, ${s.color}06)`, borderRadius: 14, padding: '16px 18px', border: `1px solid ${s.color}20` }}>
            <div style={{ fontSize: '1rem', marginBottom: 4 }}>{s.icon}</div>
            <div style={{ fontSize: '1.2rem', fontWeight: 900, color: s.color }}>{s.value}</div>
            <div style={{ color: '#475569', fontSize: '0.72rem', marginTop: 3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={() => openNew('satis')} style={{ background: 'linear-gradient(135deg, #ff5722, #ff7043)', border: 'none', borderRadius: 10, color: '#fff', padding: '10px 18px', cursor: 'pointer', fontWeight: 700, fontSize: '0.88rem', boxShadow: '0 4px 16px rgba(255,87,34,0.3)' }}>+ Satış Faturası</button>
        <button onClick={() => openNew('alis')} style={{ background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.25)', borderRadius: 10, color: '#60a5fa', padding: '10px 18px', cursor: 'pointer', fontWeight: 700, fontSize: '0.88rem' }}>+ Alış Faturası</button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Ara..." style={{ padding: '8px 12px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, color: '#f1f5f9', fontSize: '0.85rem', width: 160 }} />
          <select value={filter} onChange={e => setFilter(e.target.value as any)} style={{ padding: '8px 10px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, color: '#94a3b8', fontSize: '0.82rem' }}>
            <option value="all">Tümü</option><option value="satis">Satış</option><option value="alis">Alış</option>
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ padding: '8px 10px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, color: '#94a3b8', fontSize: '0.82rem' }}>
            <option value="all">Tüm Durumlar</option><option value="taslak">Taslak</option><option value="onaylandi">Onaylandı</option><option value="odendi">Ödendi</option><option value="iptal">İptal</option>
          </select>
        </div>
      </div>

      {/* Invoice List */}
      <div style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))', borderRadius: 16, border: '1px solid rgba(255,255,255,0.07)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'rgba(0,0,0,0.3)' }}>
              {['Fatura No', 'Tür', 'Müşteri/Tedarikçi', 'Tarih', 'Tutar', 'Durum', 'Ödeme', ''].map(h => (
                <th key={h} style={{ padding: '12px 14px', textAlign: 'left', color: '#334155', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {invoices.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: 48, color: '#334155' }}>
                <div style={{ fontSize: '3rem', marginBottom: 12 }}>📄</div>
                <p style={{ fontSize: '0.9rem' }}>Henüz fatura yok</p>
                <p style={{ fontSize: '0.82rem', marginTop: 8, color: '#1e3a5f' }}>Yukarıdaki butonlarla ilk faturanızı oluşturun</p>
              </td></tr>
            ) : invoices.map(inv => (
              <tr key={inv.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', cursor: 'pointer' }}
                onMouseEnter={e => (e.currentTarget as HTMLTableRowElement).style.background = 'rgba(255,255,255,0.02)'}
                onMouseLeave={e => (e.currentTarget as HTMLTableRowElement).style.background = 'transparent'}>
                <td style={{ padding: '12px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: '#f1f5f9', fontWeight: 700, fontFamily: 'monospace', fontSize: '0.88rem' }}>{inv.invoiceNo}</span>
                    {inv.saleId && <span style={{ background: 'rgba(139,92,246,0.15)', color: '#a78bfa', borderRadius: 5, padding: '1px 6px', fontSize: '0.7rem', fontWeight: 700 }}>🔗 Satış</span>}
                  </div>
                </td>
                <td style={{ padding: '12px 14px' }}>
                  <span style={{ background: inv.type === 'satis' ? 'rgba(16,185,129,0.12)' : 'rgba(245,158,11,0.12)', color: inv.type === 'satis' ? '#10b981' : '#f59e0b', borderRadius: 6, padding: '2px 8px', fontSize: '0.78rem', fontWeight: 700 }}>{inv.type === 'satis' ? '📤 Satış' : '📥 Alış'}</span>
                </td>
                <td style={{ padding: '12px 14px', color: '#e2e8f0', fontWeight: 600, fontSize: '0.88rem' }}>{inv.cariName}</td>
                <td style={{ padding: '12px 14px', color: '#475569', fontSize: '0.82rem' }}>{formatDate(inv.createdAt)}</td>
                <td style={{ padding: '12px 14px', color: '#10b981', fontWeight: 700, fontSize: '0.92rem' }}>{formatMoney(inv.total)}</td>
                <td style={{ padding: '12px 14px' }}>
                  <span style={{ background: `${statusColors[inv.status]}18`, color: statusColors[inv.status], borderRadius: 6, padding: '3px 8px', fontSize: '0.78rem', fontWeight: 700 }}>{statusLabels[inv.status]}</span>
                </td>
                <td style={{ padding: '12px 14px', color: '#64748b', fontSize: '0.82rem' }}>{paymentLabels[inv.payment]}</td>
                <td style={{ padding: '12px 14px' }}>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button onClick={() => setPreviewId(inv.id)} title="Önizle" style={miniBtn}>👁️</button>
                    <button onClick={() => openEdit(inv)} title="Düzenle" style={miniBtn}>✏️</button>
                    {inv.status === 'taslak' && <button onClick={() => updateStatus(inv.id, 'onaylandi')} title="Onayla" style={{ ...miniBtn, color: '#10b981' }}>✓</button>}
                    {inv.status === 'onaylandi' && <button onClick={() => updateStatus(inv.id, 'odendi')} title="Ödendi" style={{ ...miniBtn, color: '#3b82f6' }}>💰</button>}
                    <button onClick={() => deleteInvoice(inv.id)} title="Sil" style={{ ...miniBtn, color: '#ef4444' }}>🗑️</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Invoice Form Modal */}
      <Modal open={modal} onClose={() => setModal(false)} title={editId ? '✏️ Fatura Düzenle' : `📄 Yeni ${form.type === 'satis' ? 'Satış' : 'Alış'} Faturası`} maxWidth={720}>
        <div style={{ display: 'grid', gap: 14 }}>
          {/* Cari seçimi */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={lbl}>{form.type === 'satis' ? 'Müşteri' : 'Tedarikçi'} *</label>
              <select value={form.cariId} onChange={e => selectCari(e.target.value)} style={inp}>
                <option value="">-- Cari Seç veya elle yazın --</option>
                {db.cari.filter(c => form.type === 'satis' ? c.type === 'musteri' : c.type === 'tedarikci').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div><label style={lbl}>Ad/Ünvan *</label><input value={form.cariName} onChange={e => setForm(f => ({ ...f, cariName: e.target.value }))} style={inp} /></div>
            <div><label style={lbl}>Vergi No</label><input value={form.cariTaxNo} onChange={e => setForm(f => ({ ...f, cariTaxNo: e.target.value }))} style={inp} /></div>
            <div><label style={lbl}>Adres</label><input value={form.cariAddress} onChange={e => setForm(f => ({ ...f, cariAddress: e.target.value }))} style={inp} /></div>
          </div>

          {/* Kalemler */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ ...lbl, marginBottom: 0 }}>Fatura Kalemleri</label>
              <button onClick={addItem} style={{ background: 'rgba(59,130,246,0.12)', border: 'none', borderRadius: 6, color: '#60a5fa', padding: '4px 10px', cursor: 'pointer', fontWeight: 700, fontSize: '0.78rem' }}>+ Kalem</button>
            </div>
            <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 10, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'rgba(0,0,0,0.2)' }}>
                    {['Açıklama', 'Adet', 'Birim ₺', 'KDV %', 'Toplam', ''].map(h => (
                      <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: '#334155', fontSize: '0.7rem', fontWeight: 700 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {form.items.map((it, idx) => (
                    <tr key={idx} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                      <td style={{ padding: '6px 8px' }}><input value={it.description} onChange={e => updateItem(idx, 'description', e.target.value)} style={{ ...inp, padding: '7px 10px', fontSize: '0.85rem' }} placeholder="Ürün/Hizmet" /></td>
                      <td style={{ padding: '6px 8px', width: 70 }}><input type="number" inputMode="decimal" value={it.quantity} min={1} onChange={e => updateItem(idx, 'quantity', parseInt(e.target.value) || 1)} style={{ ...inp, padding: '7px 8px', fontSize: '0.85rem', width: 60 }} /></td>
                      <td style={{ padding: '6px 8px', width: 100 }}><input type="number" inputMode="decimal" value={it.unitPrice} min={0} onChange={e => updateItem(idx, 'unitPrice', parseFloat(e.target.value) || 0)} style={{ ...inp, padding: '7px 8px', fontSize: '0.85rem', width: 90 }} /></td>
                      <td style={{ padding: '6px 8px', width: 70 }}>
                        <select value={it.vatRate} onChange={e => updateItem(idx, 'vatRate', parseInt(e.target.value))} style={{ ...inp, padding: '7px 6px', fontSize: '0.85rem', width: 60 }}>
                          <option value={0}>0</option><option value={1}>1</option><option value={10}>10</option><option value={20}>20</option>
                        </select>
                      </td>
                      <td style={{ padding: '6px 8px', color: '#10b981', fontWeight: 700, fontSize: '0.85rem', whiteSpace: 'nowrap' }}>{formatMoney(it.quantity * it.unitPrice * (1 + it.vatRate / 100))}</td>
                      <td style={{ padding: '6px 8px', width: 30 }}>
                        {form.items.length > 1 && <button onClick={() => removeItem(idx)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '0.85rem' }}>×</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Totals + Details */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div style={{ display: 'grid', gap: 10 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={lbl}>Ödeme</label>
                    <select value={form.payment} onChange={e => setForm(f => ({ ...f, payment: e.target.value as any }))} style={inp}>
                      {Object.entries(paymentLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                  <div><label style={lbl}>Vade Tarihi</label><input type="date" value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} style={inp} /></div>
                </div>
                <div>
                  <label style={lbl}>Durum</label>
                  <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as any }))} style={inp}>
                    <option value="taslak">📝 Taslak</option><option value="onaylandi">✅ Onaylandı</option><option value="odendi">💰 Ödendi</option><option value="iptal">❌ İptal</option>
                  </select>
                </div>
                <div><label style={lbl}>Not</label><textarea value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} style={{ ...inp, minHeight: 50 }} /></div>
                <div>
                  <label style={lbl}>İlgili Satış (opsiyonel)</label>
                  <select value={form.saleId} onChange={e => setForm(f => ({ ...f, saleId: e.target.value }))} style={inp}>
                    <option value="">-- Satış Seç --</option>
                    {(db.sales || []).filter(s => !s.deleted).map(s => (
                      <option key={s.id} value={s.id}>{formatDate(s.createdAt)} — {s.productName} ({formatMoney(s.total)})</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
            <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: 12, padding: '14px 16px' }}>
              <TotalRow label="Ara Toplam" value={formatMoney(formTotals.subtotal)} />
              <TotalRow label="KDV Toplam" value={formatMoney(formTotals.vatTotal)} color="#3b82f6" />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ color: '#64748b', fontSize: '0.82rem', flex: 1 }}>İskonto</span>
                <input type="number" inputMode="decimal" value={form.discount} min={0} onChange={e => setForm(f => ({ ...f, discount: parseFloat(e.target.value) || 0 }))} style={{ ...inp, width: 100, padding: '5px 8px', fontSize: '0.85rem', textAlign: 'right' }} />
              </div>
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 10, marginTop: 4 }}>
                <TotalRow label="GENEL TOPLAM" value={formatMoney(formTotals.total)} color="#10b981" big />
              </div>
            </div>
          </div>

          <button onClick={handleSave} style={{ background: 'linear-gradient(135deg, #ff5722, #ff7043)', border: 'none', borderRadius: 12, color: '#fff', padding: '13px 0', fontWeight: 800, cursor: 'pointer', fontSize: '1rem' }}>
            💾 {editId ? 'Güncelle' : 'Fatura Oluştur'}
          </button>
        </div>
      </Modal>

      {/* Preview Modal */}
      {previewInv && (
        <Modal open={true} onClose={() => setPreviewId(null)} title={`📄 Fatura: ${previewInv.invoiceNo}`} maxWidth={640}>
          <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 12, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 18, paddingBottom: 14, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <div>
                <h3 style={{ color: '#f1f5f9', fontWeight: 800, fontSize: '1rem', marginBottom: 4 }}>{db.company.name || 'Şirketiniz'}</h3>
                {db.company.taxNo && <p style={{ color: '#475569', fontSize: '0.82rem' }}>VKN: {db.company.taxNo}</p>}
                {db.company.phone && <p style={{ color: '#475569', fontSize: '0.82rem' }}>📞 {db.company.phone}</p>}
              </div>
              <div style={{ textAlign: 'right' }}>
                <p style={{ fontFamily: 'monospace', color: '#ff7043', fontWeight: 800, fontSize: '1rem' }}>{previewInv.invoiceNo}</p>
                <p style={{ color: '#475569', fontSize: '0.82rem' }}>{formatDate(previewInv.createdAt)}</p>
                <span style={{ background: `${statusColors[previewInv.status]}18`, color: statusColors[previewInv.status], borderRadius: 6, padding: '2px 8px', fontSize: '0.78rem', fontWeight: 700 }}>{statusLabels[previewInv.status]}</span>
              </div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <p style={{ color: '#334155', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{previewInv.type === 'satis' ? 'MÜŞTERİ' : 'TEDARİKÇİ'}</p>
              <p style={{ color: '#f1f5f9', fontWeight: 700 }}>{previewInv.cariName}</p>
              {previewInv.cariTaxNo && <p style={{ color: '#475569', fontSize: '0.82rem' }}>VKN: {previewInv.cariTaxNo}</p>}
              {previewInv.cariAddress && <p style={{ color: '#475569', fontSize: '0.82rem' }}>{previewInv.cariAddress}</p>}
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 14 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  {['Açıklama', 'Adet', 'Birim', 'KDV', 'Toplam'].map(h => <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: '#334155', fontSize: '0.72rem', fontWeight: 700 }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {previewInv.items.map((it, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <td style={{ padding: '8px 10px', color: '#e2e8f0', fontSize: '0.88rem' }}>{it.description}</td>
                    <td style={{ padding: '8px 10px', color: '#94a3b8', fontSize: '0.85rem' }}>{it.quantity}</td>
                    <td style={{ padding: '8px 10px', color: '#94a3b8', fontSize: '0.85rem' }}>{formatMoney(it.unitPrice)}</td>
                    <td style={{ padding: '8px 10px', color: '#94a3b8', fontSize: '0.85rem' }}>%{it.vatRate}</td>
                    <td style={{ padding: '8px 10px', color: '#10b981', fontWeight: 700, fontSize: '0.88rem' }}>{formatMoney(it.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 12 }}>
              <TotalRow label="Ara Toplam" value={formatMoney(previewInv.subtotal)} />
              <TotalRow label="KDV" value={formatMoney(previewInv.vatTotal)} color="#3b82f6" />
              {previewInv.discount > 0 && <TotalRow label="İskonto" value={`-${formatMoney(previewInv.discount)}`} color="#ef4444" />}
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 8, marginTop: 6 }}>
                <TotalRow label="GENEL TOPLAM" value={formatMoney(previewInv.total)} color="#10b981" big />
              </div>
            </div>
            {previewInv.note && <p style={{ color: '#475569', fontSize: '0.82rem', marginTop: 12, fontStyle: 'italic' }}>Not: {previewInv.note}</p>}
          </div>

          {/* Taksit Planı Bölümü */}
          {(() => {
            const installments = (db.installments || []).filter(i => i.invoiceId === previewInv.id);
            const today = new Date(); today.setHours(0, 0, 0, 0);
            return (
              <div style={{ marginTop: 16, background: 'rgba(0,0,0,0.15)', borderRadius: 12, padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ color: '#94a3b8', fontWeight: 700, fontSize: '0.88rem' }}>📅 Taksit Planı</span>
                  {installments.length === 0 && (
                    <button onClick={() => setShowInstForm(v => !v)} style={{ background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)', borderRadius: 8, color: '#a78bfa', padding: '5px 12px', cursor: 'pointer', fontWeight: 700, fontSize: '0.8rem' }}>
                      📅 Taksit Planı Oluştur
                    </button>
                  )}
                </div>

                {showInstForm && installments.length === 0 && (
                  <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 10, padding: 12, marginBottom: 12, display: 'grid', gap: 10 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <div>
                        <label style={lbl}>Taksit Sayısı (2-24)</label>
                        <input type="number" min={2} max={24} value={instForm.count}
                          onChange={e => setInstForm(f => ({ ...f, count: Math.min(24, Math.max(2, parseInt(e.target.value) || 2)) }))}
                          style={inp} />
                      </div>
                      <div>
                        <label style={lbl}>İlk Vade Tarihi</label>
                        <input type="date" value={instForm.firstDueDate}
                          onChange={e => setInstForm(f => ({ ...f, firstDueDate: e.target.value }))}
                          style={inp} />
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => createInstallments(previewInv.id, previewInv.total)}
                        style={{ flex: 1, background: 'linear-gradient(135deg, #8b5cf6, #7c3aed)', border: 'none', borderRadius: 8, color: '#fff', padding: '9px 0', cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem' }}>
                        ✓ Oluştur
                      </button>
                      <button onClick={() => setShowInstForm(false)}
                        style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, color: '#64748b', padding: '9px 14px', cursor: 'pointer', fontSize: '0.85rem' }}>
                        İptal
                      </button>
                    </div>
                  </div>
                )}

                {installments.length > 0 ? (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: 'rgba(0,0,0,0.2)' }}>
                        {['#', 'Vade', 'Tutar', 'Durum', ''].map(h => (
                          <th key={h} style={{ padding: '7px 10px', textAlign: 'left', color: '#334155', fontSize: '0.7rem', fontWeight: 700 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {installments.map((inst, idx) => {
                        const due = new Date(inst.dueDate); due.setHours(0, 0, 0, 0);
                        const isOverdue = !inst.paid && due < today;
                        const isToday = !inst.paid && due.getTime() === today.getTime();
                        const rowBg = inst.paid ? 'rgba(16,185,129,0.08)' : isOverdue ? 'rgba(239,68,68,0.1)' : isToday ? 'rgba(245,158,11,0.1)' : 'rgba(255,255,255,0.02)';
                        const statusColor = inst.paid ? '#10b981' : isOverdue ? '#ef4444' : isToday ? '#f59e0b' : '#64748b';
                        const statusLabel = inst.paid ? '✅ Ödendi' : isOverdue ? '⚠️ Gecikmiş' : isToday ? '🔔 Bugün' : '⏳ Bekliyor';
                        return (
                          <tr key={inst.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', background: rowBg }}>
                            <td style={{ padding: '8px 10px', color: '#64748b', fontSize: '0.82rem' }}>{idx + 1}</td>
                            <td style={{ padding: '8px 10px', color: '#e2e8f0', fontSize: '0.82rem' }}>{formatDate(inst.dueDate)}</td>
                            <td style={{ padding: '8px 10px', color: '#10b981', fontWeight: 700, fontSize: '0.85rem' }}>{formatMoney(inst.amount)}</td>
                            <td style={{ padding: '8px 10px' }}>
                              <span style={{ color: statusColor, fontSize: '0.78rem', fontWeight: 700 }}>{statusLabel}</span>
                            </td>
                            <td style={{ padding: '8px 10px' }}>
                              {!inst.paid && (
                                <button onClick={() => payInstallment(inst.id)}
                                  style={{ background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 6, color: '#10b981', padding: '3px 10px', cursor: 'pointer', fontWeight: 700, fontSize: '0.75rem' }}>
                                  ✓ Ödendi
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  !showInstForm && <p style={{ color: '#334155', fontSize: '0.82rem', textAlign: 'center', padding: '10px 0' }}>Henüz taksit planı yok</p>
                )}
              </div>
            );
          })()}

          <button onClick={() => { window.print(); }} style={{ width: '100%', marginTop: 14, padding: '11px 0', background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.25)', borderRadius: 10, color: '#60a5fa', cursor: 'pointer', fontWeight: 700, fontSize: '0.9rem' }}>🖨️ Yazdır</button>
        </Modal>
      )}
    </div>
  );
}

const miniBtn: React.CSSProperties = { background: 'rgba(255,255,255,0.04)', border: 'none', borderRadius: 6, color: '#64748b', padding: '4px 6px', cursor: 'pointer', fontSize: '0.82rem' };
const lbl: React.CSSProperties = { display: 'block', marginBottom: 5, color: '#64748b', fontSize: '0.82rem', fontWeight: 600 };
const inp: React.CSSProperties = { width: '100%', padding: '9px 12px', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, color: '#f1f5f9', fontSize: '0.88rem', boxSizing: 'border-box' };

function TotalRow({ label, value, color, big }: { label: string; value: string; color?: string; big?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
      <span style={{ color: big ? '#94a3b8' : '#475569', fontSize: big ? '0.95rem' : '0.82rem', fontWeight: big ? 700 : 400 }}>{label}</span>
      <span style={{ color: color || '#f1f5f9', fontWeight: big ? 900 : 600, fontSize: big ? '1.15rem' : '0.88rem' }}>{value}</span>
    </div>
  );
}
