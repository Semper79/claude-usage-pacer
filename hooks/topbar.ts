// The strip below the title: two sections, "5h" and "1w", each in its color and with the
// usage reached. It is drawn as the window backdrop with no glass, so the app's panels
// keep their own colors; it shows only where the app lets the backdrop through.

import type { BudgetSettings } from '../types'
import { pct, shown, windowColor } from './budget'
import type { Status } from './budget'

/** Where the strip sits, in % of the window width and px of height. */
export const STRIP = { from: 36, to: 82, height: 40 }

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function section(x: number, width: number, color: string, label: string, height: number): string {
  const mid = x + width / 2

  return [
    `<rect x="${x}%" y="0" width="${width}%" height="${height}" fill="${color}"/>`,
    `<text x="${mid}%" y="${Math.round(height / 2) + 5}" text-anchor="middle" font-family="Segoe UI, system-ui, sans-serif" font-size="15" font-weight="700" fill="#ffffff" stroke="#000000" stroke-opacity="0.35" stroke-width="2" paint-order="stroke">${escape(label)}</text>`,
  ].join('')
}

/** The scene's SVG for the current status. */
export function stripSvg(s: Status, settings: BudgetSettings): string {
  const { from, to, height } = STRIP
  const half = (to - from) / 2
  const five = shown(s, '5h')
  const week = shown(s, '1w')

  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">',
    section(from, half, windowColor(five.used, five.level, settings), `5h  ${pct(five.used)}`, height),
    section(from + half, half, windowColor(week.used, week.level, settings), `1w  ${pct(week.used)}`, height),
    `<line x1="${from + half}%" y1="0" x2="${from + half}%" y2="${height}" stroke="#000000" stroke-opacity="0.4" stroke-width="2"/>`,
    '</svg>',
  ].join('')
}

/** The text for someone who cannot see the strip. */
export function stripAlt(s: Status): string {
  return `Claude usage: 5 hours ${pct(shown(s, '5h').used)}, week ${pct(shown(s, '1w').used)}`
}
