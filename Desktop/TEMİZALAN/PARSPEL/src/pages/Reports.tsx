import { useState, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, Legend, AreaChart, Area } from 'recharts';
import { formatMoney, formatDate } from '@/lib/utils-tr';
import { exportArrayToExcel as exportToExcel } from '@/lib/excelExport';
import type { DB } from '@/types';

interface Props { db: DB; }

const COLORS = ['#ff5722', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];
const TT_STYLE = { background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9', fontSize: '0.82rem' };
const CARD = { background: 'linear-gradient(135deg,#1a2740,#0f1e35)', borderRadius: 14, padding: '16px 18px', border: '1px solid rgba(255,255,255,0.07)' };

type Tab = 'ozet' | 'satis' | 'urun' | 'cari' | 'kasa';
type Period = 'bu_ay' | 'gecen_ay' | 'bu_yil' | 'ozel';

function periodDates(p: Period, from: string, to: string): { start: Date; end: Date } {
  const now = new Date();
  if (p === 'bu_ay') return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: now };
  if (p === 'gecen_ay') return { start: new Date(now.getFullYear(), now.getMonth() - 1, 1), end: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59) };
  if (p === 'bu_yil') return { start: new Date(now.getFullYear(), 0, 1), end: now };
  return { start: from ? new Date(from) : new Date(2000, 0, 1), end: to ? new Date(to + 'T23:59:59') : now };
}

function EmptyChart() {
  return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 160, color: '#334155', flexDirection: 'column', gap: 8 }}>
    <span style={{ fontSize: '2rem', opacity: 0.3 }}>📊</span>
    <span style={{ fontSize: '0.82rem' }}>Veri yok</span>
  </div>;
}

function KpiCard({ label, value, sub, color, icon }: { label: string; value: string; sub?: string; color: string; icon: string }) {
  return (
    <div style={{ ...CARD, borderColor: `${color}25` }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: '1.4rem' }}>{icon}</span>
        <span style={{ fontSize: '0.68rem', color: color, background: `${color}18`, padding: '2px 8px', borderRadius: 20, fontWeight: 700 }}>{label}</span>
      </div>
      <div style={{ fontSize: '1.4rem', fontWeight: 900, color, letterSpacing: '-0.02em', lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ color: '#475569', fontSize: '0.75rem', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function SectionBox({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div style={{ background: '#111e33', borderRadius: 14, padding: 20, border: '1px solid rgba(255,255,255,0.06)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h3 style={{ fontWeight: 700, color: '#f1f5f9', fontSize: '0.95rem', margin: 0 }}>{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

// ── Sekme: Genel Özet ─────────────────────────────────────────────────────────
function TabOzet({ db, start, end }: { db: DB; start: Date; end: Date }) {
  const sales = useMemo(() => db.sales.filter(s => s.status === 'tamamlandi' && !s.deleted && new Date(s.createdAt) >= start && new Date(s.createdAt) <= end), [db.sales, start, end]);
  const prevStart = new Date(start.getTime() - (end.getTime() - start.getTime()));
  const prevSales = useMemo(() => db.sales.filter(s => s.status === 'tamamlandi' && !s.deleted && new Date(s.createdAt) >= prevStart && new Date(s.createdAt) < start), [db.sales, prevStart, start]);

  const ciro = sales.reduce((s, x) => s + x.total, 0);
  const kar = sales.reduce((s, x) => s + x.profit, 0);
  const prevCiro = prevSales.reduce((s, x) => s + x.total, 0);
  const prevKar = prevSales.reduce((s, x) => s + x.profit, 0);
  const delta = (curr: number, prev: number) => prev === 0 ? null : `${curr >= prev ? '▲' : '▼'} %${Math.abs(((curr - prev) / prev) * 100).toFixed(1)}`;

  const alacak = db.cari.filter(c => !c.deleted && c.type === 'musteri' && c.balance > 0).reduce((s, c) => s + c.balance, 0);
  const borc = db.cari.filter(c => !c.deleted && c.type === 'tedarikci' && c.balance > 0).reduce((s, c) => s + c.balance, 0);
  const kasaToplam = db.kasa.filter(e => !e.deleted).reduce((s, e) => s + (e.type === 'gelir' ? e.amount : -e.amount), 0);
  const stokDeger = db.products.filter(p => !p.deleted).reduce((s, p) => s + p.cost * p.stock, 0);

  // Günlük ciro (son 14 gün)
  const dailyData = useMemo(() => {
    const map: Record<string, { ciro: number; kar: number }> = {};
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' });
      map[key] = { ciro: 0, kar: 0 };
    }
    db.sales.filter(s => s.status === 'tamamlandi' && !s.deleted).forEach(s => {
      const d = new Date(s.createdAt);
      const key = d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' });
      if (map[key]) { map[key].ciro += s.total; map[key].kar += s.profit; }
    });
    return Object.entries(map).map(([name, v]) => ({ name, ...v }));
  }, [db.sales]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12 }}>
        <KpiCard icon="💰" label="Ciro" value={formatMoney(ciro)} sub={delta(ciro, prevCiro) || undefined} color="#10b981" />
        <KpiCard icon="📈" label="Kâr" value={formatMoney(kar)} sub={`Oran: %${ciro ? ((kar / ciro) * 100).toFixed(1) : 0}`} color="#3b82f6" />
        <KpiCard icon="🛒" label="Satış" value={String(sales.length)} sub={delta(sales.length, prevSales.length) || undefined} color="#f59e0b" />
        <KpiCard icon="👤" label="Alacak" value={formatMoney(alacak)} color="#ef4444" />
        <KpiCard icon="🏦" label="Kasa" value={formatMoney(kasaToplam)} color="#8b5cf6" />
        <KpiCard icon="📦" label="Stok Değeri" value={formatMoney(stokDeger)} color="#06b6d4" />
      </div>

      <SectionBox title="📅 Son 14 Gün — Günlük Ciro & Kâr">
        {dailyData.every(d => d.ciro === 0) ? <EmptyChart /> : (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={dailyData}>
              <defs>
                <linearGradient id="gCiro" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#ff5722" stopOpacity={0.3} /><stop offset="95%" stopColor="#ff5722" stopOpacity={0} /></linearGradient>
                <linearGradient id="gKar" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10b981" stopOpacity={0.3} /><stop offset="95%" stopColor="#10b981" stopOpacity={0} /></linearGradient>
              </defs>
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} />
              <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v)} />
              <Tooltip formatter={(v: number) => [formatMoney(v), '']} contentStyle={TT_STYLE} />
              <Legend />
              <Area type="monotone" dataKey="ciro" stroke="#ff5722" fill="url(#gCiro)" name="Ciro" strokeWidth={2} dot={false} />
              <Area type="monotone" dataKey="kar" stroke="#10b981" fill="url(#gKar)" name="Kâr" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </SectionBox>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <SectionBox title="⚠️ Stok Uyarıları">
          {(() => {
            const out = db.products.filter(p => !p.deleted && p.stock === 0);
            const low = db.products.filter(p => !p.deleted && p.stock > 0 && p.stock <= p.minStock);
            if (!out.length && !low.length) return <div style={{ color: '#10b981', fontSize: '0.85rem', padding: '12px 0' }}>✅ Tüm stoklar yeterli</div>;
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflowY: 'auto' }}>
                {out.map(p => <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', background: 'rgba(239,68,68,0.08)', borderRadius: 8, border: '1px solid rgba(239,68,68,0.2)' }}>
                  <span style={{ color: '#fca5a5', fontSize: '0.83rem' }}>{p.name}</span>
                  <span style={{ color: '#ef4444', fontWeight: 700, fontSize: '0.78rem' }}>BĐTĐ</span>
                </div>)}
                {low.map(p => <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', background: 'rgba(245,158,11,0.08)', borderRadius: 8, border: '1px solid rgba(245,158,11,0.2)' }}>
                  <span style={{ color: '#fcd34d', fontSize: '0.83rem' }}>{p.name}</span>
                  <span style={{ color: '#f59e0b', fontWeight: 700, fontSize: '0.78rem' }}>{p.stock} adet</span>
                </div>)}
              </div>
            );
          })()}
        </SectionBox>

        <SectionBox title="🏆 Top 5 Müşteri (Alacak)">
          {(() => {
            const top = [...db.cari].filter(c => c.type === 'musteri' && c.balance > 0).sort((a, b) => b.balance - a.balance).slice(0, 5);
            if (!top.length) return <EmptyChart />;
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {top.map((c, i) => (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 22, height: 22, borderRadius: '50%', background: COLORS[i], display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '0.68rem', fontWeight: 700, flexShrink: 0 }}>{i + 1}</span>
                    <span style={{ flex: 1, color: '#cbd5e1', fontSize: '0.83rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                    <span style={{ color: '#ef4444', fontWeight: 700, fontSize: '0.83rem' }}>{formatMoney(c.balance)}</span>
                  </div>
                ))}
              </div>
            );
          })()}
        </SectionBox>
      </div>
    </div>
  );
}

// ── Sekme: Satış Analizi ──────────────────────────────────────────────────────
function TabSatis({ db, start, end }: { db: DB; start: Date; end: Date }) {
  const sales = useMemo(() => db.sales.filter(s => s.status === 'tamamlandi' && !s.deleted && new Date(s.createdAt) >= start && new Date(s.createdAt) <= end), [db.sales, start, end]);

  const monthlyData = useMemo(() => {
    const map: Record<string, { ciro: number; kar: number; adet: number }> = {};
    sales.forEach(s => {
      const key = new Date(s.createdAt).toLocaleDateString('tr-TR', { month: 'short', year: '2-digit' });
      if (!map[key]) map[key] = { ciro: 0, kar: 0, adet: 0 };
      map[key].ciro += s.total; map[key].kar += s.profit; map[key].adet++;
    });
    return Object.entries(map).map(([name, v]) => ({ name, ...v }));
  }, [sales]);

  const paymentData = useMemo(() => {
    const map: Record<string, number> = {};
    sales.forEach(s => { map[s.payment] = (map[s.payment] || 0) + s.total; });
    const labels: Record<string, string> = { nakit: '💵 Nakit', kart: '💳 Kart', havale: '🏦 Havale', cari: '👤 Cari' };
    return Object.entries(map).map(([k, v]) => ({ name: labels[k] || k, value: v }));
  }, [sales]);

  const categoryData = useMemo(() => {
    const map: Record<string, { ciro: number; kar: number; adet: number }> = {};
    sales.forEach(s => {
      const cat = s.productCategory || 'Diğer';
      if (!map[cat]) map[cat] = { ciro: 0, kar: 0, adet: 0 };
      map[cat].ciro += s.total; map[cat].kar += s.profit; map[cat].adet += s.quantity;
    });
    return Object.entries(map).sort((a, b) => b[1].ciro - a[1].ciro).map(([name, v]) => ({ name, ...v }));
  }, [sales]);

  const iadeler = db.sales.filter(s => s.status === 'iade' && !s.deleted && new Date(s.createdAt) >= start && new Date(s.createdAt) <= end);
  const ciro = sales.reduce((s, x) => s + x.total, 0);
  const kar = sales.reduce((s, x) => s + x.profit, 0);

  const handleExport = () => {
    exportToExcel(sales.map(s => ({
      Tarih: formatDate(s.createdAt),
      Ürün: s.productName,
      Kategori: s.productCategory || '',
      Adet: s.quantity,
      'Birim Fiyat': s.unitPrice,
      Toplam: s.total,
      Kâr: s.profit,
      Ödeme: s.payment,
      Müşteri: s.cariName || '',
    })), 'satis-raporu');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 12 }}>
        <KpiCard icon="💰" label="Dönem Ciro" value={formatMoney(ciro)} color="#10b981" />
        <KpiCard icon="📈" label="Dönem Kâr" value={formatMoney(kar)} sub={`Marj: %${ciro ? ((kar / ciro) * 100).toFixed(1) : 0}`} color="#3b82f6" />
        <KpiCard icon="🛒" label="Satış Adedi" value={String(sales.length)} color="#f59e0b" />
        <KpiCard icon="🔄" label="İade" value={String(iadeler.length)} color="#ef4444" />
        <KpiCard icon="🎯" label="Ort. Sepet" value={formatMoney(sales.length ? ciro / sales.length : 0)} color="#8b5cf6" />
        <KpiCard icon="📦" label="Satılan Ürün" value={String(sales.reduce((s, x) => s + x.quantity, 0))} color="#06b6d4" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <SectionBox title="📅 Aylık Ciro & Kâr" action={
          <button onClick={handleExport} style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 8, color: '#10b981', padding: '5px 12px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600 }}>📥 Excel</button>
        }>
          {monthlyData.length === 0 ? <EmptyChart /> : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={monthlyData}>
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} />
                <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v)} />
                <Tooltip formatter={(v: number) => [formatMoney(v), '']} contentStyle={TT_STYLE} />
                <Legend />
                <Bar dataKey="ciro" fill="#ff5722" name="Ciro" radius={[3, 3, 0, 0]} />
                <Bar dataKey="kar" fill="#10b981" name="Kâr" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </SectionBox>

        <SectionBox title="💳 Ödeme Dağılımı">
          {paymentData.length === 0 ? <EmptyChart /> : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={paymentData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3}>
                  {paymentData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: number) => [formatMoney(v), '']} contentStyle={TT_STYLE} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </SectionBox>
      </div>

      <SectionBox title="🏷️ Kategori Bazlı Performans">
        {categoryData.length === 0 ? <EmptyChart /> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #1e3a5f' }}>
                  {['Kategori', 'Ciro', 'Kâr', 'Marj %', 'Adet'].map(h => (
                    <th key={h} style={{ padding: '8px 12px', color: '#475569', fontWeight: 600, textAlign: h === 'Kategori' ? 'left' : 'right', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {categoryData.map((c, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <td style={{ padding: '9px 12px', color: '#f1f5f9', fontWeight: 600 }}>
                      <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: COLORS[i % COLORS.length], marginRight: 8 }} />
                      {c.name}
                    </td>
                    <td style={{ padding: '9px 12px', color: '#10b981', fontWeight: 700, textAlign: 'right' }}>{formatMoney(c.ciro)}</td>
                    <td style={{ padding: '9px 12px', color: '#3b82f6', textAlign: 'right' }}>{formatMoney(c.kar)}</td>
                    <td style={{ padding: '9px 12px', color: c.ciro ? (c.kar / c.ciro > 0.2 ? '#10b981' : '#f59e0b') : '#64748b', textAlign: 'right' }}>
                      %{c.ciro ? ((c.kar / c.ciro) * 100).toFixed(1) : 0}
                    </td>
                    <td style={{ padding: '9px 12px', color: '#94a3b8', textAlign: 'right' }}>{c.adet}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionBox>
    </div>
  );
}

// ── Sekme: Ürün & Stok ───────────────────────────────────────────────────────
function TabUrun({ db, start, end }: { db: DB; start: Date; end: Date }) {
  const [sortBy, setSortBy] = useState<'ciro' | 'kar' | 'adet' | 'marj'>('ciro');

  const productStats = useMemo(() => {
    const map: Record<string, { name: string; category: string; ciro: number; kar: number; adet: number; cost: number; price: number; stock: number }> = {};
    db.sales.filter(s => s.status === 'tamamlandi' && !s.deleted && new Date(s.createdAt) >= start && new Date(s.createdAt) <= end).forEach(s => {
      const id = s.productId || s.productName;
      const p = db.products.find(x => x.id === s.productId);
      if (!map[id]) map[id] = { name: s.productName, category: s.productCategory || '', ciro: 0, kar: 0, adet: 0, cost: p?.cost || 0, price: p?.price || 0, stock: p?.stock || 0 };
      map[id].ciro += s.total; map[id].kar += s.profit; map[id].adet += s.quantity;
    });
    return Object.values(map).sort((a, b) => {
      if (sortBy === 'ciro') return b.ciro - a.ciro;
      if (sortBy === 'kar') return b.kar - a.kar;
      if (sortBy === 'adet') return b.adet - a.adet;
      return (b.ciro ? b.kar / b.ciro : 0) - (a.ciro ? a.kar / a.ciro : 0);
    });
  }, [db.sales, db.products, start, end, sortBy]);

  const stokDurum = useMemo(() => {
    const products = db.products.filter(p => !p.deleted);
    return {
      toplam: products.length,
      biten: products.filter(p => p.stock === 0).length,
      az: products.filter(p => p.stock > 0 && p.stock <= p.minStock).length,
      normal: products.filter(p => p.stock > p.minStock).length,
      deger: products.reduce((s, p) => s + p.cost * p.stock, 0),
    };
  }, [db.products]);

  const handleExport = () => {
    exportToExcel(productStats.map(p => ({
      Ürün: p.name, Kategori: p.category,
      Ciro: p.ciro, Kâr: p.kar,
      'Marj %': p.ciro ? +((p.kar / p.ciro) * 100).toFixed(1) : 0,
      'Satış Adedi': p.adet, 'Mevcut Stok': p.stock,
    })), 'urun-raporu');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 12 }}>
        <KpiCard icon="📦" label="Toplam Ürün" value={String(stokDurum.toplam)} color="#06b6d4" />
        <KpiCard icon="✅" label="Normal Stok" value={String(stokDurum.normal)} color="#10b981" />
        <KpiCard icon="⚠️" label="Az Stok" value={String(stokDurum.az)} color="#f59e0b" />
        <KpiCard icon="❌" label="Biten" value={String(stokDurum.biten)} color="#ef4444" />
        <KpiCard icon="💎" label="Stok Değeri" value={formatMoney(stokDurum.deger)} color="#8b5cf6" />
      </div>

      <SectionBox title="🏆 Ürün Performansı" action={
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {(['ciro', 'kar', 'adet', 'marj'] as const).map(s => (
            <button key={s} onClick={() => setSortBy(s)} style={{ background: sortBy === s ? 'rgba(255,87,34,0.2)' : 'rgba(255,255,255,0.05)', border: `1px solid ${sortBy === s ? 'rgba(255,87,34,0.4)' : 'rgba(255,255,255,0.07)'}`, borderRadius: 6, color: sortBy === s ? '#ff7043' : '#64748b', padding: '4px 10px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}>
              {s === 'ciro' ? 'Ciro' : s === 'kar' ? 'Kâr' : s === 'adet' ? 'Adet' : 'Marj'}
            </button>
          ))}
          <button onClick={handleExport} style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 6, color: '#10b981', padding: '4px 10px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}>📥</button>
        </div>
      }>
        <div style={{ marginBottom: 10, padding: '7px 10px', background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 8, fontSize: '0.75rem', color: '#f59e0b' }}>
          ℹ️ Kâr ve marj değerleri satış anındaki maliyete göre hesaplanır. Ürün maliyeti sonradan değiştirilirse geçmiş satışlar etkilenmez.
        </div>
        {productStats.length === 0 ? <EmptyChart /> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #1e3a5f' }}>
                  {['#', 'Ürün', 'Ciro', 'Kâr', 'Marj', 'Adet', 'Stok'].map(h => (
                    <th key={h} style={{ padding: '7px 10px', color: '#475569', fontWeight: 600, textAlign: h === 'Ürün' || h === '#' ? 'left' : 'right', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {productStats.slice(0, 30).map((p, i) => {
                  const marj = p.ciro ? (p.kar / p.ciro) * 100 : 0;
                  return (
                    <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                      <td style={{ padding: '8px 10px', color: '#475569' }}>{i + 1}</td>
                      <td style={{ padding: '8px 10px', color: '#f1f5f9', fontWeight: 500, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</td>
                      <td style={{ padding: '8px 10px', color: '#10b981', fontWeight: 700, textAlign: 'right' }}>{formatMoney(p.ciro)}</td>
                      <td style={{ padding: '8px 10px', color: '#3b82f6', textAlign: 'right' }}>{formatMoney(p.kar)}</td>
                      <td style={{ padding: '8px 10px', color: marj >= 20 ? '#10b981' : marj >= 10 ? '#f59e0b' : '#ef4444', textAlign: 'right', fontWeight: 600 }}>%{marj.toFixed(1)}</td>
                      <td style={{ padding: '8px 10px', color: '#94a3b8', textAlign: 'right' }}>{p.adet}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                        <span style={{ color: p.stock === 0 ? '#ef4444' : p.stock <= 5 ? '#f59e0b' : '#10b981', fontWeight: 600 }}>{p.stock}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionBox>
    </div>
  );
}

// ── Sekme: Cari & Alacak ─────────────────────────────────────────────────────
function TabCari({ db }: { db: DB }) {
  const [filter, setFilter] = useState<'all' | 'musteri' | 'tedarikci'>('musteri');
  const [search, setSearch] = useState('');
  const [aging, setAging] = useState(false);

  const now = new Date();
  const cariList = useMemo(() => {
    let list = db.cari.filter(c => !c.deleted && (filter === 'all' ? true : c.type === filter));
    if (search) list = list.filter(c => c.name.toLowerCase().includes(search.toLowerCase()));
    return [...list].sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
  }, [db.cari, filter, search]);

  // Vade yaşlandırma — son işlem tarihine göre
  const agingData = useMemo(() => {
    const buckets = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
    db.cari.filter(c => !c.deleted && c.type === 'musteri' && c.balance > 0).forEach(c => {
      const lastSale = db.sales.filter(s => (s.cariId === c.id || s.customerId === c.id) && s.status === 'tamamlandi').sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
      const days = lastSale ? Math.floor((now.getTime() - new Date(lastSale.createdAt).getTime()) / 86400000) : 999;
      if (days <= 30) buckets['0-30'] += c.balance;
      else if (days <= 60) buckets['31-60'] += c.balance;
      else if (days <= 90) buckets['61-90'] += c.balance;
      else buckets['90+'] += c.balance;
    });
    return Object.entries(buckets).map(([name, value]) => ({ name, value }));
  }, [db.cari, db.sales]);

  const totals = useMemo(() => ({
    musteri: db.cari.filter(c => !c.deleted && c.type === 'musteri' && c.balance > 0).reduce((s, c) => s + c.balance, 0),
    tedarikci: db.cari.filter(c => !c.deleted && c.type === 'tedarikci' && c.balance > 0).reduce((s, c) => s + c.balance, 0),
    musteri_sayisi: db.cari.filter(c => !c.deleted && c.type === 'musteri' && c.balance > 0).length,
    tedarikci_sayisi: db.cari.filter(c => !c.deleted && c.type === 'tedarikci' && c.balance > 0).length,
  }), [db.cari]);

  const handleExport = () => {
    exportToExcel(cariList.map(c => ({
      Ad: c.name, Tip: c.type === 'musteri' ? 'Müşteri' : 'Tedarikçi',
      Bakiye: c.balance, Telefon: c.phone || '', 'Vergi No': c.taxNo || '',
    })), 'cari-raporu');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 12 }}>
        <KpiCard icon="📥" label="Toplam Alacak" value={formatMoney(totals.musteri)} sub={`${totals.musteri_sayisi} müşteri`} color="#ef4444" />
        <KpiCard icon="📤" label="Toplam Borç" value={formatMoney(totals.tedarikci)} sub={`${totals.tedarikci_sayisi} tedarikçi`} color="#f59e0b" />
        <KpiCard icon="⚖️" label="Net Pozisyon" value={formatMoney(totals.musteri - totals.tedarikci)} color={totals.musteri >= totals.tedarikci ? '#10b981' : '#ef4444'} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <SectionBox title="📊 Alacak Yaşlandırma (Müşteri)">
          {agingData.every(d => d.value === 0) ? <EmptyChart /> : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={agingData} layout="vertical">
                <XAxis type="number" tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v)} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} width={55} />
                <Tooltip formatter={(v: number) => [formatMoney(v), 'Tutar']} contentStyle={TT_STYLE} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                  {agingData.map((_, i) => <Cell key={i} fill={['#10b981', '#f59e0b', '#ef4444', '#7f1d1d'][i]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </SectionBox>

        <SectionBox title="🥧 Cari Dağılım">
          {(() => {
            const data = [
              { name: 'Alacak', value: totals.musteri },
              { name: 'Borç', value: totals.tedarikci },
            ].filter(d => d.value > 0);
            if (!data.length) return <EmptyChart />;
            return (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={4}>
                    <Cell fill="#ef4444" /><Cell fill="#f59e0b" />
                  </Pie>
                  <Tooltip formatter={(v: number) => [formatMoney(v), '']} contentStyle={TT_STYLE} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            );
          })()}
        </SectionBox>
      </div>

      <SectionBox title="👥 Cari Listesi" action={
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Ara..." style={{ padding: '5px 10px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 7, color: '#f1f5f9', fontSize: '0.8rem', width: 120 }} />
          {(['all', 'musteri', 'tedarikci'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{ background: filter === f ? 'rgba(255,87,34,0.15)' : 'rgba(255,255,255,0.05)', border: `1px solid ${filter === f ? 'rgba(255,87,34,0.3)' : 'rgba(255,255,255,0.07)'}`, borderRadius: 7, color: filter === f ? '#ff7043' : '#64748b', padding: '5px 10px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600 }}>
              {f === 'all' ? 'Tümü' : f === 'musteri' ? 'Müşteri' : 'Tedarikçi'}
            </button>
          ))}
          <button onClick={handleExport} style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 7, color: '#10b981', padding: '5px 10px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600 }}>📥</button>
        </div>
      }>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #1e3a5f' }}>
                {['Ad', 'Tip', 'Bakiye', 'Telefon'].map(h => (
                  <th key={h} style={{ padding: '7px 10px', color: '#475569', fontWeight: 600, textAlign: h === 'Bakiye' ? 'right' : 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cariList.slice(0, 50).map((c, i) => (
                <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                  <td style={{ padding: '8px 10px', color: '#f1f5f9', fontWeight: 500 }}>{c.name}</td>
                  <td style={{ padding: '8px 10px' }}>
                    <span style={{ background: c.type === 'musteri' ? 'rgba(59,130,246,0.12)' : 'rgba(245,158,11,0.12)', color: c.type === 'musteri' ? '#60a5fa' : '#fbbf24', padding: '2px 8px', borderRadius: 12, fontSize: '0.75rem', fontWeight: 600 }}>
                      {c.type === 'musteri' ? 'Müşteri' : 'Tedarikçi'}
                    </span>
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, color: c.balance > 0 ? '#ef4444' : c.balance < 0 ? '#10b981' : '#64748b' }}>
                    {formatMoney(Math.abs(c.balance))} {c.balance > 0 ? '▲' : c.balance < 0 ? '▼' : ''}
                  </td>
                  <td style={{ padding: '8px 10px', color: '#64748b' }}>{c.phone || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionBox>
    </div>
  );
}

// ── Sekme: Kasa Analizi ───────────────────────────────────────────────────────
function TabKasa({ db, start, end }: { db: DB; start: Date; end: Date }) {
  const entries = useMemo(() => db.kasa.filter(e => !e.deleted && new Date(e.createdAt) >= start && new Date(e.createdAt) <= end), [db.kasa, start, end]);
  const kasalar = db.kasalar || [{ id: 'nakit', name: 'Nakit', icon: '💵' }, { id: 'banka', name: 'Banka', icon: '🏦' }];

  const gelir = entries.filter(e => e.type === 'gelir').reduce((s, e) => s + e.amount, 0);
  const gider = entries.filter(e => e.type === 'gider').reduce((s, e) => s + e.amount, 0);
  const net = gelir - gider;

  const kasaBakiye = useMemo(() => {
    const map: Record<string, number> = {};
    kasalar.forEach(k => map[k.id] = 0);
    db.kasa.filter(e => !e.deleted).forEach(e => {
      map[e.kasa] = (map[e.kasa] || 0) + (e.type === 'gelir' ? e.amount : -e.amount);
    });
    return map;
  }, [db.kasa, kasalar]);

  const monthlyKasa = useMemo(() => {
    const map: Record<string, { gelir: number; gider: number }> = {};
    entries.forEach(e => {
      const key = new Date(e.createdAt).toLocaleDateString('tr-TR', { month: 'short', year: '2-digit' });
      if (!map[key]) map[key] = { gelir: 0, gider: 0 };
      if (e.type === 'gelir') map[key].gelir += e.amount;
      else map[key].gider += e.amount;
    });
    return Object.entries(map).map(([name, v]) => ({ name, ...v }));
  }, [entries]);

  const categoryData = useMemo(() => {
    const map: Record<string, number> = {};
    entries.filter(e => e.type === 'gider').forEach(e => {
      const cat = e.category || 'Diğer';
      map[cat] = (map[cat] || 0) + e.amount;
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value }));
  }, [entries]);

  const handleExport = () => {
    exportToExcel(entries.map(e => ({
      Tarih: formatDate(e.createdAt), Tip: e.type === 'gelir' ? 'Gelir' : 'Gider',
      Tutar: e.amount, Kasa: e.kasa, Kategori: e.category || '', Açıklama: e.description || '',
    })), 'kasa-raporu');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 12 }}>
        <KpiCard icon="📥" label="Dönem Gelir" value={formatMoney(gelir)} color="#10b981" />
        <KpiCard icon="📤" label="Dönem Gider" value={formatMoney(gider)} color="#ef4444" />
        <KpiCard icon="⚖️" label="Net Akış" value={formatMoney(net)} color={net >= 0 ? '#10b981' : '#ef4444'} />
        {kasalar.map(k => (
          <KpiCard key={k.id} icon={k.icon} label={k.name} value={formatMoney(kasaBakiye[k.id] || 0)} color={kasaBakiye[k.id] >= 0 ? '#8b5cf6' : '#ef4444'} />
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <SectionBox title="📅 Aylık Nakit Akışı" action={
          <button onClick={handleExport} style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 8, color: '#10b981', padding: '5px 12px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600 }}>📥 Excel</button>
        }>
          {monthlyKasa.length === 0 ? <EmptyChart /> : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={monthlyKasa}>
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} />
                <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v)} />
                <Tooltip formatter={(v: number) => [formatMoney(v), '']} contentStyle={TT_STYLE} />
                <Legend />
                <Bar dataKey="gelir" fill="#10b981" name="Gelir" radius={[3, 3, 0, 0]} />
                <Bar dataKey="gider" fill="#ef4444" name="Gider" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </SectionBox>

        <SectionBox title="🔴 Gider Kategorileri">
          {categoryData.length === 0 ? <EmptyChart /> : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={categoryData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} paddingAngle={2}
                  label={({ name, percent }) => percent > 0.05 ? `${(percent * 100).toFixed(0)}%` : ''} labelLine={false}>
                  {categoryData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: number) => [formatMoney(v), '']} contentStyle={TT_STYLE} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </SectionBox>
      </div>
    </div>
  );
}

// ── Ana Bileşen ───────────────────────────────────────────────────────────────
export default function Reports({ db }: Props) {
  const [tab, setTab] = useState<Tab>('ozet');
  const [period, setPeriod] = useState<Period>('bu_ay');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const { start, end } = periodDates(period, dateFrom, dateTo);

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'ozet', label: 'Genel Özet', icon: '🏠' },
    { id: 'satis', label: 'Satış', icon: '🛒' },
    { id: 'urun', label: 'Ürün & Stok', icon: '📦' },
    { id: 'cari', label: 'Cari', icon: '👤' },
    { id: 'kasa', label: 'Kasa', icon: '💰' },
  ];

  const periods: { id: Period; label: string }[] = [
    { id: 'bu_ay', label: 'Bu Ay' },
    { id: 'gecen_ay', label: 'Geçen Ay' },
    { id: 'bu_yil', label: 'Bu Yıl' },
    { id: 'ozel', label: 'Özel' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', background: '#0d1b2e', borderRadius: 12, padding: '10px 14px', border: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {periods.map(p => (
            <button key={p.id} onClick={() => setPeriod(p.id)} style={{ background: period === p.id ? 'rgba(255,87,34,0.18)' : 'rgba(255,255,255,0.04)', border: `1px solid ${period === p.id ? 'rgba(255,87,34,0.35)' : 'rgba(255,255,255,0.07)'}`, borderRadius: 8, color: period === p.id ? '#ff7043' : '#64748b', padding: '6px 14px', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600 }}>
              {p.label}
            </button>
          ))}
        </div>
        {period === 'ozel' && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ padding: '6px 10px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, color: '#f1f5f9', fontSize: '0.82rem' }} />
            <span style={{ color: '#334155' }}>—</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ padding: '6px 10px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, color: '#f1f5f9', fontSize: '0.82rem' }} />
          </div>
        )}
        <div style={{ color: '#1e3a5f', fontSize: '0.75rem', marginLeft: 'auto' }}>
          {start.toLocaleDateString('tr-TR')} – {end.toLocaleDateString('tr-TR')}
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, background: '#0d1b2e', borderRadius: 12, padding: 6, border: '1px solid rgba(255,255,255,0.06)', overflowX: 'auto' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ flex: 1, minWidth: 80, padding: '8px 12px', border: 'none', borderRadius: 9, cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem', background: tab === t.id ? 'linear-gradient(135deg,rgba(255,87,34,0.2),rgba(255,87,34,0.08))' : 'transparent', color: tab === t.id ? '#ff7043' : '#475569', transition: 'all 0.15s', whiteSpace: 'nowrap', boxShadow: tab === t.id ? 'inset 0 0 0 1px rgba(255,87,34,0.25)' : 'none' }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Tab içeriği */}
      {tab === 'ozet' && <TabOzet db={db} start={start} end={end} />}
      {tab === 'satis' && <TabSatis db={db} start={start} end={end} />}
      {tab === 'urun' && <TabUrun db={db} start={start} end={end} />}
      {tab === 'cari' && <TabCari db={db} />}
      {tab === 'kasa' && <TabKasa db={db} start={start} end={end} />}
    </div>
  );
}
