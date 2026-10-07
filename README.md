# ✻ token-meter for Claude Code

A small Claude Code mod that adds a live token meter above the prompt and compacts the conversation on its own once the context passes **150k tokens**. It never cuts off an answer: if the threshold is reached mid-turn, the compaction waits until the turn ends.

```
 ✻ Context ━━━━━━━━━━━━──────── 87.3k / 150k · 44% of 200k   ↑ 1.2M  ↓ 45k  ⟲ 3.4M cached  ·  $1.23
   ⎿ Auto-compact queued · runs when this turn ends
```

- **Context bar** shows the current context against the 150k threshold. It is orange, turns amber at 70% and red at 90%. It uses your Claude Code theme colors.
- **↑ / ↓ / ⟲** show input, output and cache-read tokens for the session, subagents included. **$** is the session cost.
- **Auto-compact** queues at 150k and runs `/compact` once the current answer is finished.

## Install

### Windows: one click

Download and run [`install.bat`](install.bat). It adds this repo as a marketplace and installs the mod for your user.

### Any OS: from a terminal

```bash
claude plugin marketplace add HeagBoKaT/claude-token
```

```bash
claude plugin install token-meter@claude-token --scope user
```

Or, inside a Claude Code terminal session:

```
/plugin install token-meter --marketplace HeagBoKaT/claude-token
```

Restart Claude Code afterwards. The meter shows in the terminal and in the desktop app's Code tab.

## Uninstall

Run [`uninstall.bat`](uninstall.bat), or:

```bash
claude plugin uninstall token-meter@claude-token
```

## Configure

The threshold is `COMPACT_AT` at the top of [`hooks/register.tsx`](hooks/register.tsx).

## Requirements

A Claude Code version with function-hook plugins (mods). Try the latest release if the meter does not show.
