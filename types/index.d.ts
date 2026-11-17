/** One rate-limit window as the engine reports it (five_hour, seven_day, ...). */
export type BudgetLimit = { kind: string; percentUsed: number; resetsAt?: string }

/** The last reading of the limits. */
export type BudgetSnapshot = {
  limits: BudgetLimit[]
  /** When it was read, epoch ms. */
  at: number
  /** true when read in this session; false when restored from the store. */
  isLive: boolean
  /** true while `/budget simulate` stands in for the real reading. */
  isSimulated?: boolean
}

/** The pace levels that have a color of the user's choice. */
export type BudgetColorLevel = 'ok' | 'over1' | 'over2' | 'over3' | 'over4' | 'cap'

/** One `#rrggbb` color per pace level. */
export type BudgetColors = Record<BudgetColorLevel, string>

/** A color range: from `from`% of usage up to the next range's start. */
export type BudgetRange = { from: number; color: string }

/** How the signal is colored: by pace against the budget, or by usage ranges. */
export type BudgetColorMode = 'pace' | 'ranges'

/** Settings the user changes with /budget or the panel. */
export type BudgetSettings = {
  /** How the signal is colored. */
  mode: BudgetColorMode
  /** Colors by pace level (mode `pace`). */
  colors: BudgetColors
  /** Colors by usage range (mode `ranges`), sorted by `from`, the first from 0. */
  ranges: BudgetRange[]
  /** Weekly cap in % (default 90). */
  cap: number
  /** Points above the budget that count as "far ahead" (default 15). */
  alertDelta: number
  /** The 5h | 1w badge in the session title (the title bar). */
  title: boolean
  /** The colored strip drawn as the window backdrop (desktop/mobile). */
  theme: boolean
  /** The bar above the prompt. */
  band: boolean
  /** The status line entry. */
  status: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'usage-pacer': {
      snap: Shaped<BudgetSnapshot | null>
      settings: Shaped<BudgetSettings>
      now: number
    }
  }
}
