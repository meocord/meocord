---
'meocord': patch
---

`Logger` colours each line by the stream it goes to, and prints small objects on one line, as `console.log` does.

- Warnings and errors go to stderr and the other levels to stdout, but colour followed stdout alone, so `node dist/main.js 2>>errors.log` from a terminal wrote colour codes into the file. Each line now takes colour only where its own stream is a terminal, or `FORCE_COLOR` asks for it.
- An object argument printed one property per line, as in 4.0, where `console.log` keeps a small object on one line. It now prints as `console.log` does, still four levels deep, so a log of `{ id, name }` takes one line.
