/**
 * SystemMap — PARSPEL modüller arası ilişki haritası
 * Hangi modül hangi modülü etkiler, veri akışı nasıl gider.
 */

interface MapNode {
  id: string;
  label: string;
  icon: string;
  color: string;
  x: number;
  y: number;
  desc: string;
}

interface MapEdge {
  from: string;
  to: string;
  label: string;
  color?: string;
  dashed?: boolean;
}

const NODES: MapNode[] = [
  { id: 'satis',    label: 'Satış',       icon: '🛒', color: '#10b981', x: 340, y: 60,  desc: 'Satış kaydı oluşturur' },
  { id: 'urun',     label: 'Ürünler',     icon: '📦', color: '#3b82f6', x: 100, y: 60,  desc: 'Stok takibi' },
  { id: 'kasa',     label: 'Kasa',        icon: '💰', color: '#f59e0b', x: 580, y: 60,  desc: 'Nakit/banka hareketleri' },
  { id: 'cari',     label: 'Cari',        icon: '👤', color: '#8b5cf6', x: 340, y: 220, desc: 'Müşteri/tedarikçi bakiyeleri' },
  { id: 'fatura',   label: 'Fatura',      icon: '🧾', color: '#ec4899', x: 580, y: 220, desc: 'Fatura & taksit yönetimi' },
  { id: 'stok',     label: 'Stok Hareketleri', icon: '🔢', color: '#06b6d4', x: 100, y: 220, desc: 'Her stok değişimi kaydedilir' },
  { id: 'tedarik',  label: 'Tedarikçi',   icon: '🏭', color: '#64748b', x: 100, y: 380, desc: 'Sipariş & tedarik zinciri' },
  { id: 'banka',    label: 'Banka',       icon: '🏦', color: '#6366f1', x: 580, y: 380, desc: 'Ekstre & banka işlemleri' },
  { id: 'rapor',    label: 'Raporlar',    icon: '📊', color: '#ff5722', x: 340, y: 380, desc: 'Satış, kâr, stok analizleri' },
  { id: 'yedek',    label: 'Yedekleme',   icon: '☁️', color: '#94a3b8', x: 340, y: 520, desc: 'Firebase + JSON yedek' },
];

const EDGES: MapEdge[] = [
  { from: 'satis',   to: 'urun',    label: 'stok düşer',      color: '#3b82f6' },
  { from: 'satis',   to: 'kasa',    label: 'ödeme kaydı',     color: '#f59e0b' },
  { from: 'satis',   to: 'cari',    label: 'bakiye artar',    color: '#8b5cf6' },
  { from: 'satis',   to: 'stok',    label: 'hareket kaydı',   color: '#06b6d4' },
  { from: 'fatura',  to: 'cari',    label: 'cari günceller',  color: '#8b5cf6' },
  { from: 'fatura',  to: 'kasa',    label: 'ödeme kaydı',     color: '#f59e0b' },
  { from: 'tedarik', to: 'urun',    label: 'stok artar',      color: '#3b82f6' },
  { from: 'tedarik', to: 'kasa',    label: 'ödeme çıkar',     color: '#f59e0b' },
  { from: 'banka',   to: 'kasa',    label: 'onayda aktarılır',color: '#f59e0b' },
  { from: 'banka',   to: 'cari',    label: 'bakiye etkiler',  color: '#8b5cf6' },
  { from: 'satis',   to: 'rapor',   label: 'veri sağlar',     color: '#ff5722', dashed: true },
  { from: 'kasa',    to: 'rapor',   label: 'veri sağlar',     color: '#ff5722', dashed: true },
  { from: 'cari',    to: 'rapor',   label: 'veri sağlar',     color: '#ff5722', dashed: true },
  { from: 'rapor',   to: 'yedek',   label: 'tüm DB',          color: '#94a3b8', dashed: true },
];

function getCenter(node: MapNode) {
  return { x: node.x + 60, y: node.y + 30 };
}

export function SystemMap() {
  const W = 740, H = 580;

  return (
    <div style={{ overflowX: 'auto', overflowY: 'hidden' }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', minWidth: W }}>
        <defs>
          {NODES.map(n => (
            <marker key={n.id} id={`arrow-${n.id}`} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L0,6 L8,3 z" fill={n.color} opacity="0.7" />
            </marker>
          ))}
          <marker id="arrow-default" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L0,6 L8,3 z" fill="#475569" opacity="0.7" />
          </marker>
        </defs>

        {/* Kenarlar */}
        {EDGES.map((edge, i) => {
          const from = NODES.find(n => n.id === edge.from);
          const to = NODES.find(n => n.id === edge.to);
          if (!from || !to) return null;
          const fc = getCenter(from);
          const tc = getCenter(to);
          const mx = (fc.x + tc.x) / 2;
          const my = (fc.y + tc.y) / 2;
          const color = edge.color || '#475569';
          const markerId = `arrow-${edge.from}`;
          return (
            <g key={i}>
              <line
                x1={fc.x} y1={fc.y} x2={tc.x} y2={tc.y}
                stroke={color} strokeWidth={edge.dashed ? 1.5 : 2}
                strokeDasharray={edge.dashed ? '5,4' : undefined}
                strokeOpacity={0.5}
                markerEnd={`url(#${markerId})`}
              />
              <text x={mx} y={my - 5} textAnchor="middle" fill={color} fontSize="9" fontWeight="600" opacity="0.8">
                {edge.label}
              </text>
            </g>
          );
        })}

        {/* Düğümler */}
        {NODES.map(node => (
          <g key={node.id} transform={`translate(${node.x}, ${node.y})`}>
            <rect width="120" height="60" rx="12"
              fill={`${node.color}18`}
              stroke={node.color}
              strokeWidth="1.5"
              strokeOpacity="0.6"
            />
            <text x="60" y="22" textAnchor="middle" fontSize="18">{node.icon}</text>
            <text x="60" y="40" textAnchor="middle" fill="#f1f5f9" fontSize="11" fontWeight="700">{node.label}</text>
            <text x="60" y="54" textAnchor="middle" fill="#475569" fontSize="8">{node.desc}</text>
          </g>
        ))}
      </svg>

      {/* Açıklama */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 14, padding: '10px 14px', background: 'rgba(0,0,0,0.2)', borderRadius: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', color: '#64748b' }}>
          <svg width="24" height="8"><line x1="0" y1="4" x2="24" y2="4" stroke="#475569" strokeWidth="2" /></svg>
          Doğrudan etki
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', color: '#64748b' }}>
          <svg width="24" height="8"><line x1="0" y1="4" x2="24" y2="4" stroke="#475569" strokeWidth="1.5" strokeDasharray="4,3" /></svg>
          Veri sağlar
        </div>
      </div>
    </div>
  );
}
