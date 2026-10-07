# Changelog

All notable changes to this project are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-10-07

### Added
- Every step of a turn shows while it runs; once the turn ends, its tool calls and the text between them fold into one summary line above the final answer (`● 3 bash · 2 edits · 1 read · 1 mcp(lark) · 2 notes`).
- Per-turn ` ▸ expand ` (green) / ` ▾ fold ` (red) button. After a click the clicked line is scrolled to the top of the screen, since the transcript sticks to its end and unfolding rows would push it away.
- Failed tool calls are counted in red in the summary line (`· 1 failed`).
- Options `foldFailedTurns` (default on) and `hideNotes` (default on).
- A turn interrupted with Esc stays expanded.
