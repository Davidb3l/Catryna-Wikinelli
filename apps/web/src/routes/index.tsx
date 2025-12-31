import { Link } from '@tanstack/react-router'
import { useDocs } from '@/lib/graphql/hooks'
import { FileText, Clock, Tag } from 'lucide-react'

export function HomePage() {
  const { data: docs, isLoading, error } = useDocs()

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-12 py-6 sm:py-12">
      <h1 className="text-2xl sm:text-4xl font-black tracking-tight mb-2 sm:mb-4 text-zinc-900 dark:text-zinc-50">
        Documentation
      </h1>
      <p className="text-sm sm:text-base text-zinc-600 dark:text-zinc-400 mb-6 sm:mb-8">
        Browse and search your project documentation
      </p>

      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500" />
        </div>
      )}

      {error && (
        <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded-lg p-4 text-sm text-red-600 dark:text-red-400">
          Failed to load documents. Make sure the server is running.
        </div>
      )}

      {docs && docs.length === 0 && (
        <div className="text-center py-12">
          <FileText size={48} className="mx-auto text-zinc-300 dark:text-zinc-700 mb-4" />
          <h2 className="text-lg font-semibold text-zinc-700 dark:text-zinc-300 mb-2">
            No documentation yet
          </h2>
          <p className="text-sm text-zinc-500 mb-4 px-4">
            Use Claude Code with MCP tools to generate documentation for your project.
          </p>
        </div>
      )}

      {docs && docs.length > 0 && (
        <div className="space-y-3">
          {docs.map((doc) => (
            <Link
              key={doc.id}
              to="/docs/$docPath"
              params={{ docPath: encodeURIComponent(doc.path) }}
              className="block p-3 sm:p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 hover:border-indigo-500/50 active:bg-zinc-50 dark:active:bg-zinc-900 transition-all bg-white dark:bg-zinc-900/50 group"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <FileText
                    size={20}
                    className="text-zinc-400 group-hover:text-indigo-500 transition-colors shrink-0 mt-0.5"
                  />
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 group-hover:text-indigo-500 transition-colors truncate">
                      {doc.title}
                    </h3>
                    <p className="text-xs sm:text-sm text-zinc-500 truncate">{doc.path}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-[10px] sm:text-xs text-zinc-400 shrink-0">
                  <Clock size={12} />
                  <span className="hidden sm:inline">{new Date(doc.updatedAt).toLocaleDateString()}</span>
                  <span className="sm:hidden">{new Date(doc.updatedAt).toLocaleDateString('en', { month: 'short', day: 'numeric' })}</span>
                </div>
              </div>
              {doc.tags && doc.tags.length > 0 && (
                <div className="flex items-center gap-2 mt-2 sm:mt-3 ml-8 overflow-x-auto">
                  <Tag size={12} className="text-zinc-400 shrink-0" />
                  {doc.tags.slice(0, 3).map((tag) => (
                    <span
                      key={tag}
                      className="px-2 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded text-[10px] sm:text-xs text-zinc-600 dark:text-zinc-400 whitespace-nowrap"
                    >
                      {tag}
                    </span>
                  ))}
                  {doc.tags.length > 3 && (
                    <span className="text-[10px] text-zinc-400">+{doc.tags.length - 3}</span>
                  )}
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
