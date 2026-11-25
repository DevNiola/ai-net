/**
 * AgentFilterPanel
 *
 * A collapsible sidebar filter panel that lives alongside the AgentFilterBar.
 * Filter state is owned by the URL (via useAgentFilters), so panel selections
 * are shareable and survive page refreshes.
 *
 * Controls:
 *  - Capability multi-select checkboxes
 *  - Reputation range dual-handle slider (0–5, step 0.1)
 *  - Price range dual-handle slider (0–100 XLM, step 1)
 *  - "Only available agents" toggle
 *  - Clear All Filters button
 *
 * All controls are native form elements, so they are keyboard accessible by
 * default: checkboxes toggle via Space, sliders adjust via arrow keys, and
 * buttons activate via Enter/Space.
 */

import { useCallback, useMemo } from 'react'
import { SlidersHorizontal, ChevronDown, X } from 'lucide-react'

import { useAgentFilters } from '../../hooks/useAgentFilters'
import styles from './AgentFilterPanel.module.css'

// Base capability set — matches the AgentPreference union in types/api.ts.
// Props-supplied capabilities (from live registry data) are merged on top.
const BASE_CAPABILITIES = ['research', 'risk', 'coding', 'design', 'report'] as const

const REP_MIN = 0
const REP_MAX = 5
const REP_STEP = 0.1

const PRICE_MIN = 0
const PRICE_MAX = 100
const PRICE_STEP = 1

export interface AgentFilterPanelProps {
  isOpen: boolean
  onToggle: () => void
  /** Capability options discovered from the live registry dataset. */
  capabilities: string[]
}

export function AgentFilterPanel({ isOpen, onToggle, capabilities }: AgentFilterPanelProps) {
  const {
    capabilities: selected,
    repRange,
    priceRange,
    onlyAvailable,
    setCapabilities,
    setRepRange,
    setPriceRange,
    setOnlyAvailable,
    clearAll,
    activeFilterCount,
  } = useAgentFilters()

  // Union of base capabilities and those discovered from the registry.
  const capabilityOptions = useMemo(() => {
    const set = new Set<string>([...BASE_CAPABILITIES, ...capabilities])
    return Array.from(set).sort()
  }, [capabilities])

  const toggleCapability = useCallback(
    (cap: string) => {
      setCapabilities(
        selected.includes(cap) ? selected.filter((c) => c !== cap) : [...selected, cap]
      )
    },
    [selected, setCapabilities]
  )

  // ── Dual-handle range handlers (clamp so min ≤ max) ──────────────────────

  const handleRepMin = useCallback(
    (value: number) => {
      setRepRange([Math.min(value, repRange[1]), repRange[1]])
    },
    [repRange, setRepRange]
  )

  const handleRepMax = useCallback(
    (value: number) => {
      setRepRange([repRange[0], Math.max(value, repRange[0])])
    },
    [repRange, setRepRange]
  )

  const handlePriceMin = useCallback(
    (value: number) => {
      setPriceRange([Math.min(value, priceRange[1]), priceRange[1]])
    },
    [priceRange, setPriceRange]
  )

  const handlePriceMax = useCallback(
    (value: number) => {
      setPriceRange([priceRange[0], Math.max(value, priceRange[0])])
    },
    [priceRange, setPriceRange]
  )

  return (
    <aside className={styles.panel} data-testid="agent-filter-panel" aria-label="Agent filters">
      <button
        type="button"
        className={styles.toggle}
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls="agent-filter-panel-body"
      >
        <SlidersHorizontal size={14} aria-hidden="true" />
        <span>
          {activeFilterCount > 0 ? `Filters (${activeFilterCount})` : 'Filters'}
        </span>
        {activeFilterCount > 0 && (
          <span className={styles.badge} aria-hidden="true">
            {activeFilterCount}
          </span>
        )}
        <ChevronDown
          size={14}
          aria-hidden="true"
          style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
        />
      </button>

      {isOpen && (
        <div className={styles.panelBody} id="agent-filter-panel-body">
          {/* ── Capabilities ─────────────────────────────────────────────── */}
          <div>
            <span className={styles.sectionLabel}>Capabilities</span>
            <div className={styles.checkList} role="group" aria-label="Filter by capability">
              {capabilityOptions.map((cap) => (
                <label key={cap} className={styles.checkItem}>
                  <input
                    type="checkbox"
                    checked={selected.includes(cap)}
                    onChange={() => toggleCapability(cap)}
                  />
                  {cap}
                </label>
              ))}
            </div>
          </div>

          {/* ── Reputation range ────────────────────────────────────────── */}
          <div>
            <span className={styles.sectionLabel}>Reputation</span>
            <div className={styles.rangeRow}>
              <input
                type="range"
                min={REP_MIN}
                max={REP_MAX}
                step={REP_STEP}
                value={repRange[0]}
                aria-label="Minimum reputation"
                onChange={(e) => handleRepMin(Number(e.target.value))}
              />
              <span className={styles.rangeValue}>{repRange[0].toFixed(1)}</span>
            </div>
            <div className={styles.rangeRow}>
              <input
                type="range"
                min={REP_MIN}
                max={REP_MAX}
                step={REP_STEP}
                value={repRange[1]}
                aria-label="Maximum reputation"
                onChange={(e) => handleRepMax(Number(e.target.value))}
              />
            </div>
          </div>

          {/* ── Price range ─────────────────────────────────────────────── */}
          <div>
            <span className={styles.sectionLabel}>Price (XLM)</span>
            <div className={styles.rangeRow}>
              <input
                type="range"
                min={PRICE_MIN}
                max={PRICE_MAX}
                step={PRICE_STEP}
                value={priceRange[0]}
                aria-label="Minimum price"
                onChange={(e) => handlePriceMin(Number(e.target.value))}
              />
              <span className={styles.rangeValue}>{priceRange[0]} – {priceRange[1]}</span>
            </div>
            <div className={styles.rangeRow}>
              <input
                type="range"
                min={PRICE_MIN}
                max={PRICE_MAX}
                step={PRICE_STEP}
                value={priceRange[1]}
                aria-label="Maximum price"
                onChange={(e) => handlePriceMax(Number(e.target.value))}
              />
            </div>
          </div>

          {/* ── Availability ────────────────────────────────────────────── */}
          <label className={styles.availabilityRow}>
            <input
              type="checkbox"
              checked={onlyAvailable}
              onChange={(e) => setOnlyAvailable(e.target.checked)}
            />
            Only available agents
          </label>

          {/* ── Clear all ───────────────────────────────────────────────── */}
          <button type="button" className={styles.clearBtn} onClick={clearAll}>
            <X size={12} aria-hidden="true" style={{ verticalAlign: 'middle', marginRight: 4 }} />
            Clear All Filters
          </button>
        </div>
      )}
    </aside>
  )
}
