import { usePreferences } from '@/lib/storage/preferences'
import { Settings, Sun, Moon, Monitor } from 'lucide-react'

export function SettingsPage() {
  const { preferences, updatePreferences } = usePreferences()

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-12 py-6 sm:py-12">
      <h1 className="text-2xl sm:text-3xl font-black tracking-tight mb-6 sm:mb-8 text-zinc-900 dark:text-zinc-50 flex items-center gap-3">
        <Settings size={24} className="sm:w-7 sm:h-7" />
        Preferences
      </h1>

      <div className="space-y-6 sm:space-y-8">
        {/* Theme */}
        <section>
          <label className="text-sm font-bold text-zinc-600 dark:text-zinc-400 mb-3 block">
            Theme
          </label>
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {(['light', 'dark', 'system'] as const).map((theme) => (
              <button
                key={theme}
                onClick={() => updatePreferences({ theme })}
                className={`p-3 sm:p-4 rounded-xl border flex flex-col items-center gap-1.5 sm:gap-2 transition-all active:scale-95 ${
                  preferences.theme === theme
                    ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950 text-indigo-600'
                    : 'border-zinc-200 dark:border-zinc-800 text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-700'
                }`}
              >
                {theme === 'light' && <Sun size={20} />}
                {theme === 'dark' && <Moon size={20} />}
                {theme === 'system' && <Monitor size={20} />}
                <span className="text-[10px] sm:text-xs font-bold uppercase">{theme}</span>
              </button>
            ))}
          </div>
        </section>

        {/* Whiteboard Style */}
        <section>
          <label className="text-sm font-bold text-zinc-600 dark:text-zinc-400 mb-3 block">
            Whiteboard Style
          </label>
          <div className="flex gap-2 sm:gap-3">
            {(['clean', 'sketchy'] as const).map((style) => (
              <button
                key={style}
                onClick={() => updatePreferences({ whiteboardStyle: style })}
                className={`flex-1 p-3 rounded-xl border text-sm font-bold transition-all active:scale-95 ${
                  preferences.whiteboardStyle === style
                    ? 'border-indigo-500 text-indigo-600 bg-indigo-50 dark:bg-indigo-950'
                    : 'border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:border-zinc-300 dark:hover:border-zinc-700'
                }`}
              >
                {style.charAt(0).toUpperCase() + style.slice(1)}
              </button>
            ))}
          </div>
          <p className="text-xs text-zinc-500 mt-2">
            Sketchy mode adds hand-drawn style to whiteboards
          </p>
        </section>

        {/* Toggle Settings */}
        <section className="space-y-4">
          {/* Line Numbers */}
          <label className="flex items-center justify-between p-3 sm:p-0 bg-zinc-50 dark:bg-zinc-900 sm:bg-transparent rounded-xl sm:rounded-none">
            <div className="flex-1 min-w-0 pr-4">
              <span className="text-sm font-bold text-zinc-600 dark:text-zinc-400 block">
                Show Line Numbers
              </span>
              <p className="text-xs text-zinc-500">Display line numbers in code blocks</p>
            </div>
            <button
              onClick={() => updatePreferences({ showLineNumbers: !preferences.showLineNumbers })}
              className={`w-12 h-7 sm:w-12 sm:h-6 rounded-full transition-colors shrink-0 ${
                preferences.showLineNumbers ? 'bg-indigo-500' : 'bg-zinc-300 dark:bg-zinc-700'
              }`}
            >
              <div
                className={`w-5 h-5 rounded-full bg-white shadow transform transition-transform ${
                  preferences.showLineNumbers ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </label>

          {/* Auto Expand Code */}
          <label className="flex items-center justify-between p-3 sm:p-0 bg-zinc-50 dark:bg-zinc-900 sm:bg-transparent rounded-xl sm:rounded-none">
            <div className="flex-1 min-w-0 pr-4">
              <span className="text-sm font-bold text-zinc-600 dark:text-zinc-400 block">
                Auto-Expand Code Embeds
              </span>
              <p className="text-xs text-zinc-500">Automatically expand long code blocks</p>
            </div>
            <button
              onClick={() => updatePreferences({ autoExpandCodeEmbeds: !preferences.autoExpandCodeEmbeds })}
              className={`w-12 h-7 sm:w-12 sm:h-6 rounded-full transition-colors shrink-0 ${
                preferences.autoExpandCodeEmbeds ? 'bg-indigo-500' : 'bg-zinc-300 dark:bg-zinc-700'
              }`}
            >
              <div
                className={`w-5 h-5 rounded-full bg-white shadow transform transition-transform ${
                  preferences.autoExpandCodeEmbeds ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </label>
        </section>

        {/* Diff View */}
        <section>
          <label className="text-sm font-bold text-zinc-600 dark:text-zinc-400 mb-3 block">
            Default Diff View
          </label>
          <div className="flex gap-2 sm:gap-3">
            {(['side-by-side', 'inline'] as const).map((view) => (
              <button
                key={view}
                onClick={() => updatePreferences({ defaultDiffView: view })}
                className={`flex-1 p-3 rounded-xl border text-sm font-bold transition-all active:scale-95 ${
                  preferences.defaultDiffView === view
                    ? 'border-indigo-500 text-indigo-600 bg-indigo-50 dark:bg-indigo-950'
                    : 'border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:border-zinc-300 dark:hover:border-zinc-700'
                }`}
              >
                {view === 'side-by-side' ? 'Side by Side' : 'Inline'}
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
