# usage-pacer

A Claude Code mod (desktop app and terminal) that keeps Claude usage on a **linear pace**
toward a configurable **cap**, for the 5-hour window (**5h**) and the weekly one (**1w**),
so you don't run out of limits before the reset.

Claude's limits reset on a clock: a 5-hour window and a weekly one. Looking at a single
percentage doesn't tell you whether you are using Claude too fast. This mod does: it compares
the usage so far with where a steady, even pace would be at this moment, shows both windows
at a glance, and colors them green while you are on pace and yellow, orange and red as you
run ahead of it, so you can slow down before you reach the cap.

```
5h 12%         ● on pace         reset 15:30 (2h30m)      1w 41%      ● slightly over      reset Sat 21 Nov 01:00 (3d12h)
██████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░      ████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
```

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
  - **Title bar**: the session title becomes `<title> │ 🔴 5h 92% · 🟢 1w 50%`, with emoji
    dots nearest the chosen colors. It updates at start and on each prompt sent (it is the
    session title, which the SessionStart/UserPromptSubmit hooks can set); the original
    title stays in front. The badge goes at the end because the session list cuts long
    titles on the right: it mostly stays out of the list and the titles stay lined up, while
    the title bar shows it whole. The title is one text, so a mod cannot show it in the
    title bar alone; switch it off with `/budget title off` if you don't want it in the list.
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

## How it works

1. **It reads your limits.** Claude Code reports the state of each rate-limit window: how
   much of it is used (`percentUsed`) and when it resets (`resetsAt`). The mod reads them
   once at the start of a session and again whenever the engine reports that a window moved
   by a whole point. The last reading is kept, so it is still there when you open the next
   session. These windows exist only with a Claude subscription, after the first model reply.
2. **It works out where you should be.** A window of length `L` that resets at time `R`
   started at `R − L` (`L` is 5 hours for 5h and 7 days for 1w). At time `t`, the share
   elapsed is `(t − (R − L)) / L`, and the **expected usage** is that share × your cap. So
   with a 90% cap, halfway through the week you are expected to have used 45%.
3. **It compares.** The distance is `used − expected`, in percentage points. At or under the
   budget you are **on pace**. Over it, the distance is cut into thirds of the "far ahead"
   threshold (default 15 points): under 5 points is *slightly over*, 5 to 10 is *over
   pace*, 10 to 15 is *well over*, from 15 on *far over*. Reaching the cap itself is *at
   cap*. Both windows are judged the same way, each against its own clock.
4. **It colors.** In **pace** mode each level has its own color: green on pace, then
   yellow, orange and red. In **ranges** mode the color depends only on the usage reached
   (for example green below 50%, red from 85%), whatever the pace. You pick the colors and
   the ranges.
5. **It shows it where you choose.** Each place can be switched on or off:
   - the **bar above the prompt**: a colored bar per window with its usage on the left, the
     pace in the middle and the reset time on the right, in your local time zone;
   - the **title bar**: a `title │ 🔴 5h 92% · 🟢 1w 50%` badge at the end of the session title,
     refreshed at the start of the session and on every prompt you send;
   - the optional **strip below the title**, drawn as the window backdrop with no glass, so
     the app's own colors never change;
   - the **status line**.
6. **It warns you.** A toast appears when you reach the cap or go far ahead of pace, and a
   reminder when you send a prompt while you are still there, at most every ten minutes.

A window with no data shows as 0% (for instance before the first reply, or when no 5-hour
window is active). `/budget simulate` fakes a reading so you can see every color and alert.
Everything you set is stored by the mod and survives across sessions.

## Settings

There are two places to configure the mod, and they work together:

- **The plugin's settings page** in the app (or the plugin's configuration in the terminal):
  the cap, the far-ahead threshold, a switch for each place the signal shows (session title,
  strip, bar above the prompt, status line), the color mode (pace or ranges) and one color
  for each pace level, picked from a list.
- **The `/budget` panel**, which has all of that and also the **usage ranges** (add, move,
  recolor, remove) and any custom `#rrggbb` color, through `/budget range` and `/budget color`.

A value you set on the settings page applies as soon as you change it. What you set later in
the panel or with `/budget` is kept until you change that same option on the settings page
again; the settings page does not show values changed from the panel, so treat the panel as
the more detailed view and the settings page as the quick one.

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
