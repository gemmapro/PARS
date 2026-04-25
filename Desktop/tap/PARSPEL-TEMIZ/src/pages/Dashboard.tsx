import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Area, AreaChart } from 'recharts';
import { formatMoney, formatDate } from '@/lib/utils-tr';
import { exportToExcel } from '@/lib/excelExport';
import type { DB } from '@/types';
import { saveBackupToFirebase, listBackupsFromFirebase, restoreBackupFromFirebase } from '@/hooks/useDB';
import { loadConnConfig } from '@/lib/connConfig';

interface Props {
  db: DB;
  onTabChange: (tab: string) => void;
  save: (updater: (prev: DB) => DB) => void;
}

interface StatCardData {
  icon: string; label: string; value: string; color: string; gradient: string; sub?: string; tab?: string; trend?: number;
}

function StatCard({ icon, label, value, color, gradient, sub, onClick, trend }: {
  icon: string; label: string; value: string; color: string; gradient: string; sub?: string; onClick?: () => void; trend?: number;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        background: `linear-gradient(135deg, ${gradient})`,
        borderRadius: 16, padding: '20px 22px',
        border: `1px solid ${color}22`,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'all 0.25s cubic-bezier(0.4,0,0.2,1)',
        position: 'relative', overflow: 'hidden',
        minWidth: 170, flex: '0 0 auto',
        animation: 'scaleIn 0.3s cubic-bezier(0.22,1,0.36,1) both',
      }}
      onMouseEnter={e => {
        const d = e.currentTarget as HTMLDivElement;
        d.style.transform = 'translateY(-4px) scale(1.02)';
        d.style.boxShadow = `0 16px 48px ${color}28, 0 0 0 1px ${color}30`;
        d.style.borderColor = `${color}44`;
      }}
      onMouseLeave={e => {
        const d = e.currentTarget as HTMLDivElement;
        d.style.transform = '';
        d.style.boxShadow = '';
        d.style.borderColor = `${color}22`;
      }}
    >
      {/* Arka plan ikon */}
      <div style={{ position: 'absolute', top: -16, right: -10, fontSize: '5.5rem', opacity: 0.05, pointerEvents: 'none', transform: 'rotate(-8deg)', filter: 'blur(1px)' }}>{icon}</div>
      {/* Üst çizgi aksan */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, transparent, ${color}60, transparent)`, borderRadius: '16px 16px 0 0' }} />
      <div style={{ fontSize: '1.4rem', marginBottom: 10 }}>{icon}</div>
      <div style={{ fontSize: '1.75rem', fontWeight: 900, color, letterSpacing: '-0.03em', lineHeight: 1, animation: 'countUp 0.4s ease both' }}>{value}</div>
      {trend !== undefined && (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: '0.72rem', color: trend >= 0 ? '#10b981' : '#ef4444', fontWeight: 700, marginTop: 4, background: trend >= 0 ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)', borderRadius: 5, padding: '2px 6px' }}>
          {trend >= 0 ? '▲' : '▼'} {Math.abs(trend).toFixed(1)}% dün
        </div>
      )}
      <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 7 }}>{label}</div>
      {sub && <div style={{ color: 'rgba(255,255,255,0.25)', fontSize: '0.73rem', marginTop: 3 }}>{sub}</div>}
      {onClick && <div style={{ position: 'absolute', bottom: 12, right: 14, color: `${color}50`, fontSize: '0.9rem', transition: 'color 0.2s' }}>→</div>}
    </div>
  );
}

function ScrollableCards({ cards, onTabChange }: { cards: StatCardData[]; onTabChange: (tab: string) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, scroll: 0 });

  const updateArrows = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 10);
    setCanRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 10);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateArrows();
    el.addEventListener('scroll', updateArrows, { passive: true });
    const ro = new ResizeObserver(updateArrows);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', updateArrows); ro.disconnect(); };
  }, [updateArrows]);

  const scroll = (dir: number) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * 220, behavior: 'smooth' });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    setIsDragging(true);
    dragStart.current = { x: e.clientX, scroll: scrollRef.current?.scrollLeft || 0 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!isDragging || !scrollRef.current) return;
    const dx = e.clientX - dragStart.current.x;
    scrollRef.current.scrollLeft = dragStart.current.scroll - dx;
  };
  const onPointerUp = () => setIsDragging(false);

  const navBtn = (dir: number, show: boolean): React.CSSProperties => ({
    position: 'absolute', top: '50%', [dir < 0 ? 'left' : 'right']: -6,
    transform: 'translateY(-50%)', zIndex: 10,
    width: 36, height: 36, borderRadius: '50%',
    background: show ? 'rgba(255,87,34,0.9)' : 'transparent',
    border: show ? '2px solid rgba(255,255,255,0.2)' : 'none',
    color: '#fff', fontSize: '1.1rem', fontWeight: 900,
    cursor: show ? 'pointer' : 'default',
    opacity: show ? 1 : 0, transition: 'all 0.3s',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    boxShadow: show ? '0 4px 16px rgba(255,87,34,0.4)' : 'none',
    pointerEvents: show ? 'auto' : 'none',
  });

  return (
    <div style={{ position: 'relative', marginBottom: 20 }}>
      <button style={navBtn(-1, canLeft)} onClick={() => scroll(-1)}>‹</button>
      <button style={navBtn(1, canRight)} onClick={() => scroll(1)}>›</button>
      <div
        ref={scrollRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        className="stat-card-scroll"
        style={{
          display: 'flex', gap: 14, overflowX: 'auto', scrollSnapType: 'x mandatory',
          padding: '4px 2px', scrollbarWidth: 'none',
          cursor: isDragging ? 'grabbing' : 'grab',
          WebkitOverflowScrolling: 'touch',
          maskImage: `linear-gradient(to right, ${canLeft ? 'transparent 0%, black 5%' : 'black 0%'}, ${canRight ? 'black 95%, transparent 100%' : 'black 100%'})`,
        }}
      >
        {cards.map((card, i) => (
          <div key={i} style={{ scrollSnapAlign: 'start', flex: '0 0 auto' }}>
            <StatCard {...card} onClick={card.tab ? () => onTabChange(card.tab!) : undefined} />
          </div>
        ))}
      </div>
    </div>
  );
}

const WIDGET_OPTIONS = [
  { id: 'chart', icon: '📈', label: 'Performans Grafiği' },
  { id: 'quickStats', icon: '📊', label: 'Hızlı Özet' },
  { id: 'recentSales', icon: '🛒', label: 'Son Satışlar' },
  { id: 'tips', icon: '💡', label: 'Akıllı Öneriler' },
  { id: 'stockAlerts', icon: '⚠️', label: 'Stok Uyarıları' },
  { id: 'activity', icon: '📋', label: 'Son Aktiviteler' },
  { id: 'excelBar', icon: '📊', label: 'Excel İndir' },
  { id: 'categoryChart', icon: '🍩', label: 'Kategori Dağılımı' },
  { id: 'kasaSayim', icon: '🏦', label: 'Gün Sonu Kasa Sayımı' },
  { id: 'yedekHatirlatma', icon: '💾', label: 'Yedek Hatırlatma' },
] as const;

type WidgetId = typeof WIDGET_OPTIONS[number]['id'];

function loadDashboardPrefs(): { leftWidgets: WidgetId[]; brightness: number } {
  try {
    const raw = localStorage.getItem('dashboardPrefs');
    if (raw) return JSON.parse(raw);
  } catch {}
  return { leftWidgets: ['chart', 'recentSales', 'tips', 'excelBar'], brightness: 100 };
}

function getDashboardPrefsUrl(): string | null {
  const cfg = loadConnConfig();
  if (!cfg.firebase.enabled || !cfg.firebase.projectId || !cfg.firebase.apiKey) return null;
  return `https://firestore.googleapis.com/v1/projects/${cfg.firebase.projectId}/databases/(default)/documents/config/dashboardPrefs?key=${cfg.firebase.apiKey}`;
}

function saveDashboardPrefs(prefs: { leftWidgets: WidgetId[]; brightness: number }) {
  localStorage.setItem('dashboardPrefs', JSON.stringify(prefs));
  // Arka planda Firebase'e de yaz
  const url = getDashboardPrefsUrl();
  if (!url) return;
  fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { data: { stringValue: JSON.stringify(prefs) }, updatedAt: { stringValue: new Date().toISOString() } } }),
    signal: AbortSignal.timeout(8000),
  }).catch(() => {});
}

async function loadDashboardPrefsFromFirebase(): Promise<{ leftWidgets: WidgetId[]; brightness: number } | null> {
  try {
    const url = getDashboardPrefsUrl();
    if (!url) return null;
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const json = await res.json();
    const raw = json?.fields?.data?.stringValue;
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

const chartStyle = {
  contentStyle: { background: '#0f1e35', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, fontSize: '0.82rem' },
  labelStyle: { color: '#94a3b8' },
};

export default function Dashboard({ db, onTabChange, save }: Props) {
  const [prefs, setPrefs] = useState(loadDashboardPrefs);

  // Açılışta Firebase'den en güncel prefs'i çek
  useEffect(() => {
    loadDashboardPrefsFromFirebase().then(fbPrefs => {
      if (fbPrefs) {
        setPrefs(fbPrefs);
        localStorage.setItem('dashboardPrefs', JSON.stringify(fbPrefs));
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [backupPanel, setBackupPanel] = useState(false);
  const [backups, setBackups] = useState<{ id: string; version: number; label: string; createdAt: string }[]>([]);
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupMsg, setBackupMsg] = useState('');
  const [manualLabel, setManualLabel] = useState('');

  const openBackupPanel = async () => {
    setBackupPanel(true);
    setBackupLoading(true);
    const list = await listBackupsFromFirebase();
    setBackups(list);
    setBackupLoading(false);
  };

  const doManualBackup = async () => {
    setBackupLoading(true);
    const label = manualLabel.trim() || `manuel_${new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-')}`;
    const ok = await saveBackupToFirebase(db, label);
    setBackupMsg(ok ? '✅ Yedek alındı!' : '❌ Yedek alınamadı');
    setManualLabel('');
    const list = await listBackupsFromFirebase();
    setBackups(list);
    setBackupLoading(false);
    setTimeout(() => setBackupMsg(''), 3000);
  };

  const doRestore = async (backupId: string) => {
    if (!confirm(`"${backupId}" yedeğini geri yüklemek istediğinizden emin misiniz? Mevcut veriler değişecek.`)) return;
    setBackupLoading(true);

    // Geri yükleme öncesi mevcut veriyi otomatik yedekle
    const preRestoreLabel = `onceki_${new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-')}`;
    await saveBackupToFirebase(db, preRestoreLabel).catch(() => {});

    const restored = await restoreBackupFromFirebase(backupId);
    if (restored) {
      // makeDefaultDB ile merge ederek eksik alanları tamamla
      save(prev => {
        const merged = { ...prev, ...restored };
        // Zorunlu array alanları boşsa koru
        const arrayKeys = ['products','sales','suppliers','orders','cari','kasa','bankTransactions',
          'matchRules','monitorRules','monitorLog','stockMovements','peletSuppliers','peletOrders',
          'boruSuppliers','boruOrders','invoices','budgets','returns','_activityLog',
          'ortakEmanetler','installments','partners','notes'] as const;
        for (const key of arrayKeys) {
          if (!Array.isArray(merged[key])) (merged as Record<string, unknown>)[key] = prev[key] ?? [];
        }
        return merged;
      });
      // Firebase'e de yaz (save() debounce'u beklemeden hemen)
      setTimeout(() => saveBackupToFirebase(restored, `restore_sonrasi_${backupId.slice(0, 20)}`).catch(() => {}), 1500);
      setBackupMsg('✅ Geri yükleme başarılı! Önceki veri otomatik yedeklendi.');
    } else {
      setBackupMsg('❌ Geri yükleme başarısız');
    }
    setBackupLoading(false);
    setTimeout(() => setBackupMsg(''), 5000);
  };

  const updatePrefs = (patch: Partial<{ leftWidgets: WidgetId[]; brightness: number }>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    saveDashboardPrefs(next);
  };

  const stats = useMemo(() => {
    const todayStr = new Date().toLocaleDateString('sv-SE');
    const todaySales = db.sales.filter(s => !s.deleted && s.status === 'tamamlandi' && s.createdAt.slice(0, 10) === todayStr);
    const todayRevenue = todaySales.reduce((s, sale) => s + sale.total, 0);
    const todayProfit = todaySales.reduce((s, sale) => s + sale.profit, 0);

    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    const yestStr = yesterday.toLocaleDateString('sv-SE');
    const yestSales = db.sales.filter(s => !s.deleted && s.status === 'tamamlandi' && s.createdAt.slice(0, 10) === yestStr);
    const yestRevenue = yestSales.reduce((s, sale) => s + sale.total, 0);
    const revTrend = yestRevenue > 0 ? ((todayRevenue - yestRevenue) / yestRevenue) * 100 : 0;

    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const monthSales = db.sales.filter(s => !s.deleted && s.status === 'tamamlandi' && new Date(s.createdAt) >= monthStart);
    const monthRevenue = monthSales.reduce((s, sale) => s + sale.total, 0);
    const monthProfit = monthSales.reduce((s, sale) => s + sale.profit, 0);

    const outOfStock = db.products.filter(p => !p.deleted && p.stock === 0).length;
    const lowStock = db.products.filter(p => !p.deleted && p.stock > 0 && p.stock <= p.minStock).length;

    const activeKasa = db.kasa.filter(k => !k.deleted);
    const totalKasa = activeKasa.reduce((s, k) => s + (k.type === 'gelir' ? k.amount : -k.amount), 0);
    const nakit = activeKasa.filter(k => k.kasa === 'nakit').reduce((s, k) => s + (k.type === 'gelir' ? k.amount : -k.amount), 0);
    const banka = activeKasa.filter(k => k.kasa === 'banka').reduce((s, k) => s + (k.type === 'gelir' ? k.amount : -k.amount), 0);

    const pendingOrders = db.orders.filter(o => o.status === 'bekliyor').length;
    const totalReceivable = db.cari.filter(c => !c.deleted && c.type === 'musteri' && c.balance > 0).reduce((s, c) => s + c.balance, 0);
    const totalPayable = db.cari.filter(c => !c.deleted && c.type === 'tedarikci' && c.balance > 0).reduce((s, c) => s + c.balance, 0);
    const posToplamı = activeKasa.filter(k => ['pos_ziraat', 'pos_is', 'pos_yk'].includes(k.kasa)).reduce((s, k) => s + (k.type === 'gelir' ? k.amount : -k.amount), 0);
    const netSermaye = nakit + banka + posToplamı + totalReceivable - totalPayable;
    const stokDeger = db.products.filter(p => !p.deleted).reduce((s, p) => s + p.cost * p.stock, 0);

    return { todayRevenue, todayProfit, todaySalesCount: todaySales.length, monthRevenue, monthProfit, outOfStock, lowStock, totalKasa, nakit, banka, pendingOrders, totalReceivable, totalPayable, netSermaye, stokDeger, revTrend };
  }, [db]);

  const statCards: StatCardData[] = useMemo(() => [
    { icon: '💰', label: 'Bugün Ciro', value: formatMoney(stats.todayRevenue), color: '#10b981', gradient: 'rgba(16,185,129,0.12) 0%, rgba(16,185,129,0.04) 100%', sub: `${stats.todaySalesCount} satış`, tab: 'sales', trend: stats.revTrend },
    { icon: '📈', label: 'Bugün Kâr', value: formatMoney(stats.todayProfit), color: '#3b82f6', gradient: 'rgba(59,130,246,0.12) 0%, rgba(59,130,246,0.04) 100%', sub: `${stats.todayRevenue > 0 ? ((stats.todayProfit / stats.todayRevenue) * 100).toFixed(1) : 0}% marj` },
    { icon: '📅', label: 'Bu Ay Ciro', value: formatMoney(stats.monthRevenue), color: '#8b5cf6', gradient: 'rgba(139,92,246,0.12) 0%, rgba(139,92,246,0.04) 100%', sub: `Kâr: ${formatMoney(stats.monthProfit)}` },
    { icon: '📦', label: 'Stok Değeri', value: formatMoney(stats.stokDeger), color: '#f59e0b', gradient: 'rgba(245,158,11,0.12) 0%, rgba(245,158,11,0.04) 100%', tab: 'stock', sub: `${db.products.filter(p => !p.deleted).length} ürün` },
    { icon: '💵', label: 'Nakit Kasa', value: formatMoney(stats.nakit), color: '#06b6d4', gradient: 'rgba(6,182,212,0.12) 0%, rgba(6,182,212,0.04) 100%', tab: 'kasa' },
    { icon: '🏦', label: 'Banka', value: formatMoney(stats.banka), color: '#6366f1', gradient: 'rgba(99,102,241,0.12) 0%, rgba(99,102,241,0.04) 100%', tab: 'kasa' },
    { icon: '📋', label: 'Alacak', value: formatMoney(stats.totalReceivable), color: '#ff5722', gradient: 'rgba(255,87,34,0.12) 0%, rgba(255,87,34,0.04) 100%', tab: 'cari' },
    { icon: '⚠️', label: 'Stok Uyarısı', value: `${stats.outOfStock + stats.lowStock}`, color: '#ef4444', gradient: 'rgba(239,68,68,0.12) 0%, rgba(245,158,11,0.06) 100%', tab: 'products', sub: `${stats.outOfStock} bitti · ${stats.lowStock} az` },
  ], [stats, db.products.length]);

  const chartData = useMemo(() => {
    const days: Record<string, { revenue: number; profit: number; count: number }> = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' });
      days[key] = { revenue: 0, profit: 0, count: 0 };
    }
    db.sales.filter(s => !s.deleted && s.status === 'tamamlandi').forEach(s => {
      const diff = Math.floor((Date.now() - new Date(s.createdAt).getTime()) / 86400000);
      if (diff <= 6) {
        const key = new Date(s.createdAt).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' });
        if (days[key]) { days[key].revenue += s.total; days[key].profit += s.profit; days[key].count++; }
      }
    });
    return Object.entries(days).map(([date, v]) => ({ date, ...v }));
  }, [db.sales]);

  const categoryRevenue = useMemo(() => {
    const map: Record<string, number> = {};
    db.sales.filter(s => !s.deleted && s.status === 'tamamlandi').forEach(s => {
      const cat = s.productCategory || 'Diğer';
      map[cat] = (map[cat] || 0) + s.total;
    });
    const cats = db.productCategories || [];
    return Object.entries(map).map(([id, value]) => ({
      name: cats.find(c => c.id === id)?.name || id,
      value,
    }));
  }, [db.sales, db.productCategories]);

  const recentSales = [...db.sales].filter(s => !s.deleted).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 8);
  const recentActivity = [...db._activityLog].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()).slice(0, 6);

  const toggleWidget = (id: WidgetId) => {
    const list = prefs.leftWidgets.includes(id)
      ? prefs.leftWidgets.filter(w => w !== id)
      : [...prefs.leftWidgets, id];
    updatePrefs({ leftWidgets: list });
  };

  const moveWidget = (id: WidgetId, dir: number) => {
    const list = [...prefs.leftWidgets];
    const idx = list.indexOf(id);
    if (idx < 0) return;
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= list.length) return;
    [list[idx], list[newIdx]] = [list[newIdx], list[idx]];
    updatePrefs({ leftWidgets: list });
  };

  const renderWidget = (id: WidgetId) => {
    switch (id) {
      case 'chart':
        return (
          <WidgetCard title="Son 7 Günlük Performans" subtitle="Ciro ve kâr trendi" extra={
            <div style={{ display: 'flex', gap: 14 }}><LegendDot color="#ff5722" label="Ciro" /><LegendDot color="#10b981" label="Kâr" /></div>
          }>
            <ResponsiveContainer width="100%" height={190}>
              <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="ciroGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ff5722" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#ff5722" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="karGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#334155' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#334155' }} axisLine={false} tickLine={false} tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v)} />
                <Tooltip formatter={(v: number, n: string) => [formatMoney(v), n === 'revenue' ? 'Ciro' : 'Kâr']} {...chartStyle} />
                <Area type="monotone" dataKey="revenue" stroke="#ff5722" strokeWidth={2.5} fill="url(#ciroGrad)" dot={false} />
                <Area type="monotone" dataKey="profit" stroke="#10b981" strokeWidth={2.5} fill="url(#karGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </WidgetCard>
        );
      case 'quickStats':
        return (
          <WidgetCard title="📊 Hızlı Özet" subtitle="Genel durum">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <QuickStat label="Toplam Ürün" value={String(db.products.filter(p => !p.deleted).length)} color="#3b82f6" icon="📦" />
              <QuickStat label="Toplam Satış" value={String(db.sales.filter(s => !s.deleted && s.status === 'tamamlandi').length)} color="#10b981" icon="🛒" />
              <QuickStat label="Tedarikçi" value={String(db.suppliers.length)} color="#f59e0b" icon="🏭" />
              <QuickStat label="Cari Müşteri" value={String(db.cari.filter(c => !c.deleted && c.type === 'musteri').length)} color="#8b5cf6" icon="👤" />
              <QuickStat label="Bek. Sipariş" value={String(stats.pendingOrders)} color="#ef4444" icon="📋" />
            </div>
          </WidgetCard>
        );
      case 'recentSales':
        return (
          <WidgetCard title="🛒 Son Satışlar" subtitle={`${db.sales.length} toplam kayıt`} extra={
            <button onClick={() => onTabChange('sales')} style={{ background: 'rgba(255,87,34,0.1)', border: '1px solid rgba(255,87,34,0.2)', borderRadius: 8, color: '#ff7043', padding: '5px 12px', cursor: 'pointer', fontWeight: 700, fontSize: '0.78rem' }}>Tümü →</button>
          }>
            {recentSales.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '32px 0', color: '#1e3a5f' }}>
                <div style={{ fontSize: '2.5rem', marginBottom: 8 }}>🛒</div>
                <p style={{ fontSize: '0.85rem' }}>Henüz satış yok</p>
              </div>
            ) : recentSales.map((s, i) => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: i > 0 ? '1px solid rgba(255,255,255,0.03)' : 'none', transition: 'background 0.15s' }}>
                <div style={{ width: 34, height: 34, background: s.status === 'tamamlandi' ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)', borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.9rem', flexShrink: 0 }}>
                  {s.status === 'tamamlandi' ? '✓' : '↩'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.productName}</div>
                  <div style={{ color: '#334155', fontSize: '0.75rem', marginTop: 1 }}>{formatDate(s.createdAt)}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ color: '#10b981', fontWeight: 700, fontSize: '0.88rem' }}>{formatMoney(s.total)}</div>
                  <div style={{ color: '#1e3a5f', fontSize: '0.72rem' }}>{s.payment}</div>
                </div>
              </div>
            ))}
          </WidgetCard>
        );
      case 'tips':
        return <Oneriler db={db} onTabChange={onTabChange} />;
      case 'stockAlerts':
        if (stats.outOfStock === 0 && stats.lowStock === 0) return null;
        return (
          <WidgetCard title="⚠️ Stok Uyarıları" subtitle="" extra={
            <button onClick={() => onTabChange('products')} style={{ background: 'rgba(239,68,68,0.15)', border: 'none', borderRadius: 6, color: '#f87171', padding: '3px 10px', cursor: 'pointer', fontWeight: 600, fontSize: '0.75rem' }}>Görüntüle →</button>
          }>
            {stats.outOfStock > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', flexShrink: 0 }} />
                <span style={{ color: '#94a3b8', fontSize: '0.83rem' }}><strong style={{ color: '#f87171' }}>{stats.outOfStock} ürün</strong> stok bitti</span>
              </div>
            )}
            {stats.lowStock > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#f59e0b', flexShrink: 0 }} />
                <span style={{ color: '#94a3b8', fontSize: '0.83rem' }}><strong style={{ color: '#fbbf24' }}>{stats.lowStock} üründe</strong> az stok uyarısı</span>
              </div>
            )}
          </WidgetCard>
        );
      case 'activity':
        return (
          <WidgetCard title="📋 Son Aktiviteler" subtitle="">
            {recentActivity.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px 0', color: '#1e3a5f', fontSize: '0.83rem' }}>Aktivite bulunamadı</div>
            ) : recentActivity.map((a) => (
              <div key={a.id} style={{ display: 'flex', gap: 10, padding: '8px 0', alignItems: 'flex-start' }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#334155', flexShrink: 0, marginTop: 6 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ color: '#94a3b8', fontSize: '0.83rem', lineHeight: 1.4 }}>{a.action}</div>
                  {a.detail && <div style={{ color: '#334155', fontSize: '0.75rem', marginTop: 1 }}>{a.detail}</div>}
                </div>
                <div style={{ color: '#334155', fontSize: '0.72rem', whiteSpace: 'nowrap' }}>{formatDate(a.time)}</div>
              </div>
            ))}
          </WidgetCard>
        );
      case 'excelBar':
        return (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', background: 'linear-gradient(135deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))', borderRadius: 14, border: '1px solid rgba(255,255,255,0.07)', padding: '14px 18px' }}>
            <span style={{ color: '#475569', fontSize: '0.82rem', fontWeight: 600 }}>📊 Excel İndir:</span>
            {[
              { label: 'Tüm Rapor', sheets: ['stok', 'satislar', 'cari', 'kasa'] as ('stok' | 'satislar' | 'cari' | 'kasa')[], color: '#ff5722' },
              { label: 'Satışlar', sheets: ['satislar'] as ('stok' | 'satislar' | 'cari' | 'kasa')[], color: '#10b981' },
              { label: 'Stok', sheets: ['stok'] as ('stok' | 'satislar' | 'cari' | 'kasa')[], color: '#3b82f6' },
              { label: 'Kasa', sheets: ['kasa'] as ('stok' | 'satislar' | 'cari' | 'kasa')[], color: '#f59e0b' },
            ].map(btn => (
              <button key={btn.label} onClick={() => exportToExcel(db, { sheets: btn.sheets })} style={{ padding: '7px 14px', background: `${btn.color}15`, border: `1px solid ${btn.color}30`, borderRadius: 8, color: btn.color, fontWeight: 700, cursor: 'pointer', fontSize: '0.82rem' }}>
                {btn.label}
              </button>
            ))}
          </div>
        );
      case 'categoryChart':
        if (categoryRevenue.length === 0) return null;
        return (
          <WidgetCard title="🍩 Kategori Dağılımı" subtitle="Satış kategorileri">
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={categoryRevenue.slice(0, 6)} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#475569' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#334155' }} axisLine={false} tickLine={false} tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v)} />
                <Tooltip formatter={(v: number) => [formatMoney(v), 'Ciro']} {...chartStyle} />
                <Bar dataKey="value" fill="#ff5722" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </WidgetCard>
        );
      case 'kasaSayim':
        return <KasaSayimWidget db={db} />;
      case 'yedekHatirlatma':
        return <YedekHatirlatmaWidget />;
      default:
        return null;
    }
  };

  const [contentWidth, setContentWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1400);
  useEffect(() => {
    const onResize = () => setContentWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const showSidePanel = contentWidth >= 1100;

  return (
    <div style={{ animation: 'fadeIn 0.3s ease', filter: `brightness(${prefs.brightness / 100})` }}>
      <ScrollableCards cards={statCards} onTabChange={onTabChange} />

      {/* Versiyon Sayacı + Yedek Butonu */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '7px 14px' }}>
          <span style={{ fontSize: '0.75rem', color: '#475569', fontWeight: 600 }}>VERSİYON</span>
          <span style={{ fontSize: '1rem', fontWeight: 900, color: '#ff7043' }}>v{db._version || 0}</span>
        </div>
        {(() => {
          try {
            const raw = localStorage.getItem('sobaYonetim') || '';
            const sizeMB = raw.length / (1024 * 1024);
            const maxMB = 10;
            const pct = Math.min(100, (sizeMB / maxMB) * 100);
            const color = pct > 70 ? '#ef4444' : pct > 40 ? '#f59e0b' : '#10b981';
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.03)', border: `1px solid ${color}30`, borderRadius: 10, padding: '7px 14px' }}>
                <span style={{ fontSize: '0.75rem', color: '#475569', fontWeight: 600 }}>DEPOLAMA</span>
                <span style={{ fontSize: '0.88rem', fontWeight: 700, color }}>{sizeMB.toFixed(2)} MB</span>
                <div style={{ width: 48, height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.3s' }} />
                </div>
                <span style={{ fontSize: '0.72rem', color: '#475569' }}>%{pct.toFixed(0)}</span>
              </div>
            );
          } catch { return null; }
        })()}
        <button
          onClick={openBackupPanel}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 10, padding: '7px 14px', color: '#10b981', fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer' }}
        >
          💾 Yedek Yönetimi
        </button>
      </div>

      {/* Yedek Paneli */}
      {backupPanel && (
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: '20px', marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <span style={{ fontWeight: 800, color: '#f1f5f9', fontSize: '0.95rem' }}>💾 Yedek Yönetimi</span>
            <button onClick={() => setBackupPanel(false)} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '1.1rem' }}>✕</button>
          </div>
          {/* Manuel yedek al */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <input
              value={manualLabel}
              onChange={e => setManualLabel(e.target.value)}
              placeholder="Yedek adı (opsiyonel)"
              style={{ flex: 1, padding: '9px 12px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, color: '#f1f5f9', fontSize: '0.85rem', outline: 'none' }}
            />
            <button
              onClick={doManualBackup}
              disabled={backupLoading}
              style={{ padding: '9px 16px', background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 10, color: '#10b981', fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer' }}
            >
              {backupLoading ? '...' : '+ Yedek Al'}
            </button>
          </div>
          {backupMsg && <div style={{ marginBottom: 12, color: backupMsg.startsWith('✅') ? '#10b981' : '#ef4444', fontSize: '0.85rem', fontWeight: 600 }}>{backupMsg}</div>}
          {/* Yedek listesi */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 280, overflowY: 'auto' }}>
            {backupLoading && backups.length === 0 && <div style={{ color: '#475569', fontSize: '0.85rem' }}>Yükleniyor...</div>}
            {!backupLoading && backups.length === 0 && <div style={{ color: '#475569', fontSize: '0.85rem' }}>Henüz yedek yok</div>}
            {backups.map(b => (
              <div key={b.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(0,0,0,0.2)', borderRadius: 10, padding: '10px 14px' }}>
                <div>
                  <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: '0.85rem' }}>{b.label || b.id}</div>
                  <div style={{ color: '#475569', fontSize: '0.75rem' }}>v{b.version} · {b.createdAt ? new Date(b.createdAt).toLocaleString('tr-TR') : ''}</div>
                </div>
                <button
                  onClick={() => doRestore(b.id)}
                  style={{ padding: '6px 12px', background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.25)', borderRadius: 8, color: '#60a5fa', fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer' }}
                >
                  🔄 Tam Geri Yükle
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Gün Sonu Kontrol Formülü */}
      <div style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.08), rgba(59,130,246,0.06))', borderRadius: 16, border: '1px solid rgba(16,185,129,0.2)', padding: '18px 22px', marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <span style={{ fontSize: '1.1rem' }}>⚖️</span>
          <span style={{ fontWeight: 800, color: '#f1f5f9', fontSize: '0.95rem' }}>Gün Sonu Dengesi</span>
          <span style={{ marginLeft: 'auto', color: '#64748b', fontSize: '0.75rem' }}>Kasa + Banka + Alacak − Borç = Net Sermaye</span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <FormulaItem label="Nakit Kasa" value={stats.nakit} color="#06b6d4" />
          <span style={{ color: '#334155', fontWeight: 700, fontSize: '1.1rem' }}>+</span>
          <FormulaItem label="Banka" value={stats.banka} color="#6366f1" />
          <span style={{ color: '#334155', fontWeight: 700, fontSize: '1.1rem' }}>+</span>
          <FormulaItem label="Müşteri Alacağı" value={stats.totalReceivable} color="#10b981" />
          <span style={{ color: '#ef4444', fontWeight: 700, fontSize: '1.1rem' }}>−</span>
          <FormulaItem label="Tedarikçi Borcu" value={stats.totalPayable} color="#ef4444" />
          <span style={{ color: '#334155', fontWeight: 700, fontSize: '1.1rem' }}>=</span>
          <div style={{ background: stats.netSermaye >= 0 ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)', border: `1px solid ${stats.netSermaye >= 0 ? 'rgba(16,185,129,0.4)' : 'rgba(239,68,68,0.4)'}`, borderRadius: 10, padding: '10px 16px', textAlign: 'center' }}>
            <div style={{ color: '#64748b', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', marginBottom: 3 }}>Net Sermaye</div>
            <div style={{ color: stats.netSermaye >= 0 ? '#10b981' : '#ef4444', fontWeight: 900, fontSize: '1.2rem' }}>{formatMoney(stats.netSermaye)}</div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: showSidePanel ? 'minmax(0, 1fr) 260px' : '1fr', gap: 18 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0, overflow: 'hidden' }}>
          {prefs.leftWidgets.map(id => {
            const widget = renderWidget(id);
            if (!widget) return null;
            return <div key={id}>{widget}</div>;
          })}

          {prefs.leftWidgets.length === 0 && (
            <div style={{ textAlign: 'center', padding: '60px 20px', background: 'rgba(255,255,255,0.02)', borderRadius: 18, border: '2px dashed rgba(255,255,255,0.08)' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>🧩</div>
              <div style={{ color: '#475569', fontSize: '0.9rem', fontWeight: 600 }}>Widget alanı boş</div>
              <div style={{ color: '#334155', fontSize: '0.82rem', marginTop: 4 }}>Sağ panelden widget ekleyin</div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))', borderRadius: 16, border: '1px solid rgba(255,255,255,0.08)', padding: '18px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <span style={{ fontSize: '1.1rem' }}>☀️</span>
              <span style={{ fontWeight: 700, color: '#f1f5f9', fontSize: '0.9rem' }}>Parlaklık</span>
              <span style={{ marginLeft: 'auto', color: '#ff7043', fontWeight: 700, fontSize: '0.85rem' }}>{prefs.brightness}%</span>
            </div>
            <input
              type="range" min={40} max={120} value={prefs.brightness}
              onChange={e => updatePrefs({ brightness: Number(e.target.value) })}
              style={{ width: '100%', accentColor: '#ff5722', cursor: 'pointer' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
              <span style={{ color: '#334155', fontSize: '0.72rem' }}>🌙 Karanlık</span>
              <span style={{ color: '#334155', fontSize: '0.72rem' }}>☀️ Parlak</span>
            </div>
            {prefs.brightness !== 100 && (
              <button onClick={() => updatePrefs({ brightness: 100 })} style={{ width: '100%', marginTop: 10, padding: '7px 0', background: 'rgba(255,87,34,0.1)', border: '1px solid rgba(255,87,34,0.2)', borderRadius: 8, color: '#ff7043', cursor: 'pointer', fontWeight: 600, fontSize: '0.78rem' }}>
                Sıfırla (100%)
              </button>
            )}
          </div>

          <div style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))', borderRadius: 16, border: '1px solid rgba(255,255,255,0.08)', padding: '18px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <span style={{ fontSize: '1.1rem' }}>🧩</span>
              <span style={{ fontWeight: 700, color: '#f1f5f9', fontSize: '0.9rem' }}>Widget Yönetimi</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {WIDGET_OPTIONS.map(w => {
                const active = prefs.leftWidgets.includes(w.id);
                const idx = prefs.leftWidgets.indexOf(w.id);
                return (
                  <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: active ? 'rgba(255,87,34,0.06)' : 'rgba(0,0,0,0.2)', borderRadius: 10, border: `1px solid ${active ? 'rgba(255,87,34,0.15)' : 'rgba(255,255,255,0.04)'}`, transition: 'all 0.2s' }}>
                    <span style={{ fontSize: '0.9rem' }}>{w.icon}</span>
                    <span style={{ flex: 1, color: active ? '#f1f5f9' : '#475569', fontSize: '0.78rem', fontWeight: 600 }}>{w.label}</span>
                    {active && (
                      <div style={{ display: 'flex', gap: 2 }}>
                        <button onClick={() => moveWidget(w.id, -1)} disabled={idx === 0} style={{ width: 22, height: 22, border: 'none', borderRadius: 4, background: idx === 0 ? 'transparent' : 'rgba(255,255,255,0.06)', color: idx === 0 ? '#1e293b' : '#64748b', cursor: idx === 0 ? 'default' : 'pointer', fontSize: '0.7rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>▲</button>
                        <button onClick={() => moveWidget(w.id, 1)} disabled={idx === prefs.leftWidgets.length - 1} style={{ width: 22, height: 22, border: 'none', borderRadius: 4, background: idx === prefs.leftWidgets.length - 1 ? 'transparent' : 'rgba(255,255,255,0.06)', color: idx === prefs.leftWidgets.length - 1 ? '#1e293b' : '#64748b', cursor: idx === prefs.leftWidgets.length - 1 ? 'default' : 'pointer', fontSize: '0.7rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>▼</button>
                      </div>
                    )}
                    <button onClick={() => toggleWidget(w.id)} style={{ width: 28, height: 28, border: `1px solid ${active ? 'rgba(239,68,68,0.3)' : 'rgba(16,185,129,0.3)'}`, borderRadius: 6, background: active ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)', color: active ? '#ef4444' : '#10b981', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {active ? '−' : '+'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))', borderRadius: 16, border: '1px solid rgba(255,255,255,0.08)', padding: '18px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span style={{ fontSize: '1.1rem' }}>⚡</span>
              <span style={{ fontWeight: 700, color: '#f1f5f9', fontSize: '0.9rem' }}>Hızlı İşlemler</span>
            </div>
            <div style={{ display: 'grid', gap: 6 }}>
              {[
                { label: 'Yeni Satış', icon: '🛒', tab: 'sales', color: '#10b981' },
                { label: 'Ürün Ekle', icon: '📦', tab: 'products', color: '#3b82f6' },
                { label: 'Fatura Oluştur', icon: '🧾', tab: 'fatura', color: '#8b5cf6' },
                { label: 'Kasa İşlemi', icon: '💰', tab: 'kasa', color: '#f59e0b' },
                { label: 'Raporlar', icon: '📈', tab: 'reports', color: '#06b6d4' },
              ].map(q => (
                <button key={q.tab} onClick={() => onTabChange(q.tab)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', background: `${q.color}08`, border: `1px solid ${q.color}18`, borderRadius: 10, color: q.color, cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem', transition: 'all 0.15s', width: '100%', textAlign: 'left' }}
                  onMouseEnter={e => (e.currentTarget.style.background = `${q.color}15`)}
                  onMouseLeave={e => (e.currentTarget.style.background = `${q.color}08`)}>
                  <span style={{ fontSize: '0.95rem' }}>{q.icon}</span>
                  {q.label}
                  <span style={{ marginLeft: 'auto', opacity: 0.5 }}>→</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Gün Sonu Kasa Sayımı Widget ──────────────────────────────────────────────
function KasaSayimWidget({ db }: { db: DB }) {
  const [sayimlar, setSayimlar] = useState<Record<string, string>>({});
  const [kaydedildi, setKaydedildi] = useState(false);

  const kasalar = db.kasalar || [{ id: 'nakit', name: 'Nakit', icon: '💵' }, { id: 'banka', name: 'Banka', icon: '🏦' }];

  const sistemBakiyeleri = kasalar.reduce((acc, k) => {
    acc[k.id] = db.kasa.filter(e => !e.deleted && e.kasa === k.id)
      .reduce((s, e) => s + (e.type === 'gelir' ? e.amount : -e.amount), 0);
    return acc;
  }, {} as Record<string, number>);

  const handleKaydet = () => {
    const farklar = kasalar.map(k => {
      const sayilan = parseFloat(sayimlar[k.id] || '0') || 0;
      const sistem = sistemBakiyeleri[k.id] || 0;
      return { kasa: k.name, sayilan, sistem, fark: sayilan - sistem };
    });
    const log = `Gün Sonu Sayım — ${new Date().toLocaleString('tr-TR')}\n` +
      farklar.map(f => `${f.kasa}: Sayılan ${formatMoney(f.sayilan)} | Sistem ${formatMoney(f.sistem)} | Fark ${f.fark >= 0 ? '+' : ''}${formatMoney(f.fark)}`).join('\n');
    console.info('[Kasa Sayım]', log);
    setKaydedildi(true);
    setTimeout(() => setKaydedildi(false), 3000);
  };

  return (
    <WidgetCard title="🏦 Gün Sonu Kasa Sayımı" subtitle="Fiziksel sayım vs sistem">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {kasalar.map(k => {
          const sistem = sistemBakiyeleri[k.id] || 0;
          const sayilan = parseFloat(sayimlar[k.id] || '') || 0;
          const fark = sayimlar[k.id] !== undefined ? sayilan - sistem : null;
          return (
            <div key={k.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 10, alignItems: 'center', background: 'rgba(0,0,0,0.2)', borderRadius: 10, padding: '10px 12px' }}>
              <div>
                <div style={{ color: '#94a3b8', fontSize: '0.78rem', fontWeight: 600 }}>{k.icon} {k.name}</div>
                <div style={{ color: '#475569', fontSize: '0.72rem', marginTop: 2 }}>Sistem: {formatMoney(sistem)}</div>
              </div>
              <input
                type="number" inputMode="decimal" placeholder="Sayılan tutar"
                value={sayimlar[k.id] || ''}
                onChange={e => setSayimlar(prev => ({ ...prev, [k.id]: e.target.value }))}
                style={{ padding: '7px 10px', background: 'rgba(15,23,42,0.6)', border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9', fontSize: '0.88rem', width: '100%', boxSizing: 'border-box' }}
              />
              {fark !== null && (
                <div style={{ textAlign: 'right', minWidth: 70 }}>
                  <div style={{ color: Math.abs(fark) < 1 ? '#10b981' : fark > 0 ? '#3b82f6' : '#ef4444', fontWeight: 700, fontSize: '0.82rem' }}>
                    {fark >= 0 ? '+' : ''}{formatMoney(fark)}
                  </div>
                  <div style={{ color: '#475569', fontSize: '0.65rem' }}>{Math.abs(fark) < 1 ? '✓ Eşit' : fark > 0 ? 'Fazla' : 'Eksik'}</div>
                </div>
              )}
            </div>
          );
        })}
        <button
          onClick={handleKaydet}
          style={{ padding: '10px 0', background: kaydedildi ? 'rgba(16,185,129,0.15)' : 'rgba(255,87,34,0.12)', border: `1px solid ${kaydedildi ? 'rgba(16,185,129,0.3)' : 'rgba(255,87,34,0.25)'}`, borderRadius: 10, color: kaydedildi ? '#10b981' : '#ff7043', fontWeight: 700, cursor: 'pointer', fontSize: '0.85rem', transition: 'all 0.3s' }}>
          {kaydedildi ? '✓ Sayım Kaydedildi' : '💾 Sayımı Kaydet'}
        </button>
      </div>
    </WidgetCard>
  );
}

// ── Yedek Hatırlatma Widget ───────────────────────────────────────────────────
function YedekHatirlatmaWidget() {
  const lastBackup = localStorage.getItem('sobaYonetim_lastBackup');
  const daysSince = lastBackup
    ? Math.floor((Date.now() - new Date(lastBackup).getTime()) / 86400000)
    : null;

  const handleBackup = () => {
    // exportJSON'u tetiklemek için custom event
    window.dispatchEvent(new CustomEvent('soba:exportJSON'));
    localStorage.setItem('sobaYonetim_lastBackup', new Date().toISOString());
  };

  const isUrgent = daysSince === null || daysSince >= 7;
  const isWarn = daysSince !== null && daysSince >= 3 && daysSince < 7;

  return (
    <div style={{ background: isUrgent ? 'rgba(239,68,68,0.06)' : isWarn ? 'rgba(245,158,11,0.06)' : 'rgba(16,185,129,0.06)', border: `1px solid ${isUrgent ? 'rgba(239,68,68,0.2)' : isWarn ? 'rgba(245,158,11,0.2)' : 'rgba(16,185,129,0.2)'}`, borderRadius: 14, padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
      <div style={{ fontSize: '1.8rem' }}>{isUrgent ? '⚠️' : isWarn ? '💾' : '✅'}</div>
      <div style={{ flex: 1 }}>
        <div style={{ color: '#f1f5f9', fontWeight: 700, fontSize: '0.88rem' }}>
          {daysSince === null ? 'Hiç yedek alınmadı!' : daysSince === 0 ? 'Bugün yedek alındı' : `Son yedek: ${daysSince} gün önce`}
        </div>
        <div style={{ color: '#475569', fontSize: '0.75rem', marginTop: 2 }}>
          {isUrgent ? 'Veri kaybı riskini önlemek için yedek alın' : isWarn ? 'Yakında yedek almanız önerilir' : 'Yedek durumu iyi'}
        </div>
      </div>
      <button onClick={handleBackup} style={{ background: isUrgent ? 'rgba(239,68,68,0.15)' : 'rgba(16,185,129,0.12)', border: `1px solid ${isUrgent ? 'rgba(239,68,68,0.3)' : 'rgba(16,185,129,0.25)'}`, borderRadius: 9, color: isUrgent ? '#ef4444' : '#10b981', padding: '8px 14px', cursor: 'pointer', fontWeight: 700, fontSize: '0.82rem', whiteSpace: 'nowrap' }}>
        💾 Yedek Al
      </button>
    </div>
  );
}

function WidgetCard({ title, subtitle, children, extra }: { title: string; subtitle?: string; children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(255,255,255,0.035) 0%, rgba(255,255,255,0.01) 100%)',
      borderRadius: 18, padding: '22px',
      border: '1px solid rgba(255,255,255,0.07)',
      overflow: 'hidden', minWidth: 0,
      transition: 'border-color 0.2s, box-shadow 0.2s',
      position: 'relative',
    }}
      onMouseEnter={e => { const d = e.currentTarget as HTMLDivElement; d.style.borderColor = 'rgba(255,255,255,0.12)'; d.style.boxShadow = '0 4px 24px rgba(0,0,0,0.2)'; }}
      onMouseLeave={e => { const d = e.currentTarget as HTMLDivElement; d.style.borderColor = 'rgba(255,255,255,0.07)'; d.style.boxShadow = ''; }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: subtitle ? 18 : 14 }}>
        <div>
          <h3 style={{ fontWeight: 700, color: '#f1f5f9', fontSize: '0.95rem', letterSpacing: '-0.01em' }}>{title}</h3>
          {subtitle && <p style={{ color: '#334155', fontSize: '0.75rem', marginTop: 3 }}>{subtitle}</p>}
        </div>
        {extra}
      </div>
      {children}
    </div>
  );
}

function Oneriler({ db, onTabChange }: { db: DB; onTabChange: (tab: string) => void }) {
  const tips = useMemo(() => {
    const list: { icon: string; text: string; action: string; tab: string; level: 'warn' | 'info' | 'ok' }[] = [];
    const outStock = db.products.filter(p => !p.deleted && p.stock === 0);
    const lowStock = db.products.filter(p => !p.deleted && p.stock > 0 && p.stock <= p.minStock);
    if (outStock.length > 0) list.push({ icon: '⚠️', text: `${outStock.length} ürün stok bitti: ${outStock.slice(0, 2).map(p => p.name).join(', ')}${outStock.length > 2 ? '...' : ''}`, action: 'Ürünlere Git', tab: 'products', level: 'warn' });
    if (lowStock.length > 0) list.push({ icon: '📦', text: `${lowStock.length} üründe az stok uyarısı var`, action: 'Stoka Git', tab: 'stock', level: 'warn' });

    // Gecikmiş alacak kontrolü (30+ gün)
    const overdueMusteri = db.cari.filter(c => !c.deleted && c.type === 'musteri' && c.balance > 0).map(c => {
      const lastPay = db.kasa.filter(k => !k.deleted && k.cariId === c.id && k.type === 'gelir').sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
      const lastPayDate = lastPay ? new Date(lastPay.createdAt) : null;
      const unpaidSale = db.sales.filter(s => !s.deleted && s.status === 'tamamlandi' && (s.cariId === c.id || s.customerId === c.id)).filter(s => !lastPayDate || new Date(s.createdAt) > lastPayDate).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())[0];
      const refDate = unpaidSale ? new Date(unpaidSale.createdAt) : c.lastTransaction ? new Date(c.lastTransaction) : null;
      const days = refDate ? Math.floor((Date.now() - refDate.getTime()) / 86400000) : null;
      return { ...c, days };
    }).filter(c => c.days !== null && c.days >= 30);

    if (overdueMusteri.length > 0) {
      const toplam = overdueMusteri.reduce((s, c) => s + c.balance, 0);
      const enEski = overdueMusteri.sort((a, b) => (b.days ?? 0) - (a.days ?? 0))[0];
      list.unshift({ icon: '🔴', text: `${overdueMusteri.length} müşteride ${toplam.toLocaleString('tr-TR', { style: 'currency', currency: 'TRY' })} gecikmiş alacak — en eskisi ${enEski.name} (${enEski.days}g)`, action: 'Cari Hesaplar', tab: 'cari', level: 'warn' });
    } else {
      const toplar = db.cari.filter(c => !c.deleted && c.type === 'musteri' && c.balance > 0);
      if (toplar.length > 0) list.push({ icon: '💳', text: `${toplar.length} müşteride toplam ${toplar.reduce((s, c) => s + c.balance, 0).toLocaleString('tr-TR', { style: 'currency', currency: 'TRY' })} alacak var`, action: 'Cari Hesaplar', tab: 'cari', level: 'info' });
    }

    const pendingOrders = db.orders.filter(o => o.status === 'bekliyor');
    if (pendingOrders.length > 0) list.push({ icon: '🚚', text: `${pendingOrders.length} bekleyen sipariş var`, action: 'Tedarikçilere Git', tab: 'suppliers', level: 'info' });
    const unmatched = db.bankTransactions.filter(t => t.status === 'unmatched');
    if (unmatched.length > 0) list.push({ icon: '🏦', text: `${unmatched.length} banka işlemi eşleştirilmemiş`, action: 'Bankaya Git', tab: 'bank', level: 'info' });
    const todaySales = db.sales.filter(s => !s.deleted && new Date(s.createdAt).toDateString() === new Date().toDateString() && s.status === 'tamamlandi');
    if (todaySales.length === 0 && db.products.length > 0) list.push({ icon: '💡', text: 'Bugün henüz satış yapılmadı. Hızlı satış için + butonunu kullanın.', action: 'Satışlara Git', tab: 'sales', level: 'ok' });
    if (db.products.length === 0) list.push({ icon: '🏁', text: 'Başlamak için önce ürün ekleyin.', action: 'Ürün Ekle', tab: 'products', level: 'ok' });
    return list.slice(0, 5);
  }, [db]);

  if (tips.length === 0) return null;

  const levelColor: Record<string, string> = { warn: '#f59e0b', info: '#3b82f6', ok: '#10b981' };
  const levelBg: Record<string, string> = { warn: 'rgba(245,158,11,0.08)', info: 'rgba(59,130,246,0.08)', ok: 'rgba(16,185,129,0.08)' };

  return (
    <div style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)', borderRadius: 18, padding: '22px', border: '1px solid rgba(255,255,255,0.07)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <span style={{ fontSize: '0.85rem' }}>💡</span>
        <h3 style={{ fontWeight: 700, fontSize: '0.9rem', color: '#f1f5f9' }}>Akıllı Öneriler</h3>
        <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.06)' }} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {tips.map((tip, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: levelBg[tip.level], border: `1px solid ${levelColor[tip.level]}18`, borderRadius: 12, borderLeft: `3px solid ${levelColor[tip.level]}` }}>
            <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>{tip.icon}</span>
            <span style={{ flex: 1, color: '#94a3b8', fontSize: '0.82rem', lineHeight: 1.4 }}>{tip.text}</span>
            <button onClick={() => onTabChange(tip.tab)} style={{ background: `${levelColor[tip.level]}18`, border: `1px solid ${levelColor[tip.level]}30`, borderRadius: 7, color: levelColor[tip.level], padding: '4px 10px', cursor: 'pointer', fontWeight: 700, fontSize: '0.72rem', whiteSpace: 'nowrap', flexShrink: 0 }}>
              {tip.action} →
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
      <span style={{ color: '#475569', fontSize: '0.75rem' }}>{label}</span>
    </div>
  );
}

function QuickStat({ label, value, color, icon }: { label: string; value: string; color: string; icon: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ width: 32, height: 32, background: `${color}15`, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.85rem', flexShrink: 0 }}>{icon}</div>
      <span style={{ flex: 1, color: '#64748b', fontSize: '0.83rem' }}>{label}</span>
      <span style={{ fontWeight: 700, color, fontSize: '0.95rem' }}>{value}</span>
    </div>
  );
}

function FormulaItem({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ background: `${color}10`, border: `1px solid ${color}25`, borderRadius: 10, padding: '8px 14px', textAlign: 'center', minWidth: 110 }}>
      <div style={{ color: '#475569', fontSize: '0.68rem', fontWeight: 600, textTransform: 'uppercase', marginBottom: 3 }}>{label}</div>
      <div style={{ color, fontWeight: 800, fontSize: '1rem' }}>{formatMoney(value)}</div>
    </div>
  );
}
