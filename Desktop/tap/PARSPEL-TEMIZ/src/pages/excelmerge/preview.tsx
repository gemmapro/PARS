import { useState } from "react";
import { Eye, FileSpreadsheet, ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { type ExcelFile } from "@/lib/excel-merge";

interface PreviewPageProps {
  files: ExcelFile[];
}

export default function PreviewPage({ files }: PreviewPageProps) {
  const [selectedFileId, setSelectedFileId] = useState<string>("");
  const [selectedSheet, setSelectedSheet] = useState<string>("");
  const [filterText, setFilterText] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 100;

  const file = files.find((f) => f.id === selectedFileId);
  const sheet = file?.sheets.find((s) => s.name === selectedSheet);

  const filteredRows = sheet?.rows.filter((row) => {
    if (!filterText.trim()) return true;
    return Object.values(row).some((v) =>
      String(v ?? "").toLowerCase().includes(filterText.toLowerCase())
    );
  }) ?? [];

  const totalPages = Math.ceil(filteredRows.length / pageSize);
  const pagedRows = filteredRows.slice((page - 1) * pageSize, page * pageSize);

  if (files.length === 0) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="text-center py-16">
          <Eye className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-foreground mb-2">Onizleme icin dosya gerekli</h2>
          <p className="text-muted-foreground">Lutfen once Dosya Yukle sayfasindan Excel dosyalari yukleyin.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-full mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dosya Onizleme</h1>
        <p className="text-muted-foreground mt-1">
          Yuklenen dosyalarin icinde hizlica gezinin ve filtreleyin.
        </p>
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <label className="text-sm font-medium text-foreground">Dosya</label>
          <Select
            value={selectedFileId}
            onValueChange={(v) => { setSelectedFileId(v); setSelectedSheet(""); setPage(1); setFilterText(""); }}
            data-testid="select-preview-file"
          >
            <SelectTrigger className="w-64">
              <SelectValue placeholder="Dosya secin..." />
            </SelectTrigger>
            <SelectContent>
              {files.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  <span className="flex items-center gap-2">
                    <FileSpreadsheet className="w-3.5 h-3.5" />
                    {f.name}
                    {f.isRecovery && " ⚠"}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {file && (
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">Sayfa</label>
            <Select
              value={selectedSheet}
              onValueChange={(v) => { setSelectedSheet(v); setPage(1); setFilterText(""); }}
              data-testid="select-preview-sheet"
            >
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Sayfa secin..." />
              </SelectTrigger>
              <SelectContent>
                {file.sheets.map((s) => (
                  <SelectItem key={s.name} value={s.name}>
                    {s.name} ({s.rows.length} satir)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {sheet && (
          <div className="space-y-1 flex-1 min-w-48">
            <label className="text-sm font-medium text-foreground">Filtrele</label>
            <Input
              placeholder="Herhangi bir sutunda ara..."
              value={filterText}
              onChange={(e) => { setFilterText(e.target.value); setPage(1); }}
              data-testid="input-preview-filter"
            />
          </div>
        )}
      </div>

      {sheet && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                {filterText
                  ? `${filteredRows.length.toLocaleString("tr-TR")} / ${sheet.rows.length.toLocaleString("tr-TR")} satir`
                  : `${sheet.rows.length.toLocaleString("tr-TR")} satir, ${sheet.headers.length} sutun`}
              </span>
              {filterText && (
                <Badge variant="secondary" className="text-xs">Filtreli</Badge>
              )}
            </div>
            {totalPages > 1 && (
              <div className="flex items-center gap-2 text-sm">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-2 py-1 rounded border border-border hover:bg-muted disabled:opacity-40"
                  data-testid="button-prev-page"
                >
                  &#8249;
                </button>
                <span className="text-muted-foreground">{page} / {totalPages}</span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-2 py-1 rounded border border-border hover:bg-muted disabled:opacity-40"
                  data-testid="button-next-page"
                >
                  &#8250;
                </button>
              </div>
            )}
          </div>

          <div className="overflow-auto rounded-xl border border-border max-h-[calc(100vh-280px)]">
            <table className="text-sm w-full">
              <thead className="sticky top-0 z-10 bg-muted/90 backdrop-blur-sm">
                <tr>
                  <th className="text-left px-2 py-2 font-medium text-muted-foreground border-b border-r border-border w-10 text-xs">#</th>
                  {sheet.headers.map((h) => (
                    <th
                      key={h}
                      className="text-left px-3 py-2 font-medium text-foreground border-b border-r border-border last:border-r-0 whitespace-nowrap max-w-48 truncate"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pagedRows.length === 0 && (
                  <tr>
                    <td colSpan={sheet.headers.length + 1} className="text-center py-12 text-muted-foreground">
                      {filterText ? "Bu filtreyle satir bulunamadi" : "Bu sayfa bos"}
                    </td>
                  </tr>
                )}
                {pagedRows.map((row, i) => (
                  <tr
                    key={i}
                    className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                    data-testid={`preview-row-${i}`}
                  >
                    <td className="px-2 py-1.5 text-muted-foreground text-xs border-r border-border">
                      {(page - 1) * pageSize + i + 1}
                    </td>
                    {sheet.headers.map((h) => (
                      <td
                        key={h}
                        className="px-3 py-1.5 border-r border-border last:border-r-0 max-w-48 truncate text-foreground"
                        title={String(row[h] ?? "")}
                      >
                        {String(row[h] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

