import { useState } from 'react';
import { type ExcelFile } from '@/lib/excel-merge';
import UploadPage from './excelmerge/upload';
import PreviewPage from './excelmerge/preview';
import DiffPage from './excelmerge/diff';
import SearchPage from './excelmerge/search';
import MergePage from './excelmerge/merge';
import TemizlePage from './excelmerge/temizle';
import AiAsistanPage from './excelmerge/ai-asistan';

type Tab = 'upload' | 'preview' | 'diff' | 'search' | 'merge' | 'temizle' | 'ai';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'upload',  label: 'Dosya Yükle',    icon: '📂' },
  { id: 'preview', label: 'Önizleme',        icon: '👁️' },
  { id: 'diff',    label: 'Karşılaştır',     icon: '🔀' },
  { id: 'search',  label: 'Gelişmiş Arama',  icon: '🔍' },
  { id: 'merge',   label: 'Birleştir',       icon: '🔗' },
  { id: 'temizle', label: 'ETL Temizle',     icon: '✨' },
  { id: 'ai',      label: 'AI Asistan',      icon: '🤖' },
];

export default function ExcelMerge() {
  const [files, setFiles] = useState<ExcelFile[]>([]);
  const [tab, setTab] = useState<Tab>('upload');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, padding: '0 0 16px 0', flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '8px 14px', border: 'none', borderRadius: 10, cursor: 'pointer',
              fontWeight: 600, fontSize: '0.82rem', transition: 'all 0.15s',
              background: tab === t.id ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : 'rgba(255,255,255,0.05)',
              color: tab === t.id ? '#fff' : '#64748b',
            }}
          >
            {t.icon} {t.label}
            {t.id === 'upload' && files.length > 0 && (
              <span style={{ marginLeft: 6, background: 'rgba(255,255,255,0.25)', borderRadius: 10, padding: '1px 6px', fontSize: '0.72rem' }}>
                {files.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* İçerik */}
      <div style={{ flex: 1, overflow: 'auto', background: 'rgba(255,255,255,0.02)', borderRadius: 14, border: '1px solid rgba(255,255,255,0.07)', padding: 20 }}>
        {tab === 'upload'  && <UploadPage  files={files} onFilesChange={setFiles} />}
        {tab === 'preview' && <PreviewPage files={files} />}
        {tab === 'diff'    && <DiffPage    files={files} />}
        {tab === 'search'  && <SearchPage  files={files} />}
        {tab === 'merge'   && <MergePage   files={files} />}
        {tab === 'temizle' && <TemizlePage files={files} />}
        {tab === 'ai'      && <AiAsistanPage files={files} />}
      </div>
    </div>
  );
}
