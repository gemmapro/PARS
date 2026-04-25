import { useState, useEffect, useRef } from 'react';

interface Option { value: string; label: string; sub?: string; }

interface Props {
  value: string;
  onChange: (val: string) => void;
  options: Option[];
  placeholder?: string;
  label?: string;
  searchable?: boolean;
  style?: React.CSSProperties;
}

export function MobileSelect({ value, onChange, options, placeholder = '-- Seçin --', label, searchable = true, style }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = options.find(o => o.value === value);

  const filtered = search.trim()
    ? options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()) || (o.sub || '').toLowerCase().includes(search.toLowerCase()))
    : options;

  useEffect(() => {
    if (open) {
      setSearch('');
      setTimeout(() => searchRef.current?.focus(), 150);
    }
  }, [open]);

  // Backdrop click closes
  const close = () => setOpen(false);

  const inp: React.CSSProperties = {
    width: '100%', padding: '11px 14px',
    background: '#0f1e35', border: '1px solid #1e3a5f',
    borderRadius: 10, color: '#f1f5f9', fontSize: '0.9rem',
    outline: 'none', boxSizing: 'border-box',
  };

  return (
    <>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          width: '100%', padding: '11px 14px',
          background: '#0f1e35', border: '1px solid #1e3a5f',
          borderRadius: 10, color: selected ? '#f1f5f9' : '#475569',
          fontSize: '0.9rem', textAlign: 'left', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          ...style,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selected ? selected.label : placeholder}
        </span>
        <span style={{ color: '#475569', fontSize: '0.75rem', flexShrink: 0, marginLeft: 8 }}>▼</span>
      </button>

      {/* Bottom Sheet */}
      {open && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
          }}
        >
          {/* Backdrop */}
          <div
            onClick={close}
            style={{
              position: 'absolute', inset: 0,
              background: 'rgba(0,0,0,0.7)',
              backdropFilter: 'blur(6px)',
              animation: 'fadeIn 0.2s ease',
            }}
          />

          {/* Sheet */}
          <div style={{
            position: 'relative', zIndex: 1,
            background: 'linear-gradient(180deg, #0d1f38 0%, #080f1e 100%)',
            borderRadius: '20px 20px 0 0',
            border: '1px solid rgba(255,255,255,0.08)',
            borderBottom: 'none',
            maxHeight: '75vh',
            display: 'flex', flexDirection: 'column',
            animation: 'slideUp 0.25s cubic-bezier(0.22,1,0.36,1)',
            boxShadow: '0 -20px 60px rgba(0,0,0,0.5)',
          }}>
            {/* Handle */}
            <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 4px' }}>
              <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.15)' }} />
            </div>

            {/* Header */}
            <div style={{ padding: '8px 18px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ color: '#94a3b8', fontSize: '0.85rem', fontWeight: 600 }}>{label || placeholder}</span>
              <button onClick={close} style={{ background: 'rgba(255,255,255,0.07)', border: 'none', borderRadius: 8, color: '#94a3b8', padding: '5px 10px', cursor: 'pointer', fontSize: '0.8rem' }}>✕ Kapat</button>
            </div>

            {/* Search */}
            {searchable && (
              <div style={{ padding: '0 14px 10px' }}>
                <input
                  ref={searchRef}
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="🔍 Ara..."
                  style={{ ...inp, background: '#0a1628', border: '1px solid #1e3a5f' }}
                />
              </div>
            )}

            {/* Options */}
            <div style={{ overflowY: 'auto', flex: 1, padding: '0 10px 20px' }}>
              {/* Clear option */}
              {value && (
                <button
                  onClick={() => { onChange(''); close(); }}
                  style={{
                    width: '100%', padding: '12px 14px', marginBottom: 4,
                    background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)',
                    borderRadius: 10, color: '#f87171', fontSize: '0.88rem',
                    textAlign: 'left', cursor: 'pointer',
                  }}
                >✕ Seçimi Temizle</button>
              )}

              {filtered.length === 0 && (
                <div style={{ textAlign: 'center', color: '#475569', padding: '30px 0', fontSize: '0.88rem' }}>Sonuç bulunamadı</div>
              )}

              {filtered.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => { onChange(opt.value); close(); }}
                  style={{
                    width: '100%', padding: '13px 14px', marginBottom: 4,
                    background: opt.value === value ? 'rgba(255,87,34,0.12)' : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${opt.value === value ? 'rgba(255,87,34,0.3)' : 'rgba(255,255,255,0.06)'}`,
                    borderRadius: 10, color: opt.value === value ? '#ff7043' : '#e2e8f0',
                    fontSize: '0.9rem', textAlign: 'left', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    transition: 'all 0.15s',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: opt.value === value ? 700 : 400 }}>{opt.label}</div>
                    {opt.sub && <div style={{ fontSize: '0.75rem', color: '#475569', marginTop: 2 }}>{opt.sub}</div>}
                  </div>
                  {opt.value === value && <span style={{ fontSize: '1rem' }}>✓</span>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
