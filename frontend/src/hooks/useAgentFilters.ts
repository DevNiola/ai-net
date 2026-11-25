/**
 * useAgentFilters
 *
 * Manages the AgentFilterPanel's filter state via URL query parameters so that
 * filter selections are shareable, bookmarkable, and survive a page refresh.
 *
 * URL shape:
 *   ?capability=research,coding&minRep=3&maxRep=5&minPrice=0&maxPrice=100&onlyAvailable=true
 *
 * Writes back with `replace: true` so individual slider/checkbox tweaks don't
 * pollute the browser history stack.
 */

import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

// ── Default filter values ─────────────────────────────────────────────────────

export const DEFAULT_CAPABILITIES: string[] = []
export const DEFAULT_REP_RANGE: [number, number] = [0, 5]
export const DEFAULT_PRICE_RANGE: [number, number] = [0, 100]
export const DEFAULT_ONLY_AVAILABLE = false

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AgentFilterState {
  capabilities: string[]
  repRange: [number, number]
  priceRange: [number, number]
  onlyAvailable: boolean
}

export interface UseAgentFiltersReturn extends AgentFilterState {
  setCapabilities: (capabilities: string[]) => void
  setRepRange: (range: [number, number]) => void
  setPriceRange: (range: [number, number]) => void
  setOnlyAvailable: (value: boolean) => void
  clearAll: () => void
  /** Number of non-default active filters; used for the badge. */
  activeFilterCount: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseCSV(value: string | null): string[] {
  if (!value) return []
  return value.split(',').map((s) => s.trim()).filter(Boolean)
}

function parseNumber(value: string | null, fallback: number): number {
  if (value === null) return fallback
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Reads panel filter state from URL params and provides typed setters that
 * write back to the URL with `replace: true`.
 *
 * These params are intentionally kept separate from the AgentFilterBar params
 * (`caps`, `pmin`, `pmax`, `status`, `sort`, `dir`) so both filter surfaces can
 * coexist in the same URL without collision.
 */
export function useAgentFilters(): UseAgentFiltersReturn {
  const [searchParams, setSearchParams] = useSearchParams()

  // ── Read from URL ─────────────────────────────────────────────────────────

  const capabilities = useMemo(
    () => parseCSV(searchParams.get('capability')),
    [searchParams]
  )

  const repRange = useMemo<[number, number]>(
    () => [
      parseNumber(searchParams.get('minRep'), DEFAULT_REP_RANGE[0]),
      parseNumber(searchParams.get('maxRep'), DEFAULT_REP_RANGE[1]),
    ],
    [searchParams]
  )

  const priceRange = useMemo<[number, number]>(
    () => [
      parseNumber(searchParams.get('minPrice'), DEFAULT_PRICE_RANGE[0]),
      parseNumber(searchParams.get('maxPrice'), DEFAULT_PRICE_RANGE[1]),
    ],
    [searchParams]
  )

  const onlyAvailable = useMemo(
    () => searchParams.get('onlyAvailable') === 'true',
    [searchParams]
  )

  // ── Active filter count ───────────────────────────────────────────────────

  const activeFilterCount = useMemo(() => {
    let count = 0
    if (capabilities.length > 0) count++
    if (repRange[0] !== DEFAULT_REP_RANGE[0] || repRange[1] !== DEFAULT_REP_RANGE[1]) count++
    if (priceRange[0] !== DEFAULT_PRICE_RANGE[0] || priceRange[1] !== DEFAULT_PRICE_RANGE[1]) count++
    if (onlyAvailable !== DEFAULT_ONLY_AVAILABLE) count++
    return count
  }, [capabilities, repRange, priceRange, onlyAvailable])

  // ── Write helpers ─────────────────────────────────────────────────────────

  /**
   * Merge new panel params into the existing URLSearchParams without
   * touching the AgentFilterBar params (caps, pmin, pmax, status, sort, dir).
   */
  const patch = useCallback(
    (updates: Record<string, string | null>) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [key, value] of Object.entries(updates)) {
            if (value === null) {
              next.delete(key)
            } else {
              next.set(key, value)
            }
          }
          return next
        },
        { replace: true }
      )
    },
    [setSearchParams]
  )

  const setCapabilities = useCallback(
    (caps: string[]) => {
      patch({ capability: caps.length > 0 ? caps.join(',') : null })
    },
    [patch]
  )

  const setRepRange = useCallback(
    ([min, max]: [number, number]) => {
      const isDefault = min === DEFAULT_REP_RANGE[0] && max === DEFAULT_REP_RANGE[1]
      patch({
        minRep: isDefault ? null : String(min),
        maxRep: isDefault ? null : String(max),
      })
    },
    [patch]
  )

  const setPriceRange = useCallback(
    ([min, max]: [number, number]) => {
      const isDefault = min === DEFAULT_PRICE_RANGE[0] && max === DEFAULT_PRICE_RANGE[1]
      patch({
        minPrice: isDefault ? null : String(min),
        maxPrice: isDefault ? null : String(max),
      })
    },
    [patch]
  )

  const setOnlyAvailable = useCallback(
    (value: boolean) => {
      patch({ onlyAvailable: value ? 'true' : null })
    },
    [patch]
  )

  const clearAll = useCallback(() => {
    patch({
      capability: null,
      minRep: null,
      maxRep: null,
      minPrice: null,
      maxPrice: null,
      onlyAvailable: null,
    })
  }, [patch])

  return {
    capabilities,
    repRange,
    priceRange,
    onlyAvailable,
    setCapabilities,
    setRepRange,
    setPriceRange,
    setOnlyAvailable,
    clearAll,
    activeFilterCount,
  }
}
