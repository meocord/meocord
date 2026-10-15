---
'meocord': patch
---

A process that loads both the ES module and the CommonJS build of meocord, as an app and a package it uses may, has one pair of signal listeners and one shutdown. A Ctrl+C or SIGTERM stops the apps either build started and exits once, where each build used to run a shutdown of its own and exit when its own apps had closed.
