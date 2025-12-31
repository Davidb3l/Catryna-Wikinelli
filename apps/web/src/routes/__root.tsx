import { createRootRoute, Outlet, Link } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import { usePreferences } from '@/lib/storage/preferences'
import { Search, Settings, Menu, X, FileText, BarChart3 } from 'lucide-react'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      refetchOnWindowFocus: false,
    },
  },
})

function RootLayout() {
  // Start with sidebar closed on mobile
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(true)
  const { preferences } = usePreferences()

  // Check screen size on mount and resize
  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 1024
      setIsMobile(mobile)
      // Auto-open sidebar on desktop
      if (!mobile) {
        setIsSidebarOpen(true)
      }
    }
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  // Keyboard shortcut for search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setIsSearchOpen(true)
      }
      if (e.key === 'Escape') {
        setIsSearchOpen(false)
        if (isMobile) setIsSidebarOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isMobile])

  // Close sidebar when navigating on mobile
  const handleNavClick = () => {
    if (isMobile) {
      setIsSidebarOpen(false)
    }
  }

  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex h-[100dvh] w-full overflow-hidden bg-white dark:bg-zinc-950 transition-colors">
        {/* Mobile overlay */}
        {isSidebarOpen && isMobile && (
          <div
            className="fixed inset-0 bg-black/50 z-40"
            onClick={() => setIsSidebarOpen(false)}
          />
        )}

        {/* Sidebar */}
        <aside
          className={`
            fixed lg:relative h-full z-50
            bg-zinc-50 dark:bg-zinc-950
            border-r border-zinc-200 dark:border-zinc-800
            transition-transform duration-300 ease-in-out
            w-64 shrink-0
            ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
            ${!isSidebarOpen && !isMobile ? 'lg:w-0 lg:border-0 lg:overflow-hidden' : ''}
          `}
        >
          <div className="flex flex-col h-full w-64">
            <div className="p-3 sm:p-4 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 shrink-0 h-14">
              <Link
                to="/"
                onClick={handleNavClick}
                className="flex items-center gap-2 font-bold tracking-tight text-zinc-900 dark:text-zinc-50"
              >
                <div className="w-7 h-7 sm:w-6 sm:h-6 bg-zinc-900 dark:bg-zinc-100 rounded flex items-center justify-center text-white dark:text-zinc-900 shadow-xl">
                  <span className="text-sm sm:text-xs">🐱</span>
                </div>
                <span className="text-base sm:text-sm">Catryna</span>
                <span className="text-[10px] text-zinc-400 hidden sm:inline">Meow</span>
              </Link>
              <button
                onClick={() => setIsSidebarOpen(false)}
                className="lg:hidden p-2 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-lg"
                aria-label="Close sidebar"
              >
                <X size={20} />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto p-2">
              <Link
                to="/"
                onClick={handleNavClick}
                className="flex items-center gap-3 px-3 py-3 sm:py-2 rounded-lg text-base sm:text-sm text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 active:bg-zinc-200 dark:active:bg-zinc-800"
              >
                <FileText size={20} className="sm:w-4 sm:h-4" />
                All Docs
              </Link>
              <Link
                to="/coverage"
                onClick={handleNavClick}
                className="flex items-center gap-3 px-3 py-3 sm:py-2 rounded-lg text-base sm:text-sm text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 active:bg-zinc-200 dark:active:bg-zinc-800"
              >
                <BarChart3 size={20} className="sm:w-4 sm:h-4" />
                Coverage
              </Link>
            </nav>

            <div className="p-3 sm:p-4 border-t border-zinc-200 dark:border-zinc-800">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 sm:w-8 sm:h-8 rounded-full bg-indigo-500 flex items-center justify-center text-white font-bold text-sm sm:text-xs">
                  🐱
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm sm:text-xs font-semibold truncate">Catryna Wikinelli</div>
                  <div className="text-xs sm:text-[10px] text-zinc-500">Meow 🐱 v1.0.0</div>
                </div>
                <Link
                  to="/settings"
                  onClick={handleNavClick}
                  className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg"
                >
                  <Settings
                    size={20}
                    className="sm:w-4 sm:h-4 text-zinc-400 hover:text-indigo-500"
                  />
                </Link>
              </div>
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 flex flex-col min-w-0 bg-white dark:bg-zinc-950 relative">
          <header className="h-14 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between px-3 sm:px-6 shrink-0 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-md sticky top-0 z-30">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setIsSidebarOpen(true)}
                className={`p-2 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-lg ${isSidebarOpen && !isMobile ? 'lg:hidden' : ''}`}
                aria-label="Open sidebar"
              >
                <Menu size={20} />
              </button>
              <div className="hidden sm:flex items-center gap-1.5 text-[10px] font-bold text-green-500">
                <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                <span>Local Synced</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsSearchOpen(true)}
                className="flex items-center gap-2 p-2 sm:px-3 sm:py-1.5 rounded-lg text-sm text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900"
                aria-label="Search"
              >
                <Search size={20} className="sm:w-4 sm:h-4" />
                <kbd className="hidden md:inline opacity-50 text-xs">Ctrl+K</kbd>
              </button>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto overscroll-contain">
            <Outlet />
          </div>
        </main>

        {/* Search Modal */}
        {isSearchOpen && (
          <SearchModal onClose={() => setIsSearchOpen(false)} />
        )}
      </div>
    </QueryClientProvider>
  )
}

function SearchModal({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center pt-[10vh] sm:pt-[15vh] bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-white dark:bg-zinc-900 rounded-xl shadow-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
          <Search size={20} className="text-zinc-400 shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 bg-transparent border-none outline-none text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500 text-base sm:text-sm min-w-0"
            placeholder="Search docs..."
          />
          <button
            onClick={onClose}
            className="sm:hidden p-1 text-zinc-400"
          >
            <X size={20} />
          </button>
          <kbd className="hidden sm:inline px-1.5 py-0.5 rounded border border-zinc-200 dark:border-zinc-800 text-[10px] text-zinc-400 shrink-0">
            ESC
          </kbd>
        </div>
        <div className="p-4 max-h-[60vh] sm:max-h-[400px] overflow-y-auto">
          {query ? (
            <div className="text-sm text-zinc-500">
              Searching for "{query}"...
            </div>
          ) : (
            <div className="text-sm text-zinc-500">
              Start typing to search documentation...
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export const rootRoute = createRootRoute({
  component: RootLayout,
})
