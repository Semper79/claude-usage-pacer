# usage-pacer

A Claude Code mod (desktop app and terminal) that keeps Claude usage on a **linear pace**
toward a configurable **cap**, for the 5-hour window (**5h**) and the weekly one (**1w**),
so you don't run out of limits before the reset.

## Install

In a Claude Code terminal session:

```
/plugin install usage-pacer --marketplace semper79/claude-usage-pacer
```

Answer `y` to add the marketplace, then pick a scope. From a shell:

```
claude plugin install usage-pacer --marketplace semper79/claude-usage-pacer
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then
**Plugins**, **Add marketplace** with `semper79/claude-usage-pacer`, then **Add plugin**.

Requires a Claude Code version with mods (function hooks), built and tested on 2.1.325.
The mod API is early access and may change between releases. The rate-limit windows exist
only with a Claude subscription, after at least one model reply.

The plugin is named `usage-pacer`: names starting with `claude-` are reserved for Anthropic's
own plugins, so the repository carries that name and the plugin does not.

## What it does

- **Data**: the status line's rate-limit windows, `five_hour` and `seven_day`
  (`percentUsed`, `resetsAt`), read at start with `$.session.usage()` and pushed by the
  engine with the `session.measure` event. A window with no data shows as 0%; the last known
  reading carries over to the next session (marked "last known reading").
- **Expected budget** = elapsed share of the window × cap (default 90%), for 5h and 1w.
- **Colors**, all chosen by you, in one of two modes:
  - **pace** (default): on pace green; ahead of pace yellow → orange, stronger the further
    ahead (at 1/3, 2/3 and 3/3 of the "far ahead" threshold, default +15 points); at the
    cap red;
  - **ranges**: by usage alone, e.g. 0–50% green, 50–70% yellow, 70–85% orange, 85%+ red.
    Ranges can be added, moved, recolored and removed.
- **Where the signal shows** (each one on/off):
  - **Title bar**: the session title becomes `🔴 5h 92% · 🟢 1w 50% │ <title>`, with emoji
    dots nearest the chosen colors. It updates at start and on each prompt sent (it is the
    session title, which the SessionStart/UserPromptSubmit hooks can set); the original
    title stays after the badge.
  - **Strip below the title** (off by default, desktop/mobile): two colored 5h | 1w
    sections, drawn as the window backdrop with no glass, so the app's colors never change.
  - **Bar above the prompt**, kept minimal: 5h and 1w side by side, each a full-width colored
    bar. The label row carries the usage on the left, the pace in the middle (`● on pace`,
    green when on pace, then yellow, orange and red as usage runs ahead of the linear
    budget) and the reset in local time on the right, with the time left in brackets:
    `reset 15:30 (2h30m)` for 5h, `reset Sat 21 Nov 01:00 (3d12h)` for 1w. The pace is
    centered in the space the other two texts leave free.
  - **Status line**: `5h 92% · 1w 50% / budget 45% · reset 3d 12h`.
- **Alerts**: a toast when the cap is reached or usage runs far ahead of pace, and a
  reminder when you send a prompt (at most every 10 minutes) while it stays there.

## The `/budget` command

`/budget` opens the panel: cap, threshold, a switch per position, and the colors, picked
from dropdowns (the color mode, each range's start % and color, or each pace level's color).
Everything is also a command:

| Command | Effect |
| --- | --- |
| `/budget status` | the status, with days to the reset |
| `/budget 85` or `/budget cap 85` | cap at 85% |
| `/budget threshold 10` | "far ahead" from +10 points |
| `/budget positions` | where the signal shows |
| `/budget title on\|off` | badge in the title bar (default on) |
| `/budget strip on\|off` | strip below the title (default off) |
| `/budget promptbar on\|off` | bar above the prompt (default on) |
| `/budget statusline on\|off` | status line entry (default on) |
| `/budget mode pace\|ranges` | color by pace or by usage ranges |
| `/budget ranges` | the usage ranges |
| `/budget range 70 orange` | the range from 70% is orange (added if new) |
| `/budget range remove 70` | removes the range from 70% |
| `/budget ranges default` | default ranges |
| `/budget colors` | the pace colors |
| `/budget color cap red` | a pace color: `ok`, `over1`..`over4`, `cap`; `#rrggbb`, `#rgb` or a name (green, light-green, teal, sky, blue, purple, pink, yellow, amber, orange, dark-orange, red, dark-red, gray) |
| `/budget colors default` | default pace colors |
| `/budget default` | everything back to the defaults |
| `/budget simulate 95 70` / `/budget simulate off` | fakes 1w at 95% and 5h at 70% to try colors and alerts |

Settings persist across sessions (the mod's store), with no code to touch.

## Develop and test

Load a working copy without installing it: add its folder to `CLAUDE_CODE_PLUGIN_DIRS` in the
`env` block of your Claude Code `settings.json`, or start a session with
`claude --plugin-dir <folder>`. Run the tests with:

```
claude plugin test <folder>
```

## License

[MIT](LICENSE) © 2026 Semper79
