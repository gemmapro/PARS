import { useState, useMemo, useRef } from 'react';
import { genId, formatDate } from '@/lib/utils-tr';
import type { DB, Note } from '@/types';

interface Props { db: DB; save: (fn: (prev: DB) => DB) => void; }

const NOTE_COLORS = [
  { id: 'default', bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.08)', label: '⬜' },
  { id: 'yellow',  bg: 'rgba(251,191,36,0.12)',  border: 'rgba(251,191,36,0.3)',   label: '🟡' },
  { id: 'green',   bg: 'rgba(16,185,129,0.12)',  border: 'rgba(16,185,129,0.3)',   label: '🟢' },
  { id: 'red',     bg: 'rgba(239,68,68,0.12)',   border: 'rgba(239,68,68,0.3)',    label: '🔴' },
  { id: 'blue',    bg: 'rgba(59,130,246,0.12)',  border: 'rgba(59,130,246,0.3)',   label: '🔵' },
  { id: 'purple',  bg: 'rgba(139,92,246,0.12)',  border: 'rgba(139,92,246,0.3)',   label: '🟣' },
];

function getColor(id?: string) {
  return NOTE_COLORS.find(c => c.id === id) || NOTE_COLORS[0];
}

export default function Notlar({ db, save }: Props) {
  const notes = useMemo(() =>
    [...(db.notes || [])].filter(n => !n.deleted).sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    }), [db.notes]);

  const [search, setSearch] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ title: '', content: '', color: 'default', tags: '' });
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const textRef = useRef<HTMLTextAreaElement>(null);

  const filtered = search
    ? notes.filter(n =>
        n.title.toLowerCase().includes(search.toLowerCase()) ||
        n.content.toLowerCase().includes(search.toLowerCase()) ||
        (n.tags || []).some(t => t.toLowerCase().includes(search.toLowerCase()))
      )
    : notes;

  const openNew = () => {
    setForm({ title: '', content: '', color: 'default', tags: '' });
    setEditId('new');
    setTimeout(() => textRef.current?.focus(), 100);
  };

  const openEdit = (n: Note) => {
    setForm({ title: n.title, content: n.content, color: n.color || 'default', tags: (n.tags || []).join(', ') });
    setEditId(n.id);
  };

  const handleSave = () => {
    if (!form.content.trim() && !form.title.trim()) return;
    const nowIso = new Date().toISOString();
    const tags = form.tags.split(',').map(t => t.trim()).filter(Boolean);
    save(prev => {
      const notes = [...(prev.notes || [])];
      if (editId === 'new') {
        notes.unshift({ id: genId(), title: form.title, content: form.content, color: form.color, tags, pinned: false, createdAt: nowIso, updatedAt: nowIso });
      } else {
        const i = notes.findIndex(n => n.id === editId);
        if (i >= 0) notes[i] = { ...notes[i], title: form.title, content: form.content, color: form.color, tags, updatedAt: nowIso };
      }
      return { ...prev, notes };
    });
    setEditId(null);
  };

  const togglePin = (id: string) => {
    save(prev => ({ ...prev, notes: (prev.notes || []).map(n => n.id === id ? { ...n, pinned: !n.pinned, updatedAt: new Date().toISOString() } : n) }));
  };

  const deleteNote = (id: string) => {
    save(prev => ({ ...prev, notes: (prev.notes || []).map(n => n.id === id ? { ...n, deleted: true, updatedAt: new Date().toISOString() } : n) }));
  };

  const copyNote = (n: Note) => {
    navigator.clipboard.writeText(`${n.title ? n.title + '\n\n' : ''}${n.content}`).catch(() => {});
  };

  const pinnedCount = notes.filter(n => n.pinned).length;

  return (
    <div style={{ animation: 'fadeIn 0.3s ease' }}>
      {/* Header */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={openNew} style={{ background: 'linear-gradient(135deg, #ff5722, #ff7043)', border: 'none', borderRadius: 10, color: '#fff', padding: '10px 20px', fontWeight: 700, cursor: 'pointer', fontSize: '0.9rem' }}>
          + Yeni Not
        </button>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="🔍 Not ara..."
          style={{ flex: 1, padding: '9px 13px', background: '#1e293b', border: '1px solid #334155', borderRadius: 10, color: '#f1f5f9', fontSize: '0.9rem' }}
        />
        <div style={{ display: 'flex', gap: 4 }}>
          {(['grid', 'list'] as const).map(v => (
            <button key={v} onClick={() => setView(v)} style={{ padding: '8px 12px', border: 'none', borderRadius: 8, cursor: 'pointer', background: view === v ? '#ff5722' : '#273548', color: view === v ? '#fff' : '#64748b', fontSize: '1rem' }}>
              {v === 'grid' ? '⊞' : '☰'}
            </button>
          ))}
        </div>
        <div style={{ color: '#475569', fontSize: '0.8rem' }}>
          {notes.length} not{pinnedCount > 0 ? ` · ${pinnedCount} sabitlenmiş` : ''}
        </div>
      </div>

      {/* Edit / New Form */}
      {editId && (
        <div style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))', border: '1px solid rgba(255,87,34,0.3)', borderRadius: 16, padding: 18, marginBottom: 20 }}>
          <input
            value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            placeholder="Başlık (opsiyonel)..."
            style={{ width: '100%', padding: '8px 12px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, color: '#f1f5f9', fontSize: '0.95rem', fontWeight: 700, marginBottom: 10, boxSizing: 'border-box' }}
          />
          <textarea
            ref={textRef}
            value={form.content}
            onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
            placeholder="Notunuzu buraya yazın..."
            rows={6}
            style={{ width: '100%', padding: '10px 12px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, color: '#f1f5f9', fontSize: '0.9rem', resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.6, fontFamily: 'inherit' }}
          />
          <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            {/* Renk seçici */}
            <div style={{ display: 'flex', gap: 5 }}>
              {NOTE_COLORS.map(c => (
                <button key={c.id} onClick={() => setForm(f => ({ ...f, color: c.id }))}
                  style={{ width: 26, height: 26, borderRadius: '50%', border: form.color === c.id ? '2px solid #fff' : '2px solid transparent', background: c.bg, cursor: 'pointer', fontSize: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {c.label}
                </button>
              ))}
            </div>
            <input
              value={form.tags}
              onChange={e => setForm(f => ({ ...f, tags: e.target.value }))}
              placeholder="Etiketler (virgülle ayır)..."
              style={{ flex: 1, minWidth: 120, padding: '6px 10px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 7, color: '#94a3b8', fontSize: '0.8rem' }}
            />
            <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
              <button onClick={() => setEditId(null)} style={{ padding: '8px 16px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, color: '#64748b', cursor: 'pointer', fontWeight: 600 }}>İptal</button>
              <button onClick={handleSave} style={{ padding: '8px 20px', background: 'linear-gradient(135deg, #ff5722, #ff7043)', border: 'none', borderRadius: 8, color: '#fff', cursor: 'pointer', fontWeight: 700 }}>💾 Kaydet</button>
            </div>
          </div>
        </div>
      )}

      {/* Notes */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: '#334155' }}>
          <div style={{ fontSize: '3rem', marginBottom: 12 }}>📝</div>
          <p style={{ fontSize: '0.9rem' }}>{search ? 'Not bulunamadı' : 'Henüz not yok — yukarıdan ekleyin'}</p>
        </div>
      ) : (
        <div style={view === 'grid'
          ? { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }
          : { display: 'flex', flexDirection: 'column', gap: 8 }
        }>
          {filtered.map(n => {
            const c = getColor(n.color);
            return (
              <div key={n.id} style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 14, padding: '14px 16px', position: 'relative', cursor: 'pointer', transition: 'all 0.2s' }}
                onClick={() => openEdit(n)}
                onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)'}
                onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.transform = ''}
              >
                {n.pinned && <div style={{ position: 'absolute', top: 10, right: 10, fontSize: '0.8rem' }}>📌</div>}
                {n.title && <div style={{ fontWeight: 700, color: '#f1f5f9', fontSize: '0.9rem', marginBottom: 6, paddingRight: 20 }}>{n.title}</div>}
                <div style={{ color: '#94a3b8', fontSize: '0.83rem', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: view === 'grid' ? 120 : 'none', overflow: 'hidden' }}>
                  {n.content}
                </div>
                {(n.tags || []).length > 0 && (
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 8 }}>
                    {(n.tags || []).map(t => (
                      <span key={t} style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 5, padding: '1px 7px', fontSize: '0.7rem', color: '#64748b' }}>#{t}</span>
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
                  <span style={{ color: '#334155', fontSize: '0.7rem' }}>{formatDate(n.updatedAt)}</span>
                  <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
                    <button onClick={() => togglePin(n.id)} title={n.pinned ? 'Sabitlemeyi kaldır' : 'Sabitle'}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.85rem', opacity: n.pinned ? 1 : 0.4, padding: '2px 4px' }}>📌</button>
                    <button onClick={() => copyNote(n)} title="Kopyala"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.85rem', opacity: 0.6, padding: '2px 4px' }}>📋</button>
                    <button onClick={() => deleteNote(n.id)} title="Sil"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.85rem', color: '#ef4444', opacity: 0.6, padding: '2px 4px' }}>🗑️</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
