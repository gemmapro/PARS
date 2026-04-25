/**
 * IconPicker — Emoji, URL ve Lucide ikon seçici
 * Kategoriler, ürünler, kasalar ve diğer alanlarda kullanılır.
 */
import { useState, useRef, useEffect } from 'react';
import { ICON_CATEGORIES } from '@/lib/appConfig';

interface Props {
  value: string;
  onChange: (icon: string) => void;
  size?: number;
  label?: string;
}

export function IconPicker({ value, onChange, size = 36, label }: Props) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState(0);
  const [urlInput, setUrlInput] = useState('');
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const isUrl = (s: string) => s.startsWith('http') || s.startsWith('/') || s.startsWith('data:');

  const filteredIcons = search.trim()
    ? ICON_CATEGORIES.flatMap(c => c.icons).filter(ic => ic.includes(search))
    : ICON_CATEGORIES[tab]?.icons || [];

  const inp: React.CSSProperties = {
    width: '100%', padding: '7px 10px',
    background: 'rgba(15,23,42,0.6)', border: '1px solid #334155',
    borderRadius: 8, color: '#f1f5f9', fontSize: '0.85rem', boxSizing: 'border-box',
  };

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      {label && <div style={{ color: '#94a3b8', fontSize: '0.82rem', fontWeight: 600, marginBottom: 5 }}>{label}</div>}
      <button
        onClick={() => setOpen(o => !o)}
        title="İkon seç"
        style={{
          width: size, height: size, borderRadius: 10,
          background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
          cursor: 'pointer', fontSize: size * 0.55, display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'all 0.15s',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,87,34,0.15)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
      >
        {isUrl(value)
          ? <img src={value} alt="icon" style={{ width: size * 0.6, height: size * 0.6, objectFit: 'contain', borderRadius: 4 }} />
          : value || '📦'}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: size + 6, left: 0, zIndex: 500,
          background: '#0f1e35', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 14, padding: 12, width: 280,
          boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
        }}>
          {/* Arama */}
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="🔍 Emoji ara..."
            style={{ ...inp, marginBottom: 10 }}
            autoFocus
          />

          {/* Kategori sekmeleri */}
          {!search && (
            <div style={{ display: 'flex', gap: 4, marginBottom: 10, flexWrap: 'wrap' }}>
              {ICON_CATEGORIES.map((cat, i) => (
                <button key={i} onClick={() => setTab(i)} style={{
                  padding: '3px 8px', border: 'none', borderRadius: 6, cursor: 'pointer',
                  fontSize: '0.72rem', fontWeight: 600,
                  background: tab === i ? 'rgba(255,87,34,0.2)' : 'rgba(255,255,255,0.05)',
                  color: tab === i ? '#ff7043' : '#64748b',
                }}>
                  {cat.label}
                </button>
              ))}
              <button onClick={() => setTab(-1)} style={{
                padding: '3px 8px', border: 'none', borderRadius: 6, cursor: 'pointer',
                fontSize: '0.72rem', fontWeight: 600,
                background: tab === -1 ? 'rgba(59,130,246,0.2)' : 'rgba(255,255,255,0.05)',
                color: tab === -1 ? '#60a5fa' : '#64748b',
              }}>
                🔗 URL
              </button>
            </div>
          )}

          {/* URL girişi */}
          {tab === -1 && !search ? (
            <div style={{ display: 'grid', gap: 8 }}>
              <input
                value={urlInput}
                onChange={e => setUrlInput(e.target.value)}
                placeholder="https://... veya /icon.png"
                style={inp}
              />
              {urlInput && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <img src={urlInput} alt="preview" style={{ width: 32, height: 32, objectFit: 'contain', borderRadius: 6, background: 'rgba(255,255,255,0.05)' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  <button onClick={() => { onChange(urlInput); setOpen(false); setUrlInput(''); }} style={{ flex: 1, padding: '7px 0', background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 8, color: '#10b981', cursor: 'pointer', fontWeight: 700, fontSize: '0.82rem' }}>
                    ✓ Kullan
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* Emoji grid */
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 4, maxHeight: 180, overflowY: 'auto' }}>
              {filteredIcons.map(ic => (
                <button key={ic} onClick={() => { onChange(ic); setOpen(false); setSearch(''); }} style={{
                  width: 30, height: 30, border: 'none', borderRadius: 7, cursor: 'pointer',
                  fontSize: '1.1rem', background: value === ic ? 'rgba(255,87,34,0.2)' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'background 0.1s',
                }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
                  onMouseLeave={e => (e.currentTarget.style.background = value === ic ? 'rgba(255,87,34,0.2)' : 'transparent')}
                  title={ic}
                >
                  {ic}
                </button>
              ))}
              {filteredIcons.length === 0 && (
                <div style={{ gridColumn: '1/-1', textAlign: 'center', color: '#334155', fontSize: '0.8rem', padding: '12px 0' }}>Sonuç yok</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
