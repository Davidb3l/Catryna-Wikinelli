export interface UserPreferences {
  theme: 'light' | 'dark' | 'system'
  whiteboardStyle: 'clean' | 'sketchy'
  fontSize: number
  showLineNumbers: boolean
  autoExpandCodeEmbeds: boolean
  defaultDiffView: 'side-by-side' | 'inline'
}

const STORAGE_KEY = 'catryna-user-preferences'

const defaultPreferences: UserPreferences = {
  theme: 'system',
  whiteboardStyle: 'clean',
  fontSize: 14,
  showLineNumbers: true,
  autoExpandCodeEmbeds: false,
  defaultDiffView: 'side-by-side',
}

export function getPreferences(): UserPreferences {
  if (typeof window === 'undefined') return defaultPreferences

  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      return { ...defaultPreferences, ...JSON.parse(stored) }
    }
  } catch (error) {
    console.error('Failed to load preferences:', error)
  }

  return defaultPreferences
}

export function savePreferences(prefs: Partial<UserPreferences>): UserPreferences {
  const current = getPreferences()
  const updated = { ...current, ...prefs }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
  } catch (error) {
    console.error('Failed to save preferences:', error)
  }

  return updated
}

export function applyTheme(theme: UserPreferences['theme']) {
  const root = document.documentElement

  if (theme === 'dark') {
    root.classList.add('dark')
  } else if (theme === 'light') {
    root.classList.remove('dark')
  } else {
    // System preference
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    if (prefersDark) {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
  }
}

// React hook for preferences
import { useState, useEffect, useCallback } from 'react'

export function usePreferences() {
  const [preferences, setPreferences] = useState<UserPreferences>(getPreferences)

  useEffect(() => {
    applyTheme(preferences.theme)
  }, [preferences.theme])

  const updatePreferences = useCallback((updates: Partial<UserPreferences>) => {
    const updated = savePreferences(updates)
    setPreferences(updated)
  }, [])

  return { preferences, updatePreferences }
}
