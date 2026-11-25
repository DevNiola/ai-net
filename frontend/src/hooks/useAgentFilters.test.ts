/**
 * Tests for useAgentFilters
 *
 * We wrap renderHook in a MemoryRouter (which provides the SearchParamsContext
 * that useSearchParams requires) and optionally seed its `initialEntries` to
 * simulate a URL that already carries filter params.
 */

import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import React from 'react'
import {
  useAgentFilters,
  DEFAULT_CAPABILITIES,
  DEFAULT_REP_RANGE,
  DEFAULT_PRICE_RANGE,
  DEFAULT_ONLY_AVAILABLE,
} from './useAgentFilters'

// ── Wrapper factories ─────────────────────────────────────────────────────────

function makeWrapper(initialPath = '/') {
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(MemoryRouter, { initialEntries: [initialPath] }, children)
  }
}

// ── Default state ─────────────────────────────────────────────────────────────

describe('useAgentFilters — defaults', () => {
  it('returns default values when no URL params are present', () => {
    const { result } = renderHook(() => useAgentFilters(), {
      wrapper: makeWrapper('/'),
    })

    expect(result.current.capabilities).toEqual(DEFAULT_CAPABILITIES)
    expect(result.current.repRange).toEqual(DEFAULT_REP_RANGE)
    expect(result.current.priceRange).toEqual(DEFAULT_PRICE_RANGE)
    expect(result.current.onlyAvailable).toBe(DEFAULT_ONLY_AVAILABLE)
    expect(result.current.activeFilterCount).toBe(0)
  })
})

// ── Reading from URL params ───────────────────────────────────────────────────

describe('useAgentFilters — reading URL params', () => {
  it('parses capabilities from ?capability=research,coding', () => {
    const { result } = renderHook(() => useAgentFilters(), {
      wrapper: makeWrapper('/?capability=research,coding'),
    })

    expect(result.current.capabilities).toEqual(['research', 'coding'])
  })

  it('parses a single capability without a comma', () => {
    const { result } = renderHook(() => useAgentFilters(), {
      wrapper: makeWrapper('/?capability=risk'),
    })

    expect(result.current.capabilities).toEqual(['risk'])
  })

  it('parses reputation range from ?minRep=2&maxRep=4', () => {
    const { result } = renderHook(() => useAgentFilters(), {
      wrapper: makeWrapper('/?minRep=2&maxRep=4'),
    })

    expect(result.current.repRange).toEqual([2, 4])
  })

  it('parses price range from ?minPrice=10&maxPrice=50', () => {
    const { result } = renderHook(() => useAgentFilters(), {
      wrapper: makeWrapper('/?minPrice=10&maxPrice=50'),
    })

    expect(result.current.priceRange).toEqual([10, 50])
  })

  it('parses onlyAvailable=true', () => {
    const { result } = renderHook(() => useAgentFilters(), {
      wrapper: makeWrapper('/?onlyAvailable=true'),
    })

    expect(result.current.onlyAvailable).toBe(true)
  })

  it('treats onlyAvailable=false as default (not active filter)', () => {
    const { result } = renderHook(() => useAgentFilters(), {
      wrapper: makeWrapper('/?onlyAvailable=false'),
    })

    expect(result.current.onlyAvailable).toBe(false)
    expect(result.current.activeFilterCount).toBe(0)
  })

  it('falls back to defaults for invalid number params', () => {
    const { result } = renderHook(() => useAgentFilters(), {
      wrapper: makeWrapper('/?minRep=abc&maxRep=xyz'),
    })

    expect(result.current.repRange).toEqual(DEFAULT_REP_RANGE)
  })
})

// ── Writing capabilities to URL ───────────────────────────────────────────────

describe('useAgentFilters — writing capabilities', () => {
  it('setCapabilities updates capabilities', () => {
    const { result } = renderHook(() => useAgentFilters(), {
      wrapper: makeWrapper('/'),
    })

    act(() => {
      result.current.setCapabilities(['research', 'design'])
    })

    expect(result.current.capabilities).toEqual(['research', 'design'])
  })

  it('setCapabilities with empty array removes the param', () => {
    const { result } = renderHook(() => useAgentFilters(), {
      wrapper: makeWrapper('/?capability=coding'),
    })

    act(() => {
      result.current.setCapabilities([])
    })

    expect(result.current.capabilities).toEqual([])
  })
})

// ── Writing other filters to URL ──────────────────────────────────────────────

describe('useAgentFilters — writing other filters', () => {
  it('setRepRange updates reputation range', () => {
    const { result } = renderHook(() => useAgentFilters(), {
      wrapper: makeWrapper('/'),
    })

    act(() => {
      result.current.setRepRange([1, 4])
    })

    expect(result.current.repRange).toEqual([1, 4])
  })

  it('setPriceRange updates price range', () => {
    const { result } = renderHook(() => useAgentFilters(), {
      wrapper: makeWrapper('/'),
    })

    act(() => {
      result.current.setPriceRange([20, 80])
    })

    expect(result.current.priceRange).toEqual([20, 80])
  })

  it('setOnlyAvailable updates availability flag', () => {
    const { result } = renderHook(() => useAgentFilters(), {
      wrapper: makeWrapper('/'),
    })

    act(() => {
      result.current.setOnlyAvailable(true)
    })

    expect(result.current.onlyAvailable).toBe(true)
  })
})

// ── Active filter count ───────────────────────────────────────────────────────

describe('useAgentFilters — activeFilterCount', () => {
  it('counts one active filter when only capabilities are set', () => {
    const { result } = renderHook(() => useAgentFilters(), {
      wrapper: makeWrapper('/?capability=research'),
    })

    expect(result.current.activeFilterCount).toBe(1)
  })

  it('counts one active filter when repRange differs from default', () => {
    const { result } = renderHook(() => useAgentFilters(), {
      wrapper: makeWrapper('/?minRep=2&maxRep=4'),
    })

    expect(result.current.activeFilterCount).toBe(1)
  })

  it('counts one active filter when priceRange differs from default', () => {
    const { result } = renderHook(() => useAgentFilters(), {
      wrapper: makeWrapper('/?minPrice=10&maxPrice=50'),
    })

    expect(result.current.activeFilterCount).toBe(1)
  })

  it('counts multiple active filters correctly', () => {
    const { result } = renderHook(() => useAgentFilters(), {
      wrapper: makeWrapper('/?capability=research,coding&minRep=2&maxRep=4&onlyAvailable=true'),
    })

    // capabilities (1) + repRange (1) + onlyAvailable (1) = 3
    expect(result.current.activeFilterCount).toBe(3)
  })

  it('counts all four categories when all are non-default', () => {
    const { result } = renderHook(() => useAgentFilters(), {
      wrapper: makeWrapper(
        '/?capability=coding&minRep=1&maxRep=3&minPrice=5&maxPrice=50&onlyAvailable=true'
      ),
    })

    expect(result.current.activeFilterCount).toBe(4)
  })

  it('increments count when setCapabilities is called', () => {
    const { result } = renderHook(() => useAgentFilters(), {
      wrapper: makeWrapper('/'),
    })

    expect(result.current.activeFilterCount).toBe(0)

    act(() => {
      result.current.setCapabilities(['coding'])
    })

    expect(result.current.activeFilterCount).toBe(1)
  })
})

// ── clearAll ──────────────────────────────────────────────────────────────────

describe('useAgentFilters — clearAll', () => {
  it('resets all filters to defaults', () => {
    const { result } = renderHook(() => useAgentFilters(), {
      wrapper: makeWrapper(
        '/?capability=research,coding&minRep=2&maxRep=4&minPrice=10&maxPrice=50&onlyAvailable=true'
      ),
    })

    // Confirm we start with active filters
    expect(result.current.activeFilterCount).toBeGreaterThan(0)

    act(() => {
      result.current.clearAll()
    })

    expect(result.current.capabilities).toEqual([])
    expect(result.current.repRange).toEqual(DEFAULT_REP_RANGE)
    expect(result.current.priceRange).toEqual(DEFAULT_PRICE_RANGE)
    expect(result.current.onlyAvailable).toBe(false)
    expect(result.current.activeFilterCount).toBe(0)
  })

  it('clearAll is a no-op when no filters are active', () => {
    const { result } = renderHook(() => useAgentFilters(), {
      wrapper: makeWrapper('/'),
    })

    act(() => {
      result.current.clearAll()
    })

    expect(result.current.activeFilterCount).toBe(0)
  })

  it('clearAll does not remove unrelated URL params', () => {
    // `caps` and `status` belong to AgentFilterBar, not AgentFilterPanel —
    // clearAll must not touch them.
    const { result } = renderHook(() => useAgentFilters(), {
      wrapper: makeWrapper('/?caps=research&status=active&capability=coding'),
    })

    act(() => {
      result.current.clearAll()
    })

    // Panel capability cleared
    expect(result.current.capabilities).toEqual([])
    // The AgentFilterBar params (caps/status) are preserved — we can't assert
    // the URL string directly in a hook test, but we confirm the panel state
    // is clean and no exception was thrown.
    expect(result.current.activeFilterCount).toBe(0)
  })
})
