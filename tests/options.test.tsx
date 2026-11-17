import type { CommandRunInput, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import {
  DEFAULT_SETTINGS,
  OPTION_DEFAULTS,
  cleanOptions,
  optionChanges,
  settingsWithOptions,
} from '../hooks/budget'

const NOW = Date.parse('2026-11-17T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000
const RESET = new Date(NOW + 3.5 * DAY).toISOString()
const run = (args: string) => ({ command: 'budget', args }) as CommandRunInput

const BACKDROP = {
  plugin: 'usage-pacer',
  component: 'Backdrop',
  requestId: 'backdrop',
  props: { scene: 'budget-bar', plugin: 'usage-pacer', glass: false },
} as const

function engine(on: On, used: number, entries: Record<string, unknown> = {}) {
  mock.clock(on, { now: NOW })
  mock.store(on, entries)
  const themes: unknown[] = []
  on('command.register', () => ({ value: { command: 'budget' } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('theme.set', (_, e) => (themes.push(e), { value: { isDrawn: true, requestId: 't' } }))
  on('theme.clear', () => ({ value: { isDrawn: false, reason: 'cleared' } }))
  on('session.usage', () => ({
    value: {
      startedAt: NOW,
      context: { window: 200000 },
      rateLimits: [{ kind: 'seven_day', percentUsed: used, resetsAt: RESET }],
    },
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('classic.UserPromptSubmit', () => ({}))

  return { themes }
}

async function topSvg($: Parameters<Extract<Parameters<typeof test>[1], (...a: never[]) => unknown>>[0]): Promise<string> {
  const ui = await $.ui.mount({ ...BACKDROP, surface: 'desktop' })
  const source = String((await ui.find({ type: 'Svg' }))?.props.source)
  await ui.unmount()

  return source
}

test('options: wrong or missing values fall back to the defaults', async () => {
  expect(cleanOptions(undefined)).toEqual(OPTION_DEFAULTS)
  expect(cleanOptions({ cap: 'high', strip: 'yes', colorCap: 7, threshold: 20 })).toEqual({ ...OPTION_DEFAULTS, threshold: 20 })
  expect(cleanOptions({ cap: Number.NaN }).cap).toBe(90)
})

test('options: only the ones that differ from the baseline are changes', async () => {
  const defaults = cleanOptions({})
  expect(optionChanges(defaults, defaults)).toEqual([])
  expect(optionChanges(cleanOptions({ cap: 80, strip: true }), defaults)).toEqual(['cap', 'strip'])
  expect(optionChanges(cleanOptions({ cap: 80 }), cleanOptions({ cap: 80 }))).toEqual([])
})

test('options: each one sets its setting and leaves the rest alone', async () => {
  const options = cleanOptions({
    cap: 75,
    threshold: 10,
    title: false,
    strip: true,
    promptBar: false,
    statusLine: false,
    colorMode: 'ranges',
    colorOk: 'blue',
    colorCap: 'dark-red',
  })
  const keys = ['cap', 'threshold', 'title', 'strip', 'promptBar', 'statusLine', 'colorMode', 'colorOk', 'colorCap'] as const
  const next = settingsWithOptions(DEFAULT_SETTINGS, options, keys)
  expect(next.cap).toBe(75)
  expect(next.alertDelta).toBe(10)
  expect(next.title).toBe(false)
  expect(next.theme).toBe(true)
  expect(next.band).toBe(false)
  expect(next.status).toBe(false)
  expect(next.mode).toBe('ranges')
  expect(next.colors.ok).toBe('#2f6bb0')
  expect(next.colors.cap).toBe('#9a1b1b')
  // Colors not named stay, and so do the ranges.
  expect(next.colors.over1).toBe(DEFAULT_SETTINGS.colors.over1)
  expect(next.ranges).toEqual(DEFAULT_SETTINGS.ranges)
  // Only the named options apply.
  const only = settingsWithOptions(DEFAULT_SETTINGS, options, ['cap'])
  expect(only.cap).toBe(75)
  expect(only.alertDelta).toBe(DEFAULT_SETTINGS.alertDelta)
  expect(only.theme).toBe(false)
})

test('options set in the plugin settings reach the mod', { options: { cap: 80, strip: true, colorCap: 'blue' } }, async ($, on) => {
  const seen = engine(on, 82)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect((await $.command.run(run('status'))).text).toContain('Cap: 80%')
  // The strip is on (the backdrop is set) and the cap color is the blue picked.
  expect(seen.themes).toEqual([{ backdrop: { scene: 'budget-bar', glass: false } }])
  expect(await topSvg($)).toContain('fill="#2f6bb0"')
})

test('what /budget sets later is kept while the options stay as they were', { options: { cap: 80 } }, async ($, on) => {
  engine(on, 40)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect((await $.command.run(run('status'))).text).toContain('Cap: 80%')
  await $.command.run(run('70'))
  expect((await $.command.run(run('status'))).text).toContain('Cap: 70%')
  // The module reloads (as it does when a setting changes): the cap option still reads 80, as
  // applied before, so the 70 stays.
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect((await $.command.run(run('status'))).text).toContain('Cap: 70%')
})

test('first run with the defaults keeps what the panel stored before', async ($, on) => {
  engine(on, 40, { settings: { ...DEFAULT_SETTINGS, cap: 65 } })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect((await $.command.run(run('status'))).text).toContain('Cap: 65%')
})
