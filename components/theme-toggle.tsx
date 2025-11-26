'use client'

import { useTheme } from 'next-themes'
import { useSyncExternalStore } from 'react'
import { Moon, Sun } from 'lucide-react'

// Simple hydration-safe hook - subscribes to a "store" that always says true on client
function useIsMounted() {
  return useSyncExternalStore(
    () => () => {}, // subscribe - no-op since value never changes
    () => true,     // getSnapshot - true on client
    () => false     // getServerSnapshot - false during SSR
  )
}

export function ThemeToggle() {
  const { setTheme, resolvedTheme } = useTheme()
  const mounted = useIsMounted()

  if (!mounted) {
    return (
      <button
        className="relative h-9 w-16 rounded-full bg-muted p-1 transition-colors"
        aria-label="Toggle theme"
      >
        <span className="absolute left-1 top-1 h-7 w-7 rounded-full bg-background shadow-md" />
      </button>
    )
  }

  const isDark = resolvedTheme === 'dark'

  return (
    <button
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className="relative h-9 w-16 rounded-full bg-muted p-1 transition-all duration-300 hover:bg-muted/80"
      aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
    >
      {/* Track icons */}
      <span className="absolute inset-0 flex items-center justify-between px-2">
        <Sun className="h-4 w-4 text-amber-500" />
        <Moon className="h-4 w-4 text-indigo-400" />
      </span>
      
      {/* Sliding thumb */}
      <span
        className={`relative z-10 flex h-7 w-7 items-center justify-center rounded-full bg-background shadow-md transition-transform duration-300 ${
          isDark ? 'translate-x-7' : 'translate-x-0'
        }`}
      >
        {isDark ? (
          <Moon className="h-4 w-4 text-indigo-500" />
        ) : (
          <Sun className="h-4 w-4 text-amber-500" />
        )}
      </span>
    </button>
  )
}
