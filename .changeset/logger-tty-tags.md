---
'meocord': patch
---

`Logger` writes colour only where it shows, and tags `info()` and `verbose()` lines as what they are.

- An object or other non-string argument was always printed with colour codes, even into a file or a log collector, where they appear as raw escape sequences. It now follows the rest of the line: in colour on a terminal, and plain where the output is not one. Set `FORCE_COLOR=1` to keep colour where your log viewer shows it.
- `logger.info()` and `logger.verbose()` lines were tagged `[LOG]`. They are now tagged `[INFO]` and `[VERBOSE]`. They still print at the `log` level, so a filter on `[LOG]` no longer matches them.
