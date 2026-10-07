# claude-code-dense

**A dense Claude Code transcript.** While a turn runs you see every step. Once it ends, its
tool calls and the text between them fold into one line above the final answer:

```text
● 3 bash · 2 edits · 1 read · 1 mcp(lark) · 2 notes  ▸ expand
```

- **` ▸ expand `** (green) opens that one turn; **` ▾ fold `** (red) closes it again. After a
  click the clicked line is scrolled to the top of the screen, so it doesn't jump out of view.
- Failed calls are counted in red (`· 1 failed`).
- A turn you interrupt (Esc) stays expanded.

## Requirements

- Claude Code with mods (plugins of function hooks). Tested on 2.1.291.
- Mods are behind a rollout switch Anthropic controls. While it is off, the plugin installs
  but does not load.
- Tested in the fullscreen view. In the normal view, rows already printed to the terminal's
  scrollback may not redraw.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install dense --marketplace jinhuang712/claude-code-dense
```

Answer `y` to add the marketplace, then pick a scope (user is the first one offered).

From a local checkout instead:

```
claude plugin marketplace add ~/dev/claude-code/claude-code-dense
claude plugin install dense@claude-code-dense
```

Then run `/reload-plugins` in an open session. A plugin installed from a folder is read from
that folder: after an edit, `/reload-plugins` picks it up without reinstalling.

## Options

Set them with `/plugin configure dense@claude-code-dense` or `claude plugin configure dense`.

| Option | Default | What it does |
|---|---|---|
| `foldFailedTurns` | on | Fold turns with a failed tool call too. Off: such turns stay expanded. |
| `hideNotes` | on | Hide the text between tool calls. Off: only tool calls fold. |

## Limits

- Thinking blocks have no render hook, so they can't be folded.
- Turns from before a `--resume` aren't folded: the plugin only knows the turns it watched.
- Folded rows stay folded in the ctrl+o transcript (tool rows don't say which view draws
  them); use ` ▸ expand `.
- A bash command that exits non-zero without output isn't reported as an error by Claude
  Code, so it isn't counted as failed.

## Develop

```
claude plugin validate .
claude plugin test .
tsc -p .
```

`tsc` and the editor read Claude Code's types from `.claude-plugin/types/` (git-ignored).
Claude Code writes them there when it loads the plugin from `--plugin-dir` or a hot-reload
mods folder; they change with each Claude Code build.

## License

[MIT](LICENSE)
