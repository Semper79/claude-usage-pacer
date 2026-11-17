// Pure budget logic: no calls on `$`, so it tests on its own.

import type {
  BudgetColorLevel,
  BudgetColorMode,
  BudgetColors,
  BudgetLimit,
  BudgetRange,
  BudgetSettings,
  BudgetSnapshot,
} from '../types'

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000
export const FIVE_HOURS_MS = 5 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const MAX_RANGES = 8

export const COLOR_LEVELS: readonly BudgetColorLevel[] = ['ok', 'over1', 'over2', 'over3', 'over4', 'cap']

export const DEFAULT_COLORS: BudgetColors = {
  ok: '#3f9a52',
  over1: '#c9a800',
  over2: '#d99100',
  over3: '#e07000',
  over4: '#e05200',
  cap: '#d32f2f',
}

export const DEFAULT_RANGES: readonly BudgetRange[] = [
  { from: 0, color: '#3f9a52' },
  { from: 50, color: '#c9a800' },
  { from: 70, color: '#e07000' },
  { from: 85, color: '#d32f2f' },
]

export const DEFAULT_SETTINGS: BudgetSettings = {
  mode: 'pace',
  colors: DEFAULT_COLORS,
  ranges: [...DEFAULT_RANGES],
  cap: 90,
  alertDelta: 15,
  title: true,
  theme: false,
  band: true,
  status: true,
}

/** Where the signal can show: settings key, command word, label. */
export const POSITIONS = [
  { key: 'title', word: 'title', label: 'Title bar' },
  { key: 'theme', word: 'strip', label: 'Strip below the title' },
  { key: 'band', word: 'promptbar', label: 'Bar above the prompt' },
  { key: 'status', word: 'statusline', label: 'Status line' },
] as const

export type PositionKey = (typeof POSITIONS)[number]['key']

/** The words accepted for each position in `/budget <position> on|off`. */
export const POSITION_WORDS: Record<string, PositionKey> = {
  title: 'title',
  strip: 'theme',
  backdrop: 'theme',
  promptbar: 'band',
  bar: 'band',
  statusline: 'status',
  status: 'status',
}

export function positionsReport(settings: BudgetSettings): string {
  return [
    'Where the 5h | 1w signal shows:',
    ...POSITIONS.map(p => `  ${p.label} [${p.word}]: ${settings[p.key] ? 'on' : 'off'}`),
    '',
    'Change with: /budget <title|strip|promptbar|statusline> on|off',
  ].join('\n')
}

/** Ready-made colors, for the panel and for color names in commands. */
export const PRESETS: readonly { name: string; label: string; hex: string }[] = [
  { name: 'green', label: 'Green', hex: '#3f9a52' },
  { name: 'light-green', label: 'Light green', hex: '#6fbf73' },
  { name: 'teal', label: 'Teal', hex: '#1f9e8f' },
  { name: 'sky', label: 'Sky blue', hex: '#3a9ad9' },
  { name: 'blue', label: 'Blue', hex: '#2f6bb0' },
  { name: 'purple', label: 'Purple', hex: '#7a4fa0' },
  { name: 'pink', label: 'Pink', hex: '#d0458a' },
  { name: 'yellow', label: 'Yellow', hex: '#c9a800' },
  { name: 'amber', label: 'Amber', hex: '#d99100' },
  { name: 'orange', label: 'Orange', hex: '#e07000' },
  { name: 'dark-orange', label: 'Dark orange', hex: '#e05200' },
  { name: 'red', label: 'Red', hex: '#d32f2f' },
  { name: 'dark-red', label: 'Dark red', hex: '#9a1b1b' },
  { name: 'gray', label: 'Gray', hex: '#8a8a8a' },
]

/** Level names as typed in `/budget color <level> <color>`. */
export const LEVEL_ALIASES: Record<string, BudgetColorLevel> = {
  ok: 'ok',
  onpace: 'ok',
  under: 'ok',
  over1: 'over1',
  over2: 'over2',
  over3: 'over3',
  over4: 'over4',
  cap: 'cap',
}

/** Level names in the panel. */
export const LEVEL_NAME: Record<BudgetColorLevel, string> = {
  ok: 'On pace',
  over1: 'Slightly ahead',
  over2: 'Ahead',
  over3: 'Well ahead',
  over4: 'Far ahead',
  cap: 'At cap',
}

const HEX = /^#[0-9a-f]{6}$/

/** `#rgb`, `#rrggbb` or a PRESETS name, as lowercase `#rrggbb`; else undefined. */
export function parseColor(raw: string | undefined): string | undefined {
  if (raw === undefined) {
    return undefined
  }
  const w = raw.trim().toLowerCase()
  const preset = PRESETS.find(p => p.name === w || p.label.toLowerCase() === w)

  if (preset !== undefined) {
    return preset.hex
  }
  const short = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(w)

  if (short !== null) {
    return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`
  }
  const long = w.startsWith('#') ? w : `#${w}`

  return HEX.test(long) ? long : undefined
}

export function colorName(hex: string): string {
  return PRESETS.find(p => p.hex === hex)?.label ?? `custom ${hex}`
}

/**
 * Pace level:
 * - `nodata`: the window is missing (or already reset);
 * - `ok`: at or under the linear budget;
 * - `over1`..`over4`: ahead of pace, more and more (over4 = "far ahead");
 * - `cap`: at the cap or past it.
 */
export type Level = 'nodata' | BudgetColorLevel

export type Window = {
  used: number
  resetsAt?: number
}

/** A window's pace: where you should be now and how far off you are. */
export type Pace = {
  level: Level
  window?: Window
  /** Expected usage now (points %), when the reset time is known. */
  budget?: number
  /** Distance from the budget in points (positive = ahead of pace). */
  delta?: number
  /** Elapsed share of the window, 0..1. */
  elapsed?: number
  /** Milliseconds to the reset. */
  msToReset?: number
}

export type Status = {
  /** The week's level: drives the alerts. */
  level: Level
  week?: Window
  fiveHour?: Window
  budget?: number
  delta?: number
  elapsed?: number
  msToReset?: number
  /** The 5-hour window, with the same linear pace toward the same cap. */
  five: Pace
  fiveHourMsToReset?: number
  cap: number
  alertDelta: number
  /** The reading comes from an earlier session (no reply yet in this one). */
  isStale: boolean
  /** The reading is a `/budget simulate` one. */
  isSimulated: boolean
  /** When the reading was taken. */
  readAt?: number
}

function clampPercent(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : undefined
}

/** Ranges sorted by start, one per start, the first from 0, at most MAX_RANGES. */
export function cleanRanges(raw: unknown): BudgetRange[] {
  if (!Array.isArray(raw)) {
    return [...DEFAULT_RANGES]
  }
  const byStart = new Map<number, string>()

  for (const r of raw as unknown[]) {
    const one = (typeof r === 'object' && r !== null ? r : {}) as Partial<BudgetRange>
    const from = clampPercent(one.from)
    const color = typeof one.color === 'string' ? parseColor(one.color) : undefined

    if (from !== undefined && color !== undefined) {
      byStart.set(from, color)
    }
  }
  const ranges = [...byStart.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(0, MAX_RANGES)
    .map(([from, color]) => ({ from, color }))
  const first = ranges[0]

  if (first === undefined) {
    return [...DEFAULT_RANGES]
  }
  first.from = 0

  return ranges
}

export function clampSettings(raw: unknown): BudgetSettings {
  const s = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<BudgetSettings>
  const num = (v: unknown, lo: number, hi: number, d: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)
  const given = (typeof s.colors === 'object' && s.colors !== null ? s.colors : {}) as Partial<BudgetColors>
  const colors = { ...DEFAULT_COLORS }

  for (const level of COLOR_LEVELS) {
    const c = typeof given[level] === 'string' ? parseColor(given[level]) : undefined

    if (c !== undefined) {
      colors[level] = c
    }
  }
  const mode: BudgetColorMode = s.mode === 'ranges' ? 'ranges' : 'pace'

  return {
    mode,
    colors,
    ranges: s.ranges === undefined ? [...DEFAULT_RANGES] : cleanRanges(s.ranges),
    cap: num(s.cap, 1, 100, DEFAULT_SETTINGS.cap),
    alertDelta: num(s.alertDelta, 1, 50, DEFAULT_SETTINGS.alertDelta),
    title: bool(s.title, DEFAULT_SETTINGS.title),
    theme: bool(s.theme, DEFAULT_SETTINGS.theme),
    band: bool(s.band, DEFAULT_SETTINGS.band),
    status: bool(s.status, DEFAULT_SETTINGS.status),
  }
}

/** Sets the range starting at `from` (adding it, or recoloring it). */
export function setRange(ranges: readonly BudgetRange[], from: number, color: string): BudgetRange[] {
  return cleanRanges([...ranges.filter(r => r.from !== from), { from, color }])
}

/** Removes the range starting at `from`; the first one (from 0) stays. */
export function removeRange(ranges: readonly BudgetRange[], from: number): BudgetRange[] {
  return from === 0 ? [...ranges] : cleanRanges(ranges.filter(r => r.from !== from))
}

/** Moves the range at `index` to start at `from`. */
export function moveRange(ranges: readonly BudgetRange[], index: number, from: number): BudgetRange[] {
  return cleanRanges(ranges.map((r, i) => (i === index ? { ...r, from } : r)).filter((r, i) => i === index || r.from !== from))
}

/** The color of the range that holds `used`. */
export function rangeColor(used: number, ranges: readonly BudgetRange[]): string {
  let color = ranges[0]?.color ?? DEFAULT_COLORS.ok

  for (const r of ranges) {
    if (used >= r.from) {
      color = r.color
    }
  }

  return color
}

export function rangesReport(settings: BudgetSettings): string {
  const { ranges } = settings

  return [
    `Color mode: ${settings.mode === 'ranges' ? 'ranges (by usage %)' : 'pace (against the linear budget)'}`,
    'Usage ranges:',
    ...ranges.map((r, i) => {
      const to = ranges[i + 1]?.from

      return `  ${r.from}%–${to === undefined ? '100%+' : `${to}%`}: ${r.color} (${colorName(r.color)})`
    }),
    '',
    'Change with: /budget range <from%> <#rrggbb or name>, /budget range remove <from%>,',
    '/budget ranges default, /budget mode ranges|pace',
  ].join('\n')
}

function parseTime(iso: string | undefined): number | undefined {
  if (iso === undefined || iso === '') {
    return undefined
  }
  const t = Date.parse(iso)

  return Number.isFinite(t) ? t : undefined
}

function windowOf(limits: readonly BudgetLimit[], kind: string, now: number): Window | undefined {
  const one = limits.find(l => l.kind === kind)

  if (one === undefined || typeof one.percentUsed !== 'number' || !Number.isFinite(one.percentUsed)) {
    return undefined
  }
  const resetsAt = parseTime(one.resetsAt)

  // The window already reset: the reading no longer holds.
  if (resetsAt !== undefined && resetsAt <= now) {
    return undefined
  }

  return { used: one.percentUsed, resetsAt }
}

/** A window of `lengthMs`'s linear pace toward the cap. */
export function paceOf(window: Window | undefined, lengthMs: number, now: number, cap: number, alertDelta: number): Pace {
  if (window === undefined) {
    return { level: 'nodata' }
  }
  const pace: Pace = { level: 'ok', window }

  if (window.resetsAt !== undefined) {
    const start = window.resetsAt - lengthMs
    const elapsed = Math.min(1, Math.max(0, (now - start) / lengthMs))
    pace.elapsed = elapsed
    pace.budget = elapsed * cap
    pace.delta = window.used - pace.budget
    pace.msToReset = window.resetsAt - now
  }

  if (window.used >= cap) {
    pace.level = 'cap'
  } else if (pace.delta !== undefined && pace.delta > 0) {
    // Without a reset time there is no pace: only the cap counts.
    const ratio = pace.delta / alertDelta
    pace.level = ratio >= 1 ? 'over4' : ratio >= 2 / 3 ? 'over3' : ratio >= 1 / 3 ? 'over2' : 'over1'
  }

  return pace
}

export function compute(snap: BudgetSnapshot | null, now: number, settings: BudgetSettings): Status {
  const { cap, alertDelta } = settings
  const base: Status = {
    level: 'nodata',
    five: { level: 'nodata' },
    cap,
    alertDelta,
    isStale: snap?.isLive !== true,
    isSimulated: snap?.isSimulated === true,
    readAt: snap?.at,
  }

  if (snap === null) {
    return base
  }
  const week = windowOf(snap.limits, 'seven_day', now)
  const fiveHour = windowOf(snap.limits, 'five_hour', now)
  const w = paceOf(week, WEEK_MS, now, cap, alertDelta)
  const five = paceOf(fiveHour, FIVE_HOURS_MS, now, cap, alertDelta)

  return {
    ...base,
    level: w.level,
    week,
    fiveHour,
    budget: w.budget,
    delta: w.delta,
    elapsed: w.elapsed,
    msToReset: w.msToReset,
    five,
    fiveHourMsToReset: five.msToReset,
  }
}

export const isVeryOver = (s: Status) => s.level === 'over4'

const NODATA_COLOR = '#8a8a8a'

/** A pace level's color, from the user's settings. */
export function colorOf(level: Level, settings: BudgetSettings): string {
  return level === 'nodata' ? NODATA_COLOR : settings.colors[level]
}

/** The color a window's section is drawn in: by range or by pace, per the mode. */
export function windowColor(used: number | undefined, level: Level, settings: BudgetSettings): string {
  if (used === undefined || level === 'nodata') {
    return NODATA_COLOR
  }

  return settings.mode === 'ranges' ? rangeColor(used, settings.ranges) : colorOf(level, settings)
}

export function pct(n: number | undefined): string {
  if (n === undefined) {
    return 'n/a'
  }

  return `${Math.round(n * 10) / 10}%`
}

export function signed(n: number | undefined): string {
  if (n === undefined) {
    return 'n/a'
  }
  const r = Math.round(n * 10) / 10

  return `${r > 0 ? '+' : ''}${r}`
}

/** "2d 5h", "5h 12m", "8m". */
export function duration(ms: number | undefined): string {
  if (ms === undefined || ms < 0) {
    return 'n/a'
  }
  const d = Math.floor(ms / DAY_MS)
  const h = Math.floor((ms % DAY_MS) / HOUR_MS)
  const m = Math.floor((ms % HOUR_MS) / 60000)

  if (d > 0) {
    return `${d}d ${h}h`
  }

  if (h > 0) {
    return `${h}h ${m}m`
  }

  return `${m}m`
}

/** Days to the reset with one decimal: "3.2". */
export function days(ms: number | undefined): string {
  if (ms === undefined || ms < 0) {
    return 'n/a'
  }

  return (Math.round((ms / DAY_MS) * 10) / 10).toFixed(1)
}

export const LEVEL_LABEL: Record<Level, string> = {
  nodata: 'no data',
  ok: 'on pace',
  over1: 'slightly ahead of pace',
  over2: 'ahead of pace',
  over3: 'well ahead of pace',
  over4: 'far ahead of pace',
  cap: 'cap reached',
}

/** The short pace words shown between the usage and the reset on each row of the bar. */
export const PACE_LABEL: Record<BudgetColorLevel, string> = {
  ok: 'on pace',
  over1: 'slightly over',
  over2: 'over pace',
  over3: 'well over',
  over4: 'far over',
  cap: 'at cap',
}

// --- Reset times, in the machine's local time zone (or `timeZone` when given) -------------

function partsOf(ms: number, timeZone: string | undefined): Record<string, string> {
  const format = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    ...(timeZone === undefined ? {} : { timeZone }),
  })
  const out: Record<string, string> = {}

  for (const p of format.formatToParts(new Date(ms))) {
    out[p.type] = p.value
  }

  return out
}

/** "15:20". */
export function clockTime(ms: number | undefined, timeZone?: string): string {
  if (ms === undefined) {
    return 'n/a'
  }
  const p = partsOf(ms, timeZone)

  return `${p.hour}:${p.minute}`
}

/** "Tue 24 Nov 15:20". */
export function dayTime(ms: number | undefined, timeZone?: string): string {
  if (ms === undefined) {
    return 'n/a'
  }
  const p = partsOf(ms, timeZone)

  return `${p.weekday} ${p.day} ${p.month} ${p.hour}:${p.minute}`
}

/** The time left in its shortest form: "6d23h", "4h36m", "8m". */
export function compactDuration(ms: number | undefined): string {
  return duration(ms).replace(/ /g, '')
}

/**
 * "reset 15:20 (2h30m)" for 5h; "reset Tue 24 Nov 15:20 (3d12h)" for 1w;
 * empty when the reset time is not known (no active window).
 */
export function resetText(s: Status, which: '5h' | '1w', timeZone?: string): string {
  const at = which === '5h' ? s.fiveHour?.resetsAt : s.week?.resetsAt
  const left = which === '5h' ? s.fiveHourMsToReset : s.msToReset

  if (at === undefined) {
    return ''
  }

  return `reset ${which === '5h' ? clockTime(at, timeZone) : dayTime(at, timeZone)} (${compactDuration(left)})`
}

/** What a window shows: a missing window shows as 0%, colored as 0% would be. */
export type Shown = { used: number; level: Level }

export function shown(s: Status, which: '5h' | '1w'): Shown {
  const used = which === '5h' ? s.fiveHour?.used : s.week?.used
  const level = which === '5h' ? s.five.level : s.level

  return used === undefined || level === 'nodata' ? { used: 0, level: 'ok' } : { used, level }
}

/** The text of `/budget status`. */
export function report(s: Status): string {
  const lines = [
    `1w: ${LEVEL_LABEL[s.level]}  ·  5h: ${LEVEL_LABEL[s.five.level]}`,
    `1w (week): ${s.week === undefined ? 'n/a' : pct(s.week.used)}  ·  5h: ${
      s.fiveHour === undefined ? 'n/a' : pct(s.fiveHour.used)
    }`,
    `Cap: ${s.cap}%`,
    `1w budget now (linear pace): ${pct(s.budget)}  ·  off by: ${signed(s.delta)} points`,
    `5h budget now: ${pct(s.five.budget)}  ·  off by: ${signed(s.five.delta)} points`,
    `Week elapsed: ${s.elapsed === undefined ? 'n/a' : pct(s.elapsed * 100)}`,
    `1w resets: ${dayTime(s.week?.resetsAt)}, in ${duration(s.msToReset)} (${days(s.msToReset)} days)`,
    `5h resets: ${clockTime(s.fiveHour?.resetsAt)}, in ${duration(s.fiveHourMsToReset)}`,
    `"Far ahead" alert from: +${s.alertDelta} points`,
  ]

  if (s.isSimulated) {
    lines.push('(SIMULATION on: /budget simulate off to go back to the real reading)')
  } else if (s.isStale && s.readAt !== undefined) {
    lines.push(`(reading from the last session: no reply yet in this one)`)
  }

  if (s.level === 'nodata') {
    lines.push('No weekly window available: it needs a Claude subscription and at least one model reply.')
  }

  return lines.join('\n')
}

/** The list of `/budget colors`. */
export function colorsReport(settings: BudgetSettings): string {
  return [
    'Pace colors (level: color):',
    ...COLOR_LEVELS.map(l => `  ${LEVEL_NAME[l]} [${l}]: ${settings.colors[l]} (${colorName(settings.colors[l])})`),
    '',
    'Change with: /budget color <ok|over1|over2|over3|over4|cap> <#rrggbb or name>',
    `Names: ${PRESETS.map(p => p.name).join(', ')}`,
  ].join('\n')
}

// --- The badge in the session title ------------------------------------------------------
// The title is text: colors become emoji dots, the one nearest the chosen color.

/** The emoji dot that best renders a `#rrggbb` color, by hue and lightness. */
export function dotFor(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16)
  const [r, g, b] = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const light = (max + min) / 2
  const chroma = max - min

  if (chroma < 0.15) {
    return light < 0.25 ? '⚫' : '⚪'
  }
  let hue = max === r ? ((g - b) / chroma) % 6 : max === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4
  hue = (hue * 60 + 360) % 360

  if (hue >= 15 && hue < 42 && light < 0.3) {
    return '🟤'
  }

  if (hue < 15 || hue >= 340) {
    return '🔴'
  }

  if (hue < 42) {
    return '🟠'
  }

  if (hue < 70) {
    return '🟡'
  }

  if (hue < 170) {
    return '🟢'
  }

  if (hue < 260) {
    return '🔵'
  }

  return '🟣'
}

const SEP = ' │ '

/** `🔴 5h 92% · 🟢 1w 50%`; a window with no data shows as 0%. */
export function titleBadge(s: Status, settings: BudgetSettings): string {
  const one = (name: '5h' | '1w') => {
    const { used, level } = shown(s, name)

    return `${dotFor(windowColor(used, level, settings))} ${name} ${pct(used)}`
  }

  return `${one('5h')} · ${one('1w')}`
}

const BADGE = /^\S+ 5h \S+ · \S+ 1w \S+ │ /u
const BADGE_ONLY = /^\S+ 5h \S+ · \S+ 1w \S+$/u

/** The title without the badge the mod put in front of it. */
export function stripBadge(title: string | undefined): string {
  if (title === undefined) {
    return ''
  }

  return BADGE_ONLY.test(title) ? '' : title.replace(BADGE, '')
}

/** The title with the badge in front; with no title, the badge alone. */
export function withBadge(title: string | undefined, badge: string): string {
  const base = stripBadge(title)

  return base === '' ? badge : `${badge}${SEP}${base}`
}
