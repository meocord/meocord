---
'meocord': patch
---

When the CLI runs on Bun, as a project created with `--use-bun` does, a `.env` value Bun expanded, such as `URL=http://$HOST:3000`, is no longer passed to the bot as if the shell had set it. The bot reads its `.env` files itself, so under `meocord start --dev` an edit to such a line now reaches the bot on its next restart; before, the bot kept the value from when the CLI started. A variable the shell sets to another value is still passed on. A production bot on Bun also now names such an expanded development value in its warning about another mode's `.env` values.
