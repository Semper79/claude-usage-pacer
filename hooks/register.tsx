// usage-pacer: keeps Claude usage on a linear pace toward a cap, for the 5-hour (5h) and
// weekly (1w) windows.
//
// Data: the rate-limit windows of the status line (`five_hour`, `seven_day`), read with
// `$.session.usage()` at start and pushed by the engine with `session.measure`.
// Signal, each position switchable: a badge in the title bar (the session title), a strip
// below the title (the window backdrop, no glass), a bar above the prompt, a status line
// entry. Colors by pace or by usage ranges, all chosen by the user. Toasts when the cap is
// reached or usage runs far ahead of pace.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { BudgetColorLevel, BudgetLimit, BudgetSettings, BudgetSnapshot } from '../types'
import {
  COLOR_LEVELS,
  DEFAULT_COLORS,
  DEFAULT_RANGES,
  DEFAULT_SETTINGS,
  LEVEL_ALIASES,
  LEVEL_NAME,
  PACE_LABEL,
  POSITIONS,
  POSITION_WORDS,
  PRESETS,
  clampSettings,
  colorName,
  colorOf,
  colorsReport,
  compute,
  days,
  resetText,
  shown,
  duration,
  isVeryOver,
  moveRange,
  parseColor,
  pct,
  positionsReport,
  rangesReport,
  removeRange,
  report,
  setRange,
  signed,
  stripBadge,
  titleBadge,
  windowColor,
  withBadge,
} from './budget'
import type { Level, Status } from './budget'
import { stripAlt, stripSvg } from './topbar'

const PANE = 'usage-pacer'
const SCENE = 'budget-bar'
const REMIND_EVERY_MS = 10 * 60 * 1000
const TICK_MS = 60 * 1000

const snapAtom = atom({ plugin: 'usage-pacer', key: 'snap' } as const, null, { shape: 'snap-1' })
const settingsAtom = atom({ plugin: 'usage-pacer', key: 'settings' } as const, DEFAULT_SETTINGS, {
  shape: 'settings-4',
})
const nowAtom = atom({ plugin: 'usage-pacer', key: 'now' } as const, 0)

const HELP = [
  'Usage of /budget:',
  '  /budget                         opens the panel and shows the status',
  '  /budget status                  shows the status only',
  '  /budget 85                      sets the cap to 85% (also: /budget cap 85)',
  '  /budget threshold 10            "far ahead" from +10 points over the budget',
  '  /budget positions               where the 5h | 1w signal shows',
  '  /budget title on|off            the badge in the title bar (updates on each prompt)',
  '  /budget strip on|off            the colored strip below the title',
  '  /budget promptbar on|off        the bar above the prompt',
  '  /budget statusline on|off       the status line entry',
  '  /budget mode pace|ranges        color by pace against the budget, or by usage ranges',
  '  /budget ranges                  shows the usage ranges',
  '  /budget range 70 orange         the range starting at 70% is orange (adds it if new)',
  '  /budget range remove 70         removes the range starting at 70%',
  '  /budget ranges default          restores the ranges',
  '  /budget colors                  shows the pace colors',
  '  /budget color cap red           sets a pace color (ok, over1..over4, cap; #rrggbb or name)',
  '  /budget colors default          restores the pace colors',
  '  /budget default                 restores everything',
  '  /budget simulate 75 [5h]        fakes weekly (and 5-hour) usage to try colors and alerts',
  '  /budget simulate off            back to the real reading',
].join('\n')

type Dollar = EngineInterface

// Module memory: starts over on each reload, which is fine.
const mem = {
  lastLevel: null as Level | null,
  isSceneSet: false,
  lastReminderAt: 0,
}

async function status($: Dollar): Promise<Status> {
  return compute(await read($, snapAtom), await $.clock.now(), await read($, settingsAtom))
}

function alertText(s: Status): string | undefined {
  const reset = `Resets in ${duration(s.msToReset)} (${days(s.msToReset)} days).`

  if (s.level === 'cap') {
    return `⛔ Weekly cap reached: ${pct(s.week?.used)} of a ${s.cap}% cap. ${reset}`
  }

  if (isVeryOver(s)) {
    return `⚠️ Far ahead of pace: ${pct(s.week?.used)} used, ${pct(s.budget)} expected (${signed(
      s.delta,
    )} points). ${reset}`
  }

  return undefined
}

/** The strip below the title: a backdrop scene the `Backdrop` hook draws. */
async function applyScene($: Dollar, settings: BudgetSettings) {
  if (settings.theme && !mem.isSceneSet) {
    mem.isSceneSet = true
    // glass: false = the app's panels stay exactly as they are: no window color changes.
    await $.theme.set({ backdrop: { scene: SCENE, glass: false } })
  } else if (!settings.theme && mem.isSceneSet) {
    mem.isSceneSet = false
    await $.theme.clear()
  }
}

/**
 * The title to give the session, or undefined to leave it.
 * With no base title it makes none up (the app names the session itself).
 */
async function titleFor($: Dollar, current: string | undefined): Promise<string | undefined> {
  const settings = await read($, settingsAtom)
  const base = stripBadge(current)

  if (base === '') {
    return undefined
  }

  if (!settings.title) {
    // Off: removes the badge if there was one, else touches nothing.
    return base === current ? undefined : base
  }
  const next = withBadge(base, titleBadge(await status($), settings))

  return next === current ? undefined : next
}

async function refresh($: Dollar) {
  const now = await $.clock.now()
  await update($, nowAtom, () => now)
  const settings = await read($, settingsAtom)
  const s = compute(await read($, snapAtom), now, settings)

  $.ui.status(
    !settings.status
      ? undefined
      : `5h ${pct(shown(s, '5h').used)} · 1w ${pct(shown(s, '1w').used)}${
          s.budget === undefined ? '' : ` / budget ${pct(s.budget)}`
        } · reset ${duration(s.msToReset)}`,
  )
  await applyScene($, settings)

  const crossedCap = s.level === 'cap' && mem.lastLevel !== 'cap'
  const crossedFar = isVeryOver(s) && mem.lastLevel !== 'over4' && mem.lastLevel !== 'cap'

  if (crossedCap || crossedFar) {
    const text = alertText(s)

    if (text !== undefined) {
      $.ui.toast(text, { timeoutMs: 10000 })
      mem.lastReminderAt = now
    }
  }
  mem.lastLevel = s.level
}

async function saveSettings($: Dollar, change: (s: BudgetSettings) => BudgetSettings): Promise<BudgetSettings> {
  const next = clampSettings(change(await read($, settingsAtom)))
  await update($, settingsAtom, () => next)
  await $.store.set('settings', next)
  await refresh($)

  return next
}

async function setColor($: Dollar, level: BudgetColorLevel, hex: string) {
  await saveSettings($, old => ({ ...old, colors: { ...old.colors, [level]: hex } }))
}

async function saveSnapshot($: Dollar, limits: readonly BudgetLimit[]) {
  const snap: BudgetSnapshot = {
    limits: limits.map(l =>
      l.resetsAt === undefined
        ? { kind: l.kind, percentUsed: l.percentUsed }
        : { kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt },
    ),
    at: await $.clock.now(),
    isLive: true,
  }
  // The real reading is always stored; while simulating, the view stays on the simulation.
  await $.store.set('snap', snap)
  await update($, snapAtom, held => (held?.isSimulated === true ? held : snap))
}

/** `/budget simulate <1w%> [<5h%>]`: stands in for usage to try colors and alerts. */
async function simulate($: Dollar, used: number | null, fiveUsed?: number) {
  const now = await $.clock.now()
  const real = ((await $.store.get('snap')) as BudgetSnapshot | undefined) ?? null

  if (used === null) {
    await update($, snapAtom, () => (real === null ? null : { ...real, isSimulated: false }))
    await refresh($)

    return
  }
  const limits = real?.limits ?? []
  const future = (kind: string, fallbackMs: number) => {
    const iso = limits.find(l => l.kind === kind)?.resetsAt
    const t = iso === undefined ? NaN : Date.parse(iso)

    return Number.isFinite(t) && t > now && iso !== undefined ? iso : new Date(now + fallbackMs).toISOString()
  }
  const realFive = limits.find(l => l.kind === 'five_hour')
  const five =
    fiveUsed !== undefined
      ? { kind: 'five_hour', percentUsed: fiveUsed, resetsAt: future('five_hour', 2.5 * 3600000) }
      : realFive
  const snap: BudgetSnapshot = {
    limits: [
      { kind: 'seven_day', percentUsed: used, resetsAt: future('seven_day', 3.5 * 86400000) },
      ...(five === undefined ? [] : [five]),
    ],
    at: now,
    isLive: true,
    isSimulated: true,
  }
  mem.lastReminderAt = 0
  await update($, snapAtom, () => snap)
  await refresh($)
}

async function remind($: Dollar) {
  const now = await $.clock.now()

  if (now - mem.lastReminderAt < REMIND_EVERY_MS) {
    return
  }
  const text = alertText(await status($))

  if (text !== undefined) {
    mem.lastReminderAt = now
    $.ui.toast(`Reminder · ${text}`, { timeoutMs: 8000 })
  }
}

function colorOptions(current: string) {
  const options = PRESETS.map(p => ({ value: p.hex, label: p.label }))

  return options.some(o => o.value === current) ? options : [{ value: current, label: colorName(current) }, ...options]
}

const PERCENT_OPTIONS = Array.from({ length: 20 }, (_, i) => (i + 1) * 5).map(n => ({ value: String(n), label: `${n}%` }))

function percentOptions(current: number) {
  return PERCENT_OPTIONS.some(o => o.value === String(current))
    ? PERCENT_OPTIONS
    : [{ value: String(current), label: `${current}%` }, ...PERCENT_OPTIONS]
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'budget',
      description: 'Claude usage 5h / 1w: status, cap, threshold, positions, colors and ranges',
      argumentHint:
        '[status | <cap%> | threshold <points> | positions | title|strip|promptbar|statusline on|off | mode pace|ranges | range <from%> <color> | color <level> <color> | simulate <%>]',
      immediate: true,
    })

    // Settings and the last known reading, from earlier sessions.
    const stored = await $.store.get('settings')
    await update($, settingsAtom, () => clampSettings(stored))
    const old = (await $.store.get('snap')) as BudgetSnapshot | undefined

    if (old !== undefined && Array.isArray(old.limits)) {
      await update($, snapAtom, held => held ?? { ...old, isLive: false })
    }

    // This session's reading, if the engine already has one.
    const usage = await $.session.usage()

    if (usage.rateLimits.length > 0) {
      await saveSnapshot($, usage.rateLimits)
    }

    $.clock.every(TICK_MS, () => void refresh($))
    await refresh($)

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      await saveSnapshot($, e.rateLimits)
      await refresh($)
    }

    return next(e)
  })

  // The badge in the title bar: it is the session title, which the classic SessionStart
  // and UserPromptSubmit hooks can set. So it updates at start and on each prompt sent.
  // The original title stays after the badge.
  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e)
    const title = await titleFor($, result.sessionTitle ?? e.session_title)

    return title === undefined ? result : { ...result, sessionTitle: title }
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    const result = await next(e)
    const title = await titleFor($, result.sessionTitle ?? e.session_title)

    return title === undefined ? result : { ...result, sessionTitle: title }
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.command === undefined && e.isMeta !== true) {
      await remind($)
    }

    return next(e)
  })

  on('command.run', { command: 'budget' }, async ($, e) => {
    const words = e.args.trim().toLowerCase().split(/\s+/).filter(w => w !== '')
    const num = (w: string | undefined) => (w === undefined ? NaN : Number(w.replace('%', '').replace(',', '.')))
    const onOff = (w: string | undefined) =>
      w === 'on' || w === 'yes' || w === 'true' ? true : w === 'off' || w === 'no' || w === 'false' ? false : undefined
    const [first, second, third] = words
    const settingsNow = async () => read($, settingsAtom)

    if (first === undefined || first === 'panel') {
      await $.ui.open({ id: PANE, title: 'Claude budget' })

      return { text: report(await status($)) }
    }

    if (first === 'status') {
      return { text: report(await status($)) }
    }

    if (first === 'help' || first === '?') {
      return { text: HELP }
    }

    if (first === 'default' || first === 'reset') {
      await saveSettings($, () => DEFAULT_SETTINGS)

      return { text: `Defaults restored: cap ${DEFAULT_SETTINGS.cap}%, threshold +${DEFAULT_SETTINGS.alertDelta} points, pace colors and ranges.` }
    }

    if (first === 'positions') {
      return { text: positionsReport(await settingsNow()) }
    }

    if (first === 'mode') {
      if (second === 'pace' || second === 'ranges') {
        const mode = second
        const s = await saveSettings($, old => ({ ...old, mode }))

        return { text: rangesReport(s) }
      }

      return { text: `Usage: /budget mode pace|ranges\n\n${rangesReport(await settingsNow())}` }
    }

    if (first === 'ranges') {
      if (second === 'default' || second === 'reset') {
        const s = await saveSettings($, old => ({ ...old, ranges: [...DEFAULT_RANGES] }))

        return { text: `Ranges restored.\n\n${rangesReport(s)}` }
      }

      return { text: rangesReport(await settingsNow()) }
    }

    if (first === 'range') {
      if (second === 'remove' && Number.isFinite(num(third))) {
        const from = num(third)
        const s = await saveSettings($, old => ({ ...old, ranges: removeRange(old.ranges, from) }))

        return { text: rangesReport(s) }
      }
      const from = num(second)
      const hex = parseColor(third)

      if (!Number.isFinite(from) || from < 0 || from > 100 || hex === undefined) {
        return { text: `Usage: /budget range <from% 0-100> <#rrggbb or name>\n\n${rangesReport(await settingsNow())}` }
      }
      const s = await saveSettings($, old => ({ ...old, ranges: setRange(old.ranges, Math.round(from), hex) }))
      const note = s.mode === 'ranges' ? '' : '\nThe signal is colored by pace now: /budget mode ranges to use the ranges.'

      return { text: `${rangesReport(s)}${note}` }
    }

    if (first === 'colors') {
      if (second === 'default' || second === 'reset') {
        await saveSettings($, old => ({ ...old, colors: DEFAULT_COLORS }))

        return { text: `Pace colors restored.\n\n${colorsReport(await settingsNow())}` }
      }

      return { text: colorsReport(await settingsNow()) }
    }

    if (first === 'color') {
      const level = second === undefined ? undefined : LEVEL_ALIASES[second]
      const hex = parseColor(third)

      if (level === undefined || hex === undefined) {
        return { text: `Usage: /budget color <ok|over1|over2|over3|over4|cap> <#rrggbb or name>\n\n${colorsReport(await settingsNow())}` }
      }
      await setColor($, level, hex)

      return { text: `Color "${LEVEL_NAME[level]}": ${hex}.` }
    }

    if (first === 'simulate') {
      if (second === 'off' || second === 'stop') {
        await simulate($, null)

        return { text: `Simulation over: back to the real reading.\n\n${report(await status($))}` }
      }

      if (Number.isFinite(num(second))) {
        const week = Math.max(0, Math.min(100, num(second)))
        const five = Number.isFinite(num(third)) ? Math.max(0, Math.min(100, num(third))) : undefined
        await simulate($, week, five)

        return { text: `Simulation: 1w at ${week}%${five === undefined ? '' : `, 5h at ${five}%`}. /budget simulate off goes back to the real reading.\n\n${report(await status($))}` }
      }
    }

    const capWord = first === 'cap' ? second : first

    if (Number.isFinite(num(capWord))) {
      const s = await saveSettings($, old => ({ ...old, cap: num(capWord) }))

      return { text: `Cap set to ${s.cap}%.\n\n${report(await status($))}` }
    }

    if (first === 'threshold' && Number.isFinite(num(second))) {
      const s = await saveSettings($, old => ({ ...old, alertDelta: num(second) }))

      return { text: `"Far ahead" from +${s.alertDelta} points over the budget.` }
    }

    const position = first === undefined ? undefined : POSITION_WORDS[first]

    if (position !== undefined && onOff(second) !== undefined) {
      const value = onOff(second) === true
      const s = await saveSettings($, old => ({ ...old, [position]: value }))
      const note = position === 'title' ? '\nThe title updates on the next prompt you send.' : ''

      return { text: `${positionsReport(s)}${note}` }
    }

    return { text: `Unknown argument: "${e.args.trim()}".\n\n${HELP}` }
  })

  // The colored strip 5h | 1w below the title (desktop and mobile).
  on('ui.render', { component: 'Backdrop' }, async ($, e, next) => {
    if (e.props.plugin !== 'usage-pacer' || e.props.scene !== SCENE) {
      return next(e)
    }

    if (e.surface !== 'desktop' && e.surface !== 'mobile') {
      return next(e)
    }
    const settings = await read($, settingsAtom)
    const now = await read($, nowAtom)
    const s = compute(await read($, snapAtom), now === 0 ? await $.clock.now() : now, settings)
    const { Svg } = $.ui.resolve(e)

    return <Svg source={stripSvg(s, settings)} alt={stripAlt(s)} />
  })

  // The bar above the prompt, kept minimal: 5h and 1w side by side. Each is a label row over a
  // full-width colored bar. The row is a real flex row: the usage on the left, the reset time
  // on the right, and the pace ("● on pace", green on pace, then yellow, orange and red as usage
  // runs ahead of the linear budget) centered in whatever space the two leave free, so it
  // adapts to the texts that are there with no width guessing.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const settings = await read($, settingsAtom)

    if (e.props.hasSurvey || !settings.band) {
      return next(e)
    }
    const now = await read($, nowAtom)
    const s = compute(await read($, snapAtom), now === 0 ? await $.clock.now() : now, settings)
    const { Box, Text } = $.ui.resolve(e)
    // The bar's thickness as the engine's own Progress draws it: one row on the terminal, a thin
    // line on the app.
    const barHeight = e.surface === 'terminal' ? 1 : 0.3
    const section = (name: '5h' | '1w', key: string) => {
      const { used, level } = shown(s, name)
      const reset = resetText(s, name)
      // The pace always uses the pace colors, whatever mode colors the bar itself.
      const paceColor = level === 'nodata' ? colorOf('ok', settings) : colorOf(level, settings)
      const fill = Math.min(100, Math.max(0, used))

      return (
        <Box key={key} width="50%" flexDirection="column">
          <Box flexDirection="row">
            <Box flexShrink={0}>
              <Text>
                {name} <Text dimColor>{pct(used)}</Text>
              </Text>
            </Box>
            <Box flexGrow={1} flexShrink={1} justifyContent="center" paddingX={1}>
              <Text color={paceColor} bold wrap="truncate-end">
                ● {PACE_LABEL[level === 'nodata' ? 'ok' : level]}
              </Text>
            </Box>
            {reset !== '' && (
              <Box flexShrink={0}>
                <Text dimColor>{reset}</Text>
              </Box>
            )}
          </Box>
          <Box width="100%" height={barHeight} backgroundColor="userMessageBackground">
            <Box width={`${fill}%`} height={barHeight} backgroundColor={windowColor(used, level, settings)} />
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="row" gap={3}>
        {section('5h', 'five')}
        {section('1w', 'week')}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const settings = await read($, settingsAtom)
    const now = await read($, nowAtom)
    const s = compute(await read($, snapAtom), now === 0 ? await $.clock.now() : now, settings)
    const { Box, Text, Button, Progress, Select } = $.ui.resolve(e)
    const setCap = (n: number) => () => void saveSettings($, old => ({ ...old, cap: n }))
    const setDelta = (n: number) => () => void saveSettings($, old => ({ ...old, alertDelta: n }))
    const { ranges } = settings
    const lastFrom = ranges[ranges.length - 1]?.from ?? 0

    return (
      <Box flexDirection="column">
        {s.fiveHour !== undefined && (
          <Progress
            label="5h"
            value={s.fiveHour.used}
            max={100}
            valueText={pct(s.fiveHour.used)}
            color={windowColor(s.fiveHour.used, s.five.level, settings)}
          />
        )}
        {s.week !== undefined && (
          <Progress
            label="1w"
            value={s.week.used}
            max={100}
            valueText={pct(s.week.used)}
            color={windowColor(s.week.used, s.level, settings)}
          />
        )}
        <Text> </Text>
        {report(s)
          .split('\n')
          .map(line => (
            <Text dimColor={line.startsWith('(')}>{line}</Text>
          ))}
        <Text> </Text>
        <Text bold>Cap: {settings.cap}%</Text>
        <Box flexDirection="row">
          <Button key="cap-5" label="−5" onPress={setCap(settings.cap - 5)} />
          <Button key="cap-1" label="−1" onPress={setCap(settings.cap - 1)} />
          <Button key="cap+1" label="+1" onPress={setCap(settings.cap + 1)} />
          <Button key="cap+5" label="+5" onPress={setCap(settings.cap + 5)} />
          <Button key="cap-default" label="90 (default)" onPress={setCap(DEFAULT_SETTINGS.cap)} />
        </Box>
        <Text bold>Far ahead from: +{settings.alertDelta} points</Text>
        <Box flexDirection="row">
          <Button key="delta-1" label="−1" onPress={setDelta(settings.alertDelta - 1)} />
          <Button key="delta+1" label="+1" onPress={setDelta(settings.alertDelta + 1)} />
          <Button key="delta-default" label="15 (default)" onPress={setDelta(DEFAULT_SETTINGS.alertDelta)} />
        </Box>
        <Text> </Text>
        <Text bold>Where the 5h | 1w signal shows</Text>
        {POSITIONS.map(p => (
          <Button
            key={`pos-${p.key}`}
            label={`${p.label}: ${settings[p.key] ? 'on' : 'off'}`}
            onPress={() => void saveSettings($, old => ({ ...old, [p.key]: !old[p.key] }))}
          />
        ))}
        <Text dimColor>The title updates on each prompt you send.</Text>
        <Text> </Text>
        <Text bold>Colors</Text>
        <Select
          key="mode"
          label="Color by"
          options={[
            { value: 'pace', label: 'Pace against the budget' },
            { value: 'ranges', label: 'Usage ranges (%)' },
          ]}
          value={settings.mode}
          onSelect={value => void saveSettings($, old => ({ ...old, mode: value === 'ranges' ? 'ranges' : 'pace' }))}
        />
        {settings.mode === 'ranges' ? (
          <Box flexDirection="column">
            {ranges.map((r, i) => (
              <Box key={`range-row-${i}`} flexDirection="row">
                <Text color={r.color}>██ </Text>
                {i === 0 ? (
                  <Text>from 0% </Text>
                ) : (
                  <Select
                    key={`range-from-${i}`}
                    label="from"
                    options={percentOptions(r.from)}
                    value={String(r.from)}
                    onSelect={value => void saveSettings($, old => ({ ...old, ranges: moveRange(old.ranges, i, Number(value)) }))}
                  />
                )}
                <Select
                  key={`range-color-${i}`}
                  label="color"
                  options={colorOptions(r.color)}
                  value={r.color}
                  onSelect={value => void saveSettings($, old => ({ ...old, ranges: setRange(old.ranges, r.from, value) }))}
                />
                {i > 0 && (
                  <Button
                    key={`range-remove-${i}`}
                    label="Remove"
                    onPress={() => void saveSettings($, old => ({ ...old, ranges: removeRange(old.ranges, r.from) }))}
                  />
                )}
              </Box>
            ))}
            <Box flexDirection="row">
              {lastFrom < 100 && (
                <Button
                  key="range-add"
                  label="Add range"
                  onPress={() =>
                    void saveSettings($, old => ({
                      ...old,
                      ranges: setRange(old.ranges, Math.min(100, lastFrom + 10), PRESETS[11]?.hex ?? '#d32f2f'),
                    }))
                  }
                />
              )}
              <Button
                key="ranges-default"
                label="Default ranges"
                onPress={() => void saveSettings($, old => ({ ...old, ranges: [...DEFAULT_RANGES] }))}
              />
            </Box>
            <Text dimColor>Any color: /budget range 70 #ff8800</Text>
          </Box>
        ) : (
          <Box flexDirection="column">
            {COLOR_LEVELS.map(level => (
              <Box key={`level-row-${level}`} flexDirection="row">
                <Text color={colorOf(level, settings)}>██ </Text>
                <Select
                  key={`color-${level}`}
                  label={LEVEL_NAME[level]}
                  options={colorOptions(settings.colors[level])}
                  value={settings.colors[level]}
                  onSelect={value => void setColor($, level, value)}
                />
              </Box>
            ))}
            <Button
              key="colors-default"
              label="Default colors"
              onPress={() => void saveSettings($, old => ({ ...old, colors: DEFAULT_COLORS }))}
            />
            <Text dimColor>Any color: /budget color cap #ff0000</Text>
          </Box>
        )}
      </Box>
    )
  })
}
