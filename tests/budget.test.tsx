import type { CommandRunInput, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import {
  DEFAULT_COLORS,
  DEFAULT_RANGES,
  DEFAULT_SETTINGS,
  WEEK_MS,
  clampSettings,
  clockTime,
  compactDuration,
  dayTime,
  cleanRanges,
  compute,
  dotFor,
  moveRange,
  parseColor,
  rangeColor,
  removeRange,
  resetText,
  setRange,
  stripBadge,
  titleBadge,
  windowColor,
  withBadge,
} from '../hooks/budget'

const NOW = Date.parse('2026-11-17T12:00:00Z')
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
// Half the week gone: reset in 3.5 days. Half the 5h window gone: reset in 2.5 hours.
const RESET = new Date(NOW + 3.5 * DAY).toISOString()
const RESET5 = new Date(NOW + 2.5 * HOUR).toISOString()

const snap = (week?: number, reset: string | null = RESET, five?: number) => {
  const resetsAt = reset ?? undefined

  return {
    limits: [
      ...(week === undefined
        ? []
        : [resetsAt === undefined ? { kind: 'seven_day', percentUsed: week } : { kind: 'seven_day', percentUsed: week, resetsAt }]),
      ...(five === undefined ? [] : [{ kind: 'five_hour', percentUsed: five, resetsAt: RESET5 }]),
    ],
    at: NOW,
    isLive: true,
  }
}

const RANGES = { ...DEFAULT_SETTINGS, mode: 'ranges' as const }

test('linear pace: budget = elapsed x cap, for the 5h window too', async () => {
  const s = compute(snap(40, RESET, 30), NOW, DEFAULT_SETTINGS)
  expect(s.elapsed).toBe(0.5)
  expect(s.budget).toBe(45)
  expect(s.delta).toBe(-5)
  expect(s.level).toBe('ok')
  expect(s.five.budget).toBe(45)
  expect(s.five.level).toBe('ok')
  expect(compute(snap(40, RESET, 92), NOW, DEFAULT_SETTINGS).five.level).toBe('cap')
  expect(compute(snap(40, RESET, 61), NOW, DEFAULT_SETTINGS).five.level).toBe('over4')
})

test('ahead of pace: rising levels, then the cap', async () => {
  const at = (used: number) => compute(snap(used), NOW, DEFAULT_SETTINGS).level
  expect(at(46)).toBe('over1') // +1
  expect(at(51)).toBe('over2') // +6
  expect(at(56)).toBe('over3') // +11
  expect(at(60)).toBe('over4') // +15 = far ahead
  expect(at(90)).toBe('cap')
  expect(compute(snap(80), NOW, { ...DEFAULT_SETTINGS, cap: 80 }).level).toBe('cap')
})

test('missing data: n/a with no errors', async () => {
  expect(compute(null, NOW, DEFAULT_SETTINGS).level).toBe('nodata')
  expect(compute(snap(undefined, RESET, 20), NOW, DEFAULT_SETTINGS).level).toBe('nodata')
  expect(compute(snap(40), NOW, DEFAULT_SETTINGS).five.level).toBe('nodata')
  const noReset = compute(snap(50, null), NOW, DEFAULT_SETTINGS)
  expect(noReset.level).toBe('ok')
  expect(noReset.budget).toBe(undefined)
  expect(compute(snap(95, null), NOW, DEFAULT_SETTINGS).level).toBe('cap')
  expect(compute(snap(70, new Date(NOW - 1000).toISOString()), NOW, DEFAULT_SETTINGS).level).toBe('nodata')
  expect(compute(snap(30, 'nope'), NOW, DEFAULT_SETTINGS).budget).toBe(undefined)
  expect(WEEK_MS).toBe(7 * DAY)
})

test('colors: names, short and long hex; bad ones fall back to the defaults', async () => {
  expect(parseColor('red')).toBe('#d32f2f')
  expect(parseColor('#F00')).toBe('#ff0000')
  expect(parseColor('00aa11')).toBe('#00aa11')
  expect(parseColor('nope')).toBe(undefined)
  const s = clampSettings({ cap: 85, colors: { cap: '#123456', ok: 'nonsense' } })
  expect(s.colors.cap).toBe('#123456')
  expect(s.colors.ok).toBe(DEFAULT_COLORS.ok)
  expect(s.mode).toBe('pace')
  expect(s.ranges).toEqual([...DEFAULT_RANGES])
})

test('usage ranges: the color of the range that holds the usage', async () => {
  expect(rangeColor(0, DEFAULT_RANGES)).toBe('#3f9a52')
  expect(rangeColor(49.9, DEFAULT_RANGES)).toBe('#3f9a52')
  expect(rangeColor(50, DEFAULT_RANGES)).toBe('#c9a800')
  expect(rangeColor(84, DEFAULT_RANGES)).toBe('#e07000')
  expect(rangeColor(100, DEFAULT_RANGES)).toBe('#d32f2f')
  // In ranges mode the pace does not matter: 40% is green even far ahead of pace.
  const ahead = compute(snap(40, new Date(NOW + 6.5 * DAY).toISOString()), NOW, RANGES)
  expect(ahead.level).toBe('over4')
  expect(windowColor(40, ahead.level, RANGES)).toBe('#3f9a52')
  expect(windowColor(40, ahead.level, DEFAULT_SETTINGS)).toBe(DEFAULT_COLORS.over4)
  expect(windowColor(undefined, 'nodata', RANGES)).toBe('#8a8a8a')
})

test('ranges: add, recolor, move, remove; always sorted, the first from 0', async () => {
  let r = setRange(DEFAULT_RANGES, 95, '#9a1b1b')
  expect(r.map(x => x.from)).toEqual([0, 50, 70, 85, 95])
  r = setRange(r, 70, '#2f6bb0')
  expect(r.find(x => x.from === 70)?.color).toBe('#2f6bb0')
  r = moveRange(r, 1, 60)
  expect(r.map(x => x.from)).toEqual([0, 60, 70, 85, 95])
  r = removeRange(r, 95)
  expect(r.map(x => x.from)).toEqual([0, 60, 70, 85])
  expect(removeRange(r, 0).map(x => x.from)).toEqual([0, 60, 70, 85])
  expect(cleanRanges([{ from: 30, color: 'red' }, { from: 10, color: 'green' }])).toEqual([
    { from: 0, color: '#3f9a52' },
    { from: 30, color: '#d32f2f' },
  ])
  expect(cleanRanges('junk')).toEqual([...DEFAULT_RANGES])
})

test('title badge: dots from the chosen colors, original title kept', async () => {
  expect(dotFor(DEFAULT_COLORS.ok)).toBe('🟢')
  expect(dotFor(DEFAULT_COLORS.over1)).toBe('🟡')
  expect(dotFor(DEFAULT_COLORS.over3)).toBe('🟠')
  expect(dotFor(DEFAULT_COLORS.cap)).toBe('🔴')
  expect(dotFor('#2f6bb0')).toBe('🔵')
  const badge = titleBadge(compute(snap(40, RESET, 92), NOW, DEFAULT_SETTINGS), DEFAULT_SETTINGS)
  expect(badge).toBe('🔴 5h 92% · 🟢 1w 40%')
  // With ranges: 60% is yellow, 40% green.
  expect(titleBadge(compute(snap(40, RESET, 60), NOW, RANGES), RANGES)).toBe('🟡 5h 60% · 🟢 1w 40%')
  const titled = withBadge('Usage monitor', badge)
  expect(titled).toBe('🔴 5h 92% · 🟢 1w 40% │ Usage monitor')
  expect(withBadge(titled, '🟢 5h 10% · 🟢 1w 41%')).toBe('🟢 5h 10% · 🟢 1w 41% │ Usage monitor')
  expect(stripBadge(titled)).toBe('Usage monitor')
  // A badge from the Italian version is recognized too.
  expect(stripBadge('🔴 5h 92% · ⚪ 1w n/d │ Monitoraggio')).toBe('Monitoraggio')
  expect(titleBadge(compute(null, NOW, DEFAULT_SETTINGS), DEFAULT_SETTINGS)).toBe('🟢 5h 0% · 🟢 1w 0%')
})

const SITE = { maxRows: 10, bodyColumns: 200, scroll: { offset: 0, bodyRows: 10 }, view: {} }
const BAND = {
  plugin: 'usage-pacer',
  component: 'AbovePrompt',
  requestId: 'band',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, ...SITE },
} as const
const BACKDROP = {
  plugin: 'usage-pacer',
  component: 'Backdrop',
  requestId: 'backdrop',
  props: { scene: 'budget-bar', plugin: 'usage-pacer', glass: false },
} as const

function engine(on: On, used: number | undefined, five?: number) {
  mock.clock(on, { now: NOW })
  mock.store(on)
  const themes: unknown[] = []
  const clears: number[] = []
  const toasts: string[] = []
  on('command.register', () => ({ value: { command: 'budget' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', (_, e) => (toasts.push(String((e as { text?: unknown }).text)), { value: undefined }))
  on('theme.set', (_, e) => (themes.push(e), { value: { isDrawn: true, requestId: 't' } }))
  on('theme.clear', () => (clears.push(1), { value: { isDrawn: false, reason: 'cleared' } }))
  on('session.usage', () => ({
    value: {
      startedAt: NOW,
      context: { window: 200000 },
      rateLimits: [
        ...(used === undefined ? [] : [{ kind: 'seven_day', percentUsed: used, resetsAt: RESET }]),
        ...(five === undefined ? [] : [{ kind: 'five_hour', percentUsed: five, resetsAt: RESET5 }]),
      ],
    },
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('classic.UserPromptSubmit', () => ({}))

  return { themes, clears, toasts }
}

async function topSvg($: Parameters<Extract<Parameters<typeof test>[1], (...a: never[]) => unknown>>[0]): Promise<string> {
  const ui = await $.ui.mount({ ...BACKDROP, surface: 'desktop' })
  const source = String((await ui.find({ type: 'Svg' }))?.props.source)
  await ui.unmount()

  return source
}

const run = (args: string) => ({ command: 'budget', args }) as CommandRunInput

test('window colors never change: strip off by default; on, only a backdrop with no glass', async ($, on) => {
  const seen = engine(on, 40, 92)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(seen.themes).toEqual([])
  await $.command.run(run('strip on'))
  expect(seen.themes).toEqual([{ backdrop: { scene: 'budget-bar', glass: false } }])
})

test('the strip: 5h and 1w sections with usage and the level color', async ($, on) => {
  engine(on, 40, 92)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const source = await topSvg($)
  expect(source).toContain('5h  92%')
  expect(source).toContain('1w  40%')
  expect(source).toContain(`fill="${DEFAULT_COLORS.cap}"`)
  expect(source).toContain(`fill="${DEFAULT_COLORS.ok}"`)
})

test('the prompt bar: two colored sections 5h and 1w and the detail line', async ($, on) => {
  engine(on, 40, 30)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    const five = await ui.find({ key: 'five' })
    const week = await ui.find({ key: 'week' })
    expect(five?.text).toContain('5h')
    expect(five?.text).toContain('30%')
    expect(week?.text).toContain('1w')
    expect(week?.text).toContain('40%')
    expect(JSON.stringify(week)).toContain(DEFAULT_COLORS.ok)
    expect(five?.text).toMatch(/reset \d\d:\d\d \(2h30m\)/)
    expect(week?.text).toMatch(/reset [A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2} \d\d:\d\d \(3d12h\)/)
    // The pace sits between the usage and the reset, green when on pace.
    expect(five?.text).toContain('on pace')
    expect(week?.text).toContain('on pace')
    expect(JSON.stringify(five)).toContain(`"color":"${DEFAULT_COLORS.ok}"`)
    // Minimal: no detail line.
    expect(await ui.find({ type: 'Text', text: /budget|cap/ })).toBe(undefined)
    await ui.unmount()
  }
})

test('no data: 0% in the prompt bar, the strip and the title, with no reset shown', async ($, on) => {
  engine(on, undefined)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const five = await ui.find({ key: 'five' })
  expect(five?.text).toContain('0%')
  expect(five?.text).not.toContain('n/a')
  expect(five?.text).not.toContain('reset')
  await ui.unmount()
  expect(await topSvg($)).toContain('1w  0%')
  const r = await $.classic.UserPromptSubmit({ prompt: 'hi', session_title: 'Usage monitor' })
  expect(r.sessionTitle).toBe('🟢 5h 0% · 🟢 1w 0% │ Usage monitor')
})

test('at the cap: a toast', async ($, on) => {
  const seen = engine(on, 92)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(seen.toasts.length).toBe(1)
  expect(seen.toasts[0]).toContain('Weekly cap reached')
})

test('/budget color sets a pace color; /budget 80 the cap', async ($, on) => {
  engine(on, 82)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const out = await $.command.run(run('color over4 blue'))
  expect(out.text).toContain('#2f6bb0')
  expect(await topSvg($)).toContain('fill="#2f6bb0"')
  await $.command.run(run('80'))
  const st = await $.command.run(run('status'))
  expect(st.text).toContain('Cap: 80%')
  expect(await topSvg($)).toContain(`fill="${DEFAULT_COLORS.cap}"`)
})

test('/budget mode ranges and /budget range: colors by usage', async ($, on) => {
  engine(on, 40, 60)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const mode = await $.command.run(run('mode ranges'))
  expect(mode.text).toContain('Color mode: ranges')
  let source = await topSvg($)
  expect(source).toContain('fill="#c9a800"') // 5h 60% -> 50% range
  expect(source).toContain('fill="#3f9a52"') // 1w 40% -> 0% range
  const out = await $.command.run(run('range 30 purple'))
  expect(out.text).toContain('30%–50%: #7a4fa0 (Purple)')
  source = await topSvg($)
  expect(source).toContain('fill="#7a4fa0"') // 1w 40% -> 30% range
  await $.command.run(run('range remove 30'))
  expect(await topSvg($)).not.toContain('#7a4fa0')
  const r = await $.classic.UserPromptSubmit({ prompt: 'hi', session_title: 'Usage monitor' })
  expect(r.sessionTitle).toBe('🟡 5h 60% · 🟢 1w 40% │ Usage monitor')
})

test('/budget strip off removes the backdrop', async ($, on) => {
  const seen = engine(on, 40)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run(run('strip on'))
  await $.command.run(run('strip off'))
  expect(seen.clears.length).toBe(1)
})

test('/budget simulate 1w and 5h, then off', async ($, on) => {
  const seen = engine(on, 30, 10)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const out = await $.command.run(run('simulate 95 70'))
  expect(out.text).toContain('SIMULATION')
  expect(seen.toasts[0]).toContain('Weekly cap reached')
  const source = await topSvg($)
  expect(source).toContain('1w  95%')
  expect(source).toContain('5h  70%')
  await $.command.run(run('simulate off'))
  const st = await $.command.run(run('status'))
  expect(st.text).toContain('1w (week): 30%')
})

test('the session title gets the badge on each prompt; title off removes it', async ($, on) => {
  engine(on, 40, 92)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const r = await $.classic.UserPromptSubmit({ prompt: 'hi', session_title: 'Usage monitor' })
  expect(r.sessionTitle).toBe('🔴 5h 92% · 🟢 1w 40% │ Usage monitor')
  expect((await $.classic.UserPromptSubmit({ prompt: 'hi' })).sessionTitle).toBe(undefined)
  await $.command.run(run('title off'))
  const off = await $.classic.UserPromptSubmit({ prompt: 'hi', session_title: r.sessionTitle })
  expect(off.sessionTitle).toBe('Usage monitor')
})

test('/budget positions and the switches', async ($, on) => {
  engine(on, 40, 30)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const all = await $.command.run(run('positions'))
  expect(all.text).toContain('Title bar [title]: on')
  expect(all.text).toContain('Strip below the title [strip]: off')
  const out = await $.command.run(run('promptbar off'))
  expect(out.text).toContain('Bar above the prompt [promptbar]: off')
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ key: 'five' })).toBe(undefined)
  await ui.unmount()
  const st = await $.command.run(run('statusline off'))
  expect(st.text).toContain('Status line [statusline]: off')
})

const PANE = {
  plugin: 'usage-pacer',
  component: 'Pane',
  requestId: 'usage-pacer',
  props: { title: 'Claude budget', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

test('the panel: pick the color mode, a range start and its color from dropdowns', async ($, on) => {
  engine(on, 40, 60)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.select({ key: 'mode', value: 'ranges' })
  await ui.unmount()
  ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.select({ key: 'range-from-1', value: '40' })
  await ui.select({ key: 'range-color-1', value: '#2f6bb0' })
  await ui.unmount()
  const out = await $.command.run(run('ranges'))
  expect(out.text).toContain('40%–70%: #2f6bb0 (Blue)')
  expect(await topSvg($)).toContain('fill="#2f6bb0"') // 1w 40% -> 40% range, blue
})

test('reset times: clock time for 5h, day, date and time for 1w', async () => {
  const s = compute(snap(40, RESET, 30), NOW, DEFAULT_SETTINGS)
  expect(clockTime(Date.parse(RESET5), 'UTC')).toBe('14:30')
  expect(dayTime(Date.parse(RESET), 'UTC')).toBe('Sat 21 Nov 00:00')
  expect(dayTime(Date.parse(RESET), 'Europe/Rome')).toBe('Sat 21 Nov 01:00')
  expect(resetText(s, '5h', 'UTC')).toBe('reset 14:30 (2h30m)')
  expect(resetText(s, '1w', 'UTC')).toBe('reset Sat 21 Nov 00:00 (3d12h)')
  expect(compactDuration(6 * DAY + 23 * HOUR)).toBe('6d23h')
  expect(compactDuration(4 * HOUR + 36 * 60000)).toBe('4h36m')
  expect(compactDuration(8 * 60000)).toBe('8m')
  expect(resetText(compute(snap(40, null), NOW, DEFAULT_SETTINGS), '1w', 'UTC')).toBe('')
})

test('the pace on each row: green on pace, then yellow to red as usage runs ahead', async ($, on) => {
  // 5h half gone: budget 45%. 5h at 50% is +5 (over pace), 1w at 92% is past the cap.
  engine(on, 92, 50)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    const five = await ui.find({ key: 'five' })
    const week = await ui.find({ key: 'week' })
    expect(five?.text).toContain('over pace')
    expect(JSON.stringify(five)).toContain(`"color":"${DEFAULT_COLORS.over2}"`)
    expect(week?.text).toContain('at cap')
    expect(JSON.stringify(week)).toContain(`"color":"${DEFAULT_COLORS.cap}"`)
    await ui.unmount()
  }
})

test('the pace sits in the free space between the usage and the reset, by flex layout', async ($, on) => {
  engine(on, 40, 30)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    const five = JSON.stringify(await ui.find({ key: 'five' }))
    const week = JSON.stringify(await ui.find({ key: 'week' }))

    for (const row of [five, week]) {
      // Left and right texts keep their width; the middle takes what is left and centers the pace.
      expect(row).toContain('"flexGrow":1')
      expect(row).toContain('"justifyContent":"center"')
      expect(row).toContain('"flexShrink":0')
      // No width guessing: no padding, no overlay, and the pace never wraps.
      expect(row).not.toContain('paddingLeft')
      expect(row).not.toContain('"position":"absolute"')
      expect(row).toContain('"wrap":"truncate-end"')
    }
    // The bar keeps its whole width and fills by usage.
    expect(five).toContain('"width":"30%"')
    expect(week).toContain('"width":"40%"')
    await ui.unmount()
  }
})
