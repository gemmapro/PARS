import { useMemo, useState, useEffect, useCallback } from 'react';
import { formatMoney } from '@/lib/utils-tr';
import { quickHealthCheck, runHealthCheck, type HealthReport, type HealthStatus } from '@/lib/healthCheck';
import type { DB } from '@/types';

interface Props { db: DB }
type Status = 'ok' | 'warn' | 'err';

const S: Record<Status, { bg: string; border: string; text: string; dot: string }> = {
  ok:   { bg: '#0d2e1a', border: '#22c55e', text: '#4ade80', dot: '#22c55e' },
  warn: { bg: '#2e2500', border: '#f59e0b', text: '#fbbf24', dot: '#f59e0b' },
  err:  { bg: '#2e0d0d', border: '#ef4444', text: '#f87171', dot: '#ef4444' },
};

// Halka konumları — 13 node, çember üzerinde eşit aralıklı (780×780 tuval)
const CX = 390; const CY = 390; const R = 310;
const NODE_IDS = [
  'tedarikci', 'disborc', 'kasa', 'pos_ziraat', 'pos_is', 'pos_yk',
  'tahsilat', 'otahsilat', 'satis', 'stok', 'malgiris', 'siparis', 'ocek',
] as const;
type NodeId = typeof NODE_IDS[number];

const NODE_LABELS: Record<NodeId, string> = {
  tedarikci:  'TEDARİKÇİ',
  disborc:    'ORTAK DIŞ BORÇ',
  kasa:       'KASA / BANKA',
  pos_ziraat: 'POS ZİRAAT',
  pos_is:     'POS İŞ',
  pos_yk:     'POS YAPIKREDI',
  tahsilat:   'TAHSİLAT',
  otahsilat:  'ORTAK TAHSİLAT',
  satis:      'SATIŞ',
  stok:       'STOK',
  malgiris:   'MAL GİRİŞİ',
  siparis:    'SİPARİŞ',
  ocek:       'ORTAK ÇEKİM',
};

const NODES: { id: NodeId; label: string; x: number; y: number }[] = NODE_IDS.map((id, i) => {
  const angle = (i / NODE_IDS.length) * 2 * Math.PI - Math.PI / 2;
  return { id, label: NODE_LABELS[id], x: Math.round(CX + R * Math.cos(angle)) - 75, y: Math.round(CY + R * Math.sin(angle)) - 35 };
});

const CONNECTIONS: [NodeId, NodeId][] = [
  ['tedarikci',  'siparis'],
  ['siparis',    'malgiris'],
  ['malgiris',   'stok'],
  ['stok',       'satis'],
  ['satis',      'tahsilat'],
  ['tahsilat',   'kasa'],
  ['kasa',       'pos_ziraat'],
  ['kasa',       'pos_is'],
  ['kasa',       'pos_yk'],
  ['disborc',    'kasa'],
  ['otahsilat',  'kasa'],
  ['ocek',       'kasa'],
  ['tedarikci',  'disborc'],
];

function kasaBal(kasa: DB['kasa'], kasaId: string): number {
  return kasa.filter(k => !k.deleted && k.kasa === kasaId)
    .reduce((s, k) => s + (k.type === 'gelir' ? k.amount : -k.amount), 0);
}

const STATUS_COLORS: Record<HealthStatus, { bg: string; border: string; text: string; label: string }> = {
  healthy:  { bg: 'rgba(34,197,94,0.08)',  border: 'rgba(34,197,94,0.3)',  text: '#22c55e', label: 'Sağlıklı' },
  degraded: { bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.3)', text: '#f59e0b', label: 'Düşük' },
  critical: { bg: 'rgba(239,68,68,0.08)',  border: 'rgba(239,68,68,0.3)',  text: '#ef4444', label: 'Kritik' },
};

export default function KontrolHalkasi({ db }: Props) {
  const [healthReport, setHealthReport] = useState<HealthReport | null>(() => {
    const quick = quickHealthCheck(db as unknown as Record<string, unknown>);
    return { ...quick, duration: 0 };
  });
  const [fullChecking, setFullChecking] = useState(false);

  // Sayfa açılınca tam sağlık kontrolü yap (Firebase dahil)
  useEffect(() => {
    setFullChecking(true);
    runHealthCheck(db as unknown as Record<string, unknown>).then(r => {
      setHealthReport(r);
      setFullChecking(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const recheck = useCallback(() => {
    setFullChecking(true);
    runHealthCheck(db as unknown as Record<string, unknown>).then(r => {
      setHealthReport(r);
      setFullChecking(false);
    });
  }, [db]);

  const m = useMemo(() => {
    const nakit     = kasaBal(db.kasa, 'nakit');
    const banka     = kasaBal(db.kasa, 'banka');
    const posZ      = kasaBal(db.kasa, 'pos_ziraat');
    const posI      = kasaBal(db.kasa, 'pos_is');
    const posY      = kasaBal(db.kasa, 'pos_yk');
    const totalKasa = nakit + banka + posZ + posI + posY;

    const outOfStock = db.products.filter(p => !p.deleted && p.stock === 0).length;
    const lowStock   = db.products.filter(p => !p.deleted && p.stock > 0 && p.stock <= p.minStock).length;
    const totalStock = db.products.filter(p => !p.deleted).reduce((s, p) => s + p.stock, 0);

    const today = new Date().toDateString();
    const todaySales = db.sales.filter(s => !s.deleted && s.status === 'tamamlandi' && new Date(s.createdAt).toDateString() === today);

    const pendingOrders   = db.orders.filter(o => o.status === 'bekliyor').length;
    const inTransit       = db.orders.filter(o => o.status === 'yolda').length;
    const completedToday  = db.orders.filter(o => o.status === 'tamamlandi' && new Date(o.updatedAt).toDateString() === today).length;

    const totalReceivable = db.cari.filter(c => !c.deleted && c.type === 'musteri' && c.balance > 0).reduce((s, c) => s + c.balance, 0);
    const totalPayable    = db.cari.filter(c => !c.deleted && c.type === 'tedarikci' && c.balance > 0).reduce((s, c) => s + c.balance, 0);

    const ortakCekim    = (db.ortakEmanetler || []).filter(e => e.type === 'emanet').reduce((s, e) => s + e.amount, 0);
    const ortakTahsilat = (db.ortakEmanetler || []).filter(e => e.type === 'iade').reduce((s, e) => s + e.amount, 0);

    return {
      nakit, banka, posZ, posI, posY, totalKasa,
      outOfStock, lowStock, totalStock,
      todayCount: todaySales.length,
      todayAmount: todaySales.reduce((s, x) => s + x.total, 0),
      pendingOrders, inTransit, completedToday,
      totalReceivable, totalPayable,
      ortakCekim, ortakTahsilat,
      netSermaye: totalKasa + totalReceivable - totalPayable,
    };
  }, [db]);

  function getStatus(id: NodeId): Status {
    switch (id) {
      case 'stok':       return m.outOfStock > 0 ? 'err' : m.lowStock > 0 ? 'warn' : 'ok';
      case 'satis':      return m.todayCount === 0 ? 'warn' : 'ok';
      case 'siparis':    return m.pendingOrders > 0 ? 'warn' : 'ok';
      case 'malgiris':   return m.inTransit > 0 ? 'warn' : 'ok';
      case 'kasa':       return m.totalKasa <= 0 ? 'err' : m.totalKasa < 5000 ? 'warn' : 'ok';
      case 'pos_ziraat': return m.posZ === 0 ? 'warn' : 'ok';
      case 'pos_is':     return m.posI === 0 ? 'warn' : 'ok';
      case 'pos_yk':     return m.posY === 0 ? 'warn' : 'ok';
      case 'ocek':       return m.ortakCekim > 0 ? 'warn' : 'ok';
      case 'disborc':    return m.totalPayable > 100000 ? 'err' : m.totalPayable > 0 ? 'warn' : 'ok';
      case 'otahsilat':  return m.ortakTahsilat > 0 ? 'warn' : 'ok';
      case 'tahsilat':   return m.todayCount > 0 && m.totalKasa <= 0 ? 'warn' : 'ok';
      case 'tedarikci':  return m.totalPayable > 100000 ? 'err' : m.totalPayable > 0 ? 'warn' : 'ok';
    }
  }

  function getSub(id: NodeId): string {
    switch (id) {
      case 'stok':       return m.outOfStock > 0 ? `${m.outOfStock} bitti` : m.lowStock > 0 ? `${m.lowStock} az` : `${m.totalStock} adet`;
      case 'satis':      return m.todayCount > 0 ? `${m.todayCount} · ${formatMoney(m.todayAmount)}` : 'Bugün satış yok';
      case 'siparis':    return m.pendingOrders > 0 ? `${m.pendingOrders} bekliyor` : 'Bekleyen yok';
      case 'malgiris':   return m.inTransit > 0 ? `${m.inTransit} yolda` : m.completedToday > 0 ? `${m.completedToday} teslim` : 'Yok';
      case 'kasa':       return formatMoney(m.totalKasa);
      case 'pos_ziraat': return formatMoney(m.posZ);
      case 'pos_is':     return formatMoney(m.posI);
      case 'pos_yk':     return formatMoney(m.posY);
      case 'ocek':       return m.ortakCekim > 0 ? formatMoney(m.ortakCekim) : 'Yok';
      case 'disborc':    return m.totalPayable > 0 ? formatMoney(m.totalPayable) : 'Yok';
      case 'otahsilat':  return m.ortakTahsilat > 0 ? formatMoney(m.ortakTahsilat) : 'Yok';
      case 'tahsilat':   return formatMoney(m.totalReceivable);
      case 'tedarikci':  return m.totalPayable > 0 ? `${formatMoney(m.totalPayable)} borç` : 'Borç yok';
    }
  }

  const errCount  = NODES.filter(n => getStatus(n.id) === 'err').length;
  const warnCount = NODES.filter(n => getStatus(n.id) === 'warn').length;
  const okCount   = NODES.filter(n => getStatus(n.id) === 'ok').length;

  const nodePos = Object.fromEntries(NODES.map(n => [n.id, n]));

  return (
    <div style={{ paddingBottom: 40 }}>
      {/* Başlık */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 160 }}>
          <h2 style={{ color: '#f1f5f9', fontWeight: 900, fontSize: '1.1rem', margin: 0 }}>⚡ Canlı Muhasebe Kontrol Halkası</h2>
          <p style={{ color: '#475569', fontSize: '0.78rem', margin: '4px 0 0' }}>Tüm kanallar gerçek zamanlı izleniyor</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[
            { count: errCount,  color: '#ef4444', label: 'Kritik', icon: '🔴' },
            { count: warnCount, color: '#f59e0b', label: 'Uyarı',  icon: '🟡' },
            { count: okCount,   color: '#22c55e', label: 'Tamam',  icon: '🟢' },
          ].map(b => (
            <div key={b.label} style={{ background: `${b.color}18`, border: `1px solid ${b.color}44`, borderRadius: 10, padding: '8px 16px', textAlign: 'center', minWidth: 64 }}>
              <div style={{ color: b.color, fontWeight: 900, fontSize: '1.3rem', lineHeight: 1 }}>{b.count}</div>
              <div style={{ color: `${b.color}cc`, fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', marginTop: 3, letterSpacing: '0.04em' }}>{b.icon} {b.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Net Sermaye Bandı */}
      <div style={{
        background: m.netSermaye >= 0 ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)',
        border: `1px solid ${m.netSermaye >= 0 ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}`,
        borderRadius: 12, padding: '12px 20px', marginBottom: 20,
        display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center',
      }}>
        {[
          { label: 'Nakit',    value: m.nakit,    color: '#06b6d4' },
          { label: 'Banka',    value: m.banka,    color: '#6366f1' },
          { label: 'POS',      value: m.posZ + m.posI + m.posY, color: '#8b5cf6' },
          { label: 'Alacak',   value: m.totalReceivable, color: '#10b981' },
          { label: 'Borç',     value: -m.totalPayable,   color: '#ef4444' },
        ].map((item, idx, arr) => (
          <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: '#475569', fontSize: '0.65rem', fontWeight: 600, textTransform: 'uppercase' }}>{item.label}</div>
              <div style={{ color: item.color, fontWeight: 700, fontSize: '0.92rem' }}>{item.value < 0 ? '-' : ''}{formatMoney(Math.abs(item.value))}</div>
            </div>
            {idx < arr.length - 1 && <span style={{ color: '#334155', fontWeight: 700 }}>{idx === arr.length - 2 ? '−' : '+'}</span>}
          </div>
        ))}
        <span style={{ color: '#334155', fontWeight: 700, fontSize: '1.2rem' }}>=</span>
        <div style={{ background: m.netSermaye >= 0 ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)', border: `1px solid ${m.netSermaye >= 0 ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)'}`, borderRadius: 10, padding: '8px 18px', textAlign: 'center' }}>
          <div style={{ color: '#475569', fontSize: '0.65rem', fontWeight: 600, textTransform: 'uppercase' }}>Net Sermaye</div>
          <div style={{ color: m.netSermaye >= 0 ? '#22c55e' : '#ef4444', fontWeight: 900, fontSize: '1.15rem' }}>{formatMoney(m.netSermaye)}</div>
        </div>
      </div>

      {/* Halka */}
      <div style={{ width: '100%', overflowX: 'auto', WebkitOverflowScrolling: 'touch' as any }}>
        <div style={{ position: 'relative', width: 780, height: 780, margin: '0 auto', flexShrink: 0 }}>
          {/* SVG bağlantılar */}
          <svg style={{ position: 'absolute', inset: 0, width: 780, height: 780, pointerEvents: 'none' }}>
            {CONNECTIONS.map(([fromId, toId], i) => {
              const from = nodePos[fromId]; const to = nodePos[toId];
              if (!from || !to) return null;
              const x1 = from.x + 75; const y1 = from.y + 35;
              const x2 = to.x + 75;   const y2 = to.y + 35;
              const dx = x2 - x1; const dy = y2 - y1;
              const len = Math.sqrt(dx * dx + dy * dy);
              const ux = dx / len; const uy = dy / len;
              // Shorten line ends so they don't overlap nodes
              const sx = x1 + ux * 78; const sy = y1 + uy * 38;
              const ex = x2 - ux * 78; const ey = y2 - uy * 38;
              const mx = (sx + ex) / 2 - uy * 25;
              const my = (sy + ey) / 2 + ux * 25;
              const angle = Math.atan2(ey - my, ex - mx) * 180 / Math.PI;
              return (
                <g key={i}>
                  <path d={`M${sx},${sy} Q${mx},${my} ${ex},${ey}`} fill="none" stroke="rgba(100,116,139,0.22)" strokeWidth={1.5} strokeDasharray="5 4" />
                  <polygon points="-5,-4 0,5 5,-4"
                    fill="rgba(100,116,139,0.5)"
                    transform={`translate(${ex},${ey}) rotate(${angle + 90})`} />
                </g>
              );
            })}
          </svg>

          {/* Node'lar */}
          {NODES.map(node => {
            const st = getStatus(node.id);
            const c = S[st];
            return (
              <div key={node.id} style={{
                position: 'absolute', left: node.x, top: node.y,
                width: 150, height: 70, borderRadius: 40,
                background: c.bg, border: `2px solid ${c.border}`,
                boxShadow: `0 0 ${st === 'err' ? 20 : 12}px ${c.border}55, 0 4px 14px rgba(0,0,0,0.5)`,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                padding: '0 12px',
                transition: 'all 0.4s ease',
                animation: st === 'err' ? 'halka-pulse 1.5s infinite' : st === 'warn' ? 'halka-warn 2s infinite' : undefined,
              }}>
                <div style={{ color: c.text, fontWeight: 800, fontSize: '0.62rem', letterSpacing: '0.05em', textTransform: 'uppercase', textAlign: 'center', lineHeight: 1.2 }}>{node.label}</div>
                <div style={{ color: `${c.text}bb`, fontSize: '0.6rem', marginTop: 3, maxWidth: 130, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{getSub(node.id)}</div>
                <div style={{ position: 'absolute', top: 7, right: 11, width: 8, height: 8, borderRadius: '50%', background: c.dot, boxShadow: `0 0 6px ${c.dot}` }} />
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Sistem Sağlık Paneli ─────────────────────────────────────── */}
      {healthReport && (
        <div style={{ marginTop: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            <h3 style={{ color: '#f1f5f9', fontWeight: 800, fontSize: '0.95rem', margin: 0 }}>🏥 Sistem Sağlığı</h3>
            {/* Skor */}
            <div style={{
              padding: '4px 14px', borderRadius: 20,
              background: STATUS_COLORS[healthReport.overall].bg,
              border: `1px solid ${STATUS_COLORS[healthReport.overall].border}`,
              color: STATUS_COLORS[healthReport.overall].text,
              fontWeight: 800, fontSize: '0.85rem',
            }}>
              {healthReport.score}/100 — {STATUS_COLORS[healthReport.overall].label}
            </div>
            <button
              onClick={recheck}
              disabled={fullChecking}
              style={{
                padding: '5px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)',
                background: 'rgba(255,255,255,0.05)', color: fullChecking ? '#334155' : '#94a3b8',
                cursor: fullChecking ? 'wait' : 'pointer', fontSize: '0.78rem', fontWeight: 600,
                transition: 'all 0.15s', marginLeft: 'auto',
              }}
              onMouseEnter={e => { if (!fullChecking) (e.currentTarget.style.background = 'rgba(255,255,255,0.1)'); }}
              onMouseLeave={e => { (e.currentTarget.style.background = 'rgba(255,255,255,0.05)'); }}
            >
              {fullChecking ? '⟳ Kontrol ediliyor…' : '🔄 Yeniden Kontrol'}
            </button>
          </div>

          {/* Metrikler */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 10 }}>
            {healthReport.metrics.map(metric => {
              const c = STATUS_COLORS[metric.status];
              return (
                <div key={metric.id} style={{
                  background: c.bg, border: `1px solid ${c.border}`,
                  borderRadius: 12, padding: '12px 14px',
                  transition: 'all 0.2s',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: c.text, flexShrink: 0, boxShadow: `0 0 6px ${c.text}` }} />
                    <span style={{ color: '#94a3b8', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{metric.name}</span>
                    <span style={{ marginLeft: 'auto', color: c.text, fontSize: '0.68rem', fontWeight: 700 }}>{c.label}</span>
                  </div>
                  <div style={{ color: c.text, fontSize: '1.1rem', fontWeight: 900, lineHeight: 1 }}>
                    {metric.value}{metric.unit ? <span style={{ fontSize: '0.72rem', fontWeight: 600, marginLeft: 2 }}>{metric.unit}</span> : ''}
                  </div>
                  {metric.detail && (
                    <div style={{ color: '#475569', fontSize: '0.68rem', marginTop: 4, lineHeight: 1.4 }}>{metric.detail}</div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Öneriler */}
          {healthReport.recommendations.length > 0 && (
            <div style={{ marginTop: 14, background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 12, padding: '12px 16px' }}>
              <div style={{ color: '#f59e0b', fontWeight: 700, fontSize: '0.78rem', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>⚠️ Öneriler</div>
              {healthReport.recommendations.map((rec, i) => (
                <div key={i} style={{ color: '#94a3b8', fontSize: '0.8rem', lineHeight: 1.5, display: 'flex', gap: 8, marginBottom: i < healthReport.recommendations.length - 1 ? 6 : 0 }}>
                  <span style={{ color: '#f59e0b', flexShrink: 0 }}>›</span>
                  {rec}
                </div>
              ))}
            </div>
          )}

          <div style={{ color: '#1e3a5f', fontSize: '0.62rem', marginTop: 8, textAlign: 'right' }}>
            Son kontrol: {new Date(healthReport.ts).toLocaleTimeString('tr-TR')}
            {healthReport.duration > 0 && ` · ${healthReport.duration}ms`}
          </div>
        </div>
      )}

      <style>{`
        @keyframes halka-pulse {
          0%, 100% { box-shadow: 0 0 20px #ef444466, 0 4px 14px rgba(0,0,0,.5); }
          50%       { box-shadow: 0 0 36px #ef4444bb, 0 4px 20px rgba(0,0,0,.6); }
        }
        @keyframes halka-warn {
          0%, 100% { box-shadow: 0 0 12px #f59e0b44, 0 4px 14px rgba(0,0,0,.5); }
          50%       { box-shadow: 0 0 22px #f59e0b88, 0 4px 18px rgba(0,0,0,.6); }
        }
      `}</style>
    </div>
  );
}
