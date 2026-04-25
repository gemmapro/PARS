import { useState, useMemo } from 'react';
import { formatMoney } from '@/lib/utils-tr';
import type { DB } from '@/types';

interface Props { db: DB; }

const MONTHS = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
const DAYS   = ['Pzt','Sal','Çar','Per','Cum','Cmt','Paz'];

// Soba kategorisindeki ürünleri filtrele
const SOBA_CATS = ['soba'];

export default function Cizelge({ db }: Props) {
  const today = new Date();
  const [year,  setYear]  = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth()); // 0-indexed
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'month' | 'year'>('month');

  // Soba satışlarını filtrele
  const sobaSales = useMemo(() => {
    return db.sales.filter(s => {
      if (s.deleted || s.status === 'iptal') return false;
      const cat = s.productCategory || '';
      const name = (s.productName || '').toLowerCase();
      return SOBA_CATS.includes(cat) || name.includes('soba');
    });
  }, [db.sales]);

  // Gün bazlı satış özeti
  const dayMap = useMemo(() => {
    const map: Record<string, { count: number; total: number; profit: number; sales: typeof sobaSales }> = {};
    sobaSales.forEach(s => {
      const d = s.createdAt.slice(0, 10);
      if (!map[d]) map[d] = { count: 0, total: 0, profit: 0, sales: [] };
      map[d].count++;
      map[d].total += s.total;
      map[d].profit += s.profit;
      map[d].sales.push(s);
    });
    return map;
  }, [sobaSales]);

  // Ay bazlı özet (yıl görünümü için)
  const monthMap = useMemo(() => {
    const map: Record<number, { count: number; total: number; profit: number }> = {};
    for (let m = 0; m < 12; m++) map[m] = { count: 0, total: 0, profit: 0 };
    sobaSales.forEach(s => {
      const d = new Date(s.createdAt);
      if (d.getFullYear() !== year) return;
      const m = d.getMonth();
      map[m].count++;
      map[m].total += s.total;
      map[m].profit += s.profit;
    });
    return map;
  }, [sobaSales, year]);

  // Seçili ay için takvim günleri
  const calDays = useMemo(() => {
    const firstDay = new Date(year, month, 1);
    const lastDay  = new Date(year, month + 1, 0);
    // Pazartesi başlangıçlı: 0=Pzt ... 6=Paz
    let startDow = firstDay.getDay(); // 0=Paz
    startDow = startDow === 0 ? 6 : startDow - 1;
    const days: (number | null)[] = Array(startDow).fill(null);
    for (let d = 1; d <= lastDay.getDate(); d++) days.push(d);
    while (days.length % 7 !== 0) days.push(null);
    return days;
  }, [year, month]);

  // Seçili gün satışları
  const selectedSales = selectedDay ? (dayMap[selectedDay]?.sales || []) : [];

  // Renk yoğunluğu
  const maxDayTotal = useMemo(() => Math.max(...Object.values(dayMap).map(d => d.total), 1), [dayMap]);

  function dayColor(total: number): string {
    if (total === 0) return 'transparent';
    const pct = total / maxDayTotal;
    if (pct > 0.75) return 'rgba(255,87,34,0.85)';
    if (pct > 0.5)  return 'rgba(255,87,34,0.55)';
    if (pct > 0.25) return 'rgba(255,87,34,0.3)';
    return 'rgba(255,87,34,0.15)';
  }

  const prevMonth = () => { if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1); setSelectedDay(null); };
  const nextMonth = () => { if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1); setSelectedDay(null); };

  // Ay toplamları
  const monthTotal  = Object.values(dayMap).filter((_, i) => {
    const keys = Object.keys(dayMap);
    return keys[i]?.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`);
  }).reduce((s, d) => s + d.total, 0);

  const curMonthKey = `${year}-${String(month + 1).padStart(2, '0')}`;
  const curMonthData = Object.entries(dayMap)
    .filter(([k]) => k.startsWith(curMonthKey))
    .reduce((acc, [, v]) => ({ count: acc.count + v.count, total: acc.total + v.total, profit: acc.profit + v.profit }), { count: 0, total: 0, profit: 0 });

  return (
    <div style={{ animation: 'fadeIn 0.3s ease' }}>
      {/* Başlık & Kontroller */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['month', 'year'] as const).map(v => (
            <button key={v} onClick={() => setViewMode(v)}
              style={{ padding: '7px 14px', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: '0.82rem', background: viewMode === v ? '#ff5722' : '#273548', color: viewMode === v ? '#fff' : '#64748b' }}>
              {v === 'month' ? '📅 Aylık' : '📆 Yıllık'}
            </button>
          ))}
        </div>

        {viewMode === 'month' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={prevMonth} style={navBtn}>‹</button>
            <span style={{ color: '#f1f5f9', fontWeight: 800, fontSize: '1rem', minWidth: 140, textAlign: 'center' }}>
              {MONTHS[month]} {year}
            </span>
            <button onClick={nextMonth} style={navBtn}>›</button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={() => setYear(y => y - 1)} style={navBtn}>‹</button>
            <span style={{ color: '#f1f5f9', fontWeight: 800, fontSize: '1rem', minWidth: 60, textAlign: 'center' }}>{year}</span>
            <button onClick={() => setYear(y => y + 1)} style={navBtn}>›</button>
          </div>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={() => { setYear(today.getFullYear()); setMonth(today.getMonth()); setSelectedDay(null); }}
            style={{ padding: '7px 14px', border: '1px solid rgba(255,87,34,0.3)', borderRadius: 8, background: 'rgba(255,87,34,0.08)', color: '#ff7043', cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem' }}>
            Bugün
          </button>
        </div>
      </div>

      {/* Ay özet kartları */}
      {viewMode === 'month' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 16 }}>
          {[
            { label: 'Satış Adedi', value: String(curMonthData.count), color: '#3b82f6', icon: '🛒' },
            { label: 'Ciro', value: formatMoney(curMonthData.total), color: '#10b981', icon: '💰' },
            { label: 'Kâr', value: formatMoney(curMonthData.profit), color: '#f59e0b', icon: '📈' },
            { label: 'Ort. Satış', value: curMonthData.count > 0 ? formatMoney(curMonthData.total / curMonthData.count) : '—', color: '#8b5cf6', icon: '⚡' },
          ].map(s => (
            <div key={s.label} style={{ background: `${s.color}12`, border: `1px solid ${s.color}25`, borderRadius: 12, padding: '12px 14px' }}>
              <div style={{ fontSize: '1rem', marginBottom: 4 }}>{s.icon}</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 900, color: s.color }}>{s.value}</div>
              <div style={{ color: '#475569', fontSize: '0.7rem', marginTop: 2, fontWeight: 600, textTransform: 'uppercase' }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* AYLIK TAKVİM */}
      {viewMode === 'month' && (
        <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 16, overflow: 'hidden' }}>
          {/* Gün başlıkları */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', background: 'rgba(0,0,0,0.3)' }}>
            {DAYS.map(d => (
              <div key={d} style={{ padding: '10px 0', textAlign: 'center', color: '#475569', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{d}</div>
            ))}
          </div>
          {/* Günler */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
            {calDays.map((day, i) => {
              if (day === null) return <div key={`e${i}`} style={{ minHeight: 72, borderBottom: '1px solid rgba(255,255,255,0.04)', borderRight: '1px solid rgba(255,255,255,0.04)' }} />;
              const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const data = dayMap[key];
              const isToday = key === today.toISOString().slice(0, 10);
              const isSelected = key === selectedDay;
              const dow = i % 7; // 0=Pzt, 6=Paz
              return (
                <div key={key} onClick={() => setSelectedDay(isSelected ? null : key)}
                  style={{
                    minHeight: 72, padding: '8px 10px', cursor: 'pointer',
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                    borderRight: '1px solid rgba(255,255,255,0.04)',
                    background: isSelected ? 'rgba(255,87,34,0.15)' : data ? dayColor(data.total) : 'transparent',
                    outline: isToday ? '2px solid #ff5722' : isSelected ? '2px solid rgba(255,87,34,0.6)' : 'none',
                    outlineOffset: -2,
                    transition: 'all 0.15s',
                    position: 'relative',
                  }}
                  onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,87,34,0.1)'; }}
                  onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = data ? dayColor(data.total) : 'transparent'; }}
                >
                  <div style={{ fontWeight: isToday ? 900 : 600, color: isToday ? '#ff5722' : dow >= 5 ? '#64748b' : '#f1f5f9', fontSize: '0.88rem' }}>{day}</div>
                  {data && (
                    <>
                      <div style={{ color: '#10b981', fontSize: '0.72rem', fontWeight: 700, marginTop: 4 }}>{data.count} satış</div>
                      <div style={{ color: '#f1f5f9', fontSize: '0.7rem', fontWeight: 600 }}>{formatMoney(data.total)}</div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* YILLIK GÖRÜNÜM */}
      {viewMode === 'year' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
          {MONTHS.map((name, m) => {
            const d = monthMap[m];
            const isCurrentMonth = m === today.getMonth() && year === today.getFullYear();
            return (
              <div key={m} onClick={() => { setMonth(m); setViewMode('month'); setSelectedDay(null); }}
                style={{ background: d.total > 0 ? 'rgba(255,87,34,0.1)' : 'rgba(255,255,255,0.02)', border: `1px solid ${isCurrentMonth ? 'rgba(255,87,34,0.5)' : 'rgba(255,255,255,0.07)'}`, borderRadius: 12, padding: '14px 16px', cursor: 'pointer', transition: 'all 0.2s' }}
                onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,87,34,0.15)'}
                onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = d.total > 0 ? 'rgba(255,87,34,0.1)' : 'rgba(255,255,255,0.02)'}
              >
                <div style={{ fontWeight: 700, color: isCurrentMonth ? '#ff7043' : '#f1f5f9', marginBottom: 8 }}>{name}</div>
                {d.count > 0 ? (
                  <>
                    <div style={{ color: '#10b981', fontWeight: 800, fontSize: '1.1rem' }}>{formatMoney(d.total)}</div>
                    <div style={{ color: '#64748b', fontSize: '0.78rem', marginTop: 4 }}>{d.count} satış · Kâr: {formatMoney(d.profit)}</div>
                  </>
                ) : (
                  <div style={{ color: '#334155', fontSize: '0.82rem' }}>Satış yok</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Seçili gün detayı */}
      {selectedDay && selectedSales.length > 0 && (
        <div style={{ marginTop: 16, background: 'rgba(255,87,34,0.06)', border: '1px solid rgba(255,87,34,0.2)', borderRadius: 14, padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontWeight: 800, color: '#ff7043', fontSize: '0.95rem' }}>
              📅 {new Date(selectedDay).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}
            </span>
            <div style={{ display: 'flex', gap: 12 }}>
              <span style={{ color: '#10b981', fontWeight: 700, fontSize: '0.85rem' }}>{selectedSales.length} satış</span>
              <span style={{ color: '#f1f5f9', fontWeight: 700, fontSize: '0.85rem' }}>{formatMoney(dayMap[selectedDay]?.total || 0)}</span>
              <button onClick={() => setSelectedDay(null)} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '1rem' }}>✕</button>
            </div>
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            {selectedSales.map(s => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: 'rgba(0,0,0,0.2)', borderRadius: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ color: '#f1f5f9', fontWeight: 600, fontSize: '0.88rem' }}>{s.productName}</div>
                  {s.cariName && <div style={{ color: '#64748b', fontSize: '0.75rem', marginTop: 2 }}>👤 {s.cariName}</div>}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ color: '#10b981', fontWeight: 700 }}>{formatMoney(s.total)}</div>
                  <div style={{ color: '#475569', fontSize: '0.72rem' }}>{s.quantity} adet · {s.payment}</div>
                </div>
                <div style={{ textAlign: 'right', minWidth: 70 }}>
                  <div style={{ color: s.profit >= 0 ? '#f59e0b' : '#ef4444', fontSize: '0.78rem', fontWeight: 600 }}>Kâr: {formatMoney(s.profit)}</div>
                  <div style={{ background: s.status === 'tamamlandi' ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)', color: s.status === 'tamamlandi' ? '#10b981' : '#ef4444', borderRadius: 5, padding: '1px 6px', fontSize: '0.68rem', fontWeight: 700, marginTop: 2 }}>
                    {s.status === 'tamamlandi' ? '✓' : s.status}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Renk açıklaması */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 14, flexWrap: 'wrap' }}>
        <span style={{ color: '#334155', fontSize: '0.72rem', fontWeight: 600 }}>Yoğunluk:</span>
        {[0.15, 0.3, 0.55, 0.85].map((o, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 14, height: 14, borderRadius: 3, background: `rgba(255,87,34,${o})` }} />
            <span style={{ color: '#334155', fontSize: '0.7rem' }}>{['Az', 'Orta', 'İyi', 'Yüksek'][i]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const navBtn: React.CSSProperties = {
  width: 32, height: 32, borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)',
  background: 'rgba(255,255,255,0.05)', color: '#94a3b8', cursor: 'pointer',
  fontSize: '1.1rem', fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center',
};
