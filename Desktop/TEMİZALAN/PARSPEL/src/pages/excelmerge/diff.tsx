import { useState, useMemo } from "react";
import { GitCompare, ChevronDown, AlertTriangle, Plus, Minus, Pencil, Minus as MinusIcon, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { type ExcelFile, diffSheets } from "@/lib/excel-merge";

interface DiffPageProps {
  files: ExcelFile[];
}

type FilterType = "all" | "added" | "removed" | "modified";

export default function DiffPage({ files }: DiffPageProps) {
  const [fileAId, setFileAId] = useState<string>("");
  const [fileBId, setFileBId] = useState<string>("");
  const [selectedSheet, setSelectedSheet] = useState<string>("");
  const [keyColumn, setKeyColumn] = useState<string>("");
  const [filter, setFilter] = useState<FilterType>("all");

  const fileA = files.find((f) => f.id === fileAId);
  const fileB = files.find((f) => f.id === fileBId);

  const commonSheets = useMemo(() => {
    if (!fileA || !fileB) return [];
    const sheetsA = new Set(fileA.sheets.map((s) => s.name));
    return fileB.sheets
      .filter((s) => sheetsA.has(s.name))
      .map((s) => s.name);
  }, [fileA, fileB]);

  const sheetA = fileA?.sheets.find((s) => s.name === selectedSheet);
  const sheetB = fileB?.sheets.find((s) => s.name === selectedSheet);

  const allHeaders = useMemo(() => {
    if (!sheetA || !sheetB) return [];
    return Array.from(new Set([...sheetA.headers, ...sheetB.headers]));
  }, [sheetA, sheetB]);

  const diffResult = useMemo(() => {
    if (!sheetA || !sheetB) return null;
    return diffSheets(sheetA, sheetB, keyColumn || undefined);
  }, [sheetA, sheetB, keyColumn]);

  const filteredRows = useMemo(() => {
    if (!diffResult) return [];
    if (filter === "all") return diffResult.rows.filter((r) => r.status !== "unchanged");
    return diffResult.rows.filter((r) => r.status === filter);
  }, [diffResult, filter]);

  if (files.length < 2) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="text-center py-16">
          <GitCompare className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-foreground mb-2">Karsılastırma icin en az 2 dosya gerekli</h2>
          <p className="text-muted-foreground">Lutfen once Dosya Yukle sayfasindan en az 2 Excel dosyasi yukleyin.</p>
        </div>
      </div>
    );
  }

  const statusLabel: Record<string, string> = {
    added: "Eklendi",
    removed: "Silindi",
    modified: "Degisti",
    unchanged: "Degismedi",
  };

  const statusColor: Record<string, string> = {
    added: "diff-added",
    removed: "diff-removed",
    modified: "diff-modified",
    unchanged: "",
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dosya Karsılastır</h1>
        <p className="text-muted-foreground mt-1">
          Iki Excel dosyasinin farkini bul. Hangi satirlar eklenmis, silinmis veya degismis goster.
        </p>
      </div>

      <Card className="border border-card-border">
        <CardHeader>
          <CardTitle className="text-base">Karsılastırma Ayarlari</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">Orijinal Dosya (A)</label>
              <Select value={fileAId} onValueChange={(v) => { setFileAId(v); setSelectedSheet(""); setKeyColumn(""); }} data-testid="select-file-a">
                <SelectTrigger>
                  <SelectValue placeholder="Dosya secin..." />
                </SelectTrigger>
                <SelectContent>
                  {files.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.name}
                      {f.isRecovery && " ⚠"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">Yeni Dosya (B)</label>
              <Select value={fileBId} onValueChange={(v) => { setFileBId(v); setSelectedSheet(""); setKeyColumn(""); }} data-testid="select-file-b">
                <SelectTrigger>
                  <SelectValue placeholder="Dosya secin..." />
                </SelectTrigger>
                <SelectContent>
                  {files.filter((f) => f.id !== fileAId).map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.name}
                      {f.isRecovery && " ⚠"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {commonSheets.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-sm font-medium text-foreground">Sayfa</label>
                <Select value={selectedSheet} onValueChange={(v) => { setSelectedSheet(v); setKeyColumn(""); }} data-testid="select-sheet">
                  <SelectTrigger>
                    <SelectValue placeholder="Sayfa secin..." />
                  </SelectTrigger>
                  <SelectContent>
                    {commonSheets.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {allHeaders.length > 0 && (
                <div className="space-y-1">
                  <label className="text-sm font-medium text-foreground">
                    Anahtar Sutun (opsiyonel)
                  </label>
                  <Select value={keyColumn} onValueChange={setKeyColumn} data-testid="select-key-column">
                    <SelectTrigger>
                      <SelectValue placeholder="Satir numarasiyla eslesir" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Satir numarasiyla karsilastir</SelectItem>
                      {allHeaders.map((h) => (
                        <SelectItem key={h} value={h}>{h}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Siparis No, TC No gibi benzersiz kimlik sutunu secerseniz daha dogru sonuc alirsiniz
                  </p>
                </div>
              )}
            </div>
          )}

          {fileAId && fileBId && commonSheets.length === 0 && (
            <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-yellow-600" />
              <span className="text-sm text-yellow-700 dark:text-yellow-400">
                Bu iki dosyada ortak sayfa bulunamadi. Sayfa adlari farkli olabilir.
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {diffResult && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Eklenen", count: diffResult.addedCount, color: "text-green-600", bg: "bg-green-50 dark:bg-green-900/20", icon: Plus },
              { label: "Silinen", count: diffResult.removedCount, color: "text-red-600", bg: "bg-red-50 dark:bg-red-900/20", icon: Minus },
              { label: "Degisen", count: diffResult.modifiedCount, color: "text-yellow-600", bg: "bg-yellow-50 dark:bg-yellow-900/20", icon: Pencil },
              { label: "Degismeyen", count: diffResult.unchangedCount, color: "text-muted-foreground", bg: "bg-muted/50", icon: MinusIcon },
            ].map(({ label, count, color, bg, icon: Icon }) => (
              <div key={label} className={`p-4 rounded-xl border border-border ${bg}`}>
                <div className={`text-2xl font-bold ${color}`}>{count.toLocaleString("tr-TR")}</div>
                <div className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                  <Icon className="w-3 h-3" />
                  {label} Satir
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Filtrele:</span>
            {(["all", "added", "removed", "modified"] as FilterType[]).map((f) => (
              <Button
                key={f}
                variant={filter === f ? "default" : "outline"}
                size="sm"
                onClick={() => setFilter(f)}
                data-testid={`button-filter-${f}`}
              >
                {f === "all" ? "Tum Degisiklikler" : statusLabel[f]}
              </Button>
            ))}
          </div>

          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b border-border">
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground w-10">#</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground w-24">Durum</th>
                  {allHeaders.map((h) => (
                    <th key={h} className="text-left px-3 py-2 font-medium text-muted-foreground max-w-40">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 && (
                  <tr>
                    <td colSpan={allHeaders.length + 2} className="text-center py-12 text-muted-foreground">
                      Bu filtreyle eslesen satir bulunamadi
                    </td>
                  </tr>
                )}
                {filteredRows.map((row) => (
                  <tr
                    key={row.rowIndex}
                    className={`border-b border-border last:border-0 ${statusColor[row.status]}`}
                  >
                    <td className="px-3 py-2 text-muted-foreground text-xs">{row.rowIndex + 1}</td>
                    <td className="px-3 py-2">
                      <Badge
                        variant="outline"
                        className={`text-xs ${
                          row.status === "added" ? "text-green-600 border-green-400" :
                          row.status === "removed" ? "text-red-600 border-red-400" :
                          row.status === "modified" ? "text-yellow-600 border-yellow-400" :
                          "text-muted-foreground"
                        }`}
                      >
                        {statusLabel[row.status]}
                      </Badge>
                    </td>
                    {allHeaders.map((h) => {
                      const oldVal = row.oldValues?.[h];
                      const newVal = row.newValues?.[h];
                      const isChanged = row.changedCells?.includes(h);

                      return (
                        <td
                          key={h}
                          className={`px-3 py-2 max-w-40 overflow-hidden text-ellipsis whitespace-nowrap ${
                            isChanged ? "diff-cell-modified" :
                            row.status === "added" ? "diff-cell-added" :
                            row.status === "removed" ? "diff-cell-removed" : ""
                          }`}
                          title={isChanged ? `Onceki: ${oldVal ?? ""} → Yeni: ${newVal ?? ""}` : undefined}
                        >
                          {isChanged ? (
                            <span className="flex flex-col gap-0.5">
                              <span className="text-red-500 line-through text-xs opacity-70">{String(oldVal ?? "")}</span>
                              <span className="text-green-600 text-xs font-semibold">{String(newVal ?? "")}</span>
                            </span>
                          ) : (
                            String(
                              row.status === "removed"
                                ? (oldVal ?? "")
                                : (newVal ?? oldVal ?? "")
                            )
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filteredRows.length > 0 && (
            <p className="text-xs text-muted-foreground text-right">
              {filteredRows.length} satir gosteriliyor
            </p>
          )}
        </>
      )}
    </div>
  );
}

