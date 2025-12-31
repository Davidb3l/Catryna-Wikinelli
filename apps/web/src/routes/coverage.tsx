import { useCoverage } from '@/lib/graphql/hooks'
import { BarChart3, FileText, AlertCircle, CheckCircle, Sparkles, Terminal } from 'lucide-react'

export function CoveragePage() {
  const { data: coverage, isLoading } = useCoverage()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500" />
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-12 py-6 sm:py-12">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 sm:mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-zinc-900 dark:text-zinc-50 flex items-center gap-2 sm:gap-3">
            <BarChart3 size={24} className="sm:w-7 sm:h-7" />
            Coverage
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1 sm:mt-2">
            Track documentation gaps
          </p>
        </div>
        <button className="flex items-center justify-center gap-2 px-4 py-2.5 sm:py-2 rounded-xl bg-indigo-500 text-white hover:bg-indigo-600 active:scale-95 transition-all text-sm font-medium w-full sm:w-auto">
          <Sparkles size={16} />
          Auto-Generate Missing
        </button>
      </div>

      {coverage && (
        <>
          {/* Stats Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-6 mb-8 sm:mb-12">
            <div className="p-4 sm:p-6 bg-zinc-50 dark:bg-zinc-900 rounded-xl sm:rounded-2xl border border-zinc-100 dark:border-zinc-800">
              <div className="text-[10px] sm:text-xs text-zinc-400 font-bold uppercase mb-1 sm:mb-2">Health Score</div>
              <div
                className={`text-3xl sm:text-4xl font-black ${
                  coverage.coveragePercent >= 80
                    ? 'text-green-500'
                    : coverage.coveragePercent >= 50
                    ? 'text-amber-500'
                    : 'text-red-500'
                }`}
              >
                {Math.round(coverage.coveragePercent)}%
              </div>
            </div>
            <div className="p-4 sm:p-6 bg-zinc-50 dark:bg-zinc-900 rounded-xl sm:rounded-2xl border border-zinc-100 dark:border-zinc-800">
              <div className="text-[10px] sm:text-xs text-zinc-400 font-bold uppercase mb-1 sm:mb-2">Documented</div>
              <div className="text-3xl sm:text-4xl font-black text-zinc-900 dark:text-white">
                {coverage.documentedModules}/{coverage.totalModules}
              </div>
            </div>
            <div className="p-4 sm:p-6 bg-zinc-50 dark:bg-zinc-900 rounded-xl sm:rounded-2xl border border-zinc-100 dark:border-zinc-800">
              <div className="text-[10px] sm:text-xs text-zinc-400 font-bold uppercase mb-1 sm:mb-2">Missing Docs</div>
              <div className="text-3xl sm:text-4xl font-black text-amber-500">
                {coverage.undocumentedFiles.length}
              </div>
            </div>
          </div>

          {/* Undocumented Files */}
          {coverage.undocumentedFiles.length > 0 && (
            <div className="mb-8 sm:mb-12">
              <h2 className="text-base sm:text-lg font-bold mb-3 sm:mb-4 flex items-center gap-2">
                <AlertCircle size={18} className="text-amber-500" />
                Missing Documentation
              </h2>
              <div className="space-y-2">
                {coverage.undocumentedFiles.map((file: string) => (
                  <div
                    key={file}
                    className="p-3 sm:p-4 bg-white dark:bg-zinc-900/50 rounded-xl border border-zinc-100 dark:border-zinc-800 flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                      <Terminal size={16} className="text-zinc-400 shrink-0" />
                      <span className="text-xs sm:text-sm font-mono truncate">{file}</span>
                    </div>
                    <span className="text-[10px] sm:text-xs font-bold text-amber-500 shrink-0">Missing</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recently Updated */}
          {coverage.recentlyUpdated && coverage.recentlyUpdated.length > 0 && (
            <div className="mb-8 sm:mb-12">
              <h2 className="text-base sm:text-lg font-bold mb-3 sm:mb-4 flex items-center gap-2">
                <CheckCircle size={18} className="text-green-500" />
                Recently Updated
              </h2>
              <div className="space-y-2">
                {coverage.recentlyUpdated.map((doc: any) => (
                  <div
                    key={doc.id}
                    className="p-3 sm:p-4 bg-white dark:bg-zinc-900/50 rounded-xl border border-zinc-100 dark:border-zinc-800 flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                      <FileText size={16} className="text-green-500 shrink-0" />
                      <div className="min-w-0">
                        <span className="text-sm font-medium block truncate">{doc.title}</span>
                        <span className="text-xs text-zinc-500 truncate block sm:inline sm:ml-0">{doc.path}</span>
                      </div>
                    </div>
                    <span className="text-[10px] sm:text-xs text-zinc-400 shrink-0 hidden sm:block">
                      {new Date(doc.updatedAt).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Stale Documents */}
          {coverage.staleDocuments && coverage.staleDocuments.length > 0 && (
            <div>
              <h2 className="text-base sm:text-lg font-bold mb-3 sm:mb-4 flex items-center gap-2">
                <AlertCircle size={18} className="text-zinc-400" />
                <span className="truncate">Stale Documents (30+ days)</span>
              </h2>
              <div className="space-y-2">
                {coverage.staleDocuments.map((doc: any) => (
                  <div
                    key={doc.id}
                    className="p-3 sm:p-4 bg-white dark:bg-zinc-900/50 rounded-xl border border-zinc-100 dark:border-zinc-800 flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                      <FileText size={16} className="text-zinc-400 shrink-0" />
                      <div className="min-w-0">
                        <span className="text-sm font-medium block truncate">{doc.title}</span>
                        <span className="text-xs text-zinc-500 truncate block sm:inline sm:ml-0">{doc.path}</span>
                      </div>
                    </div>
                    <span className="text-[10px] sm:text-xs text-zinc-400 shrink-0 hidden sm:block">
                      {new Date(doc.updatedAt).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
