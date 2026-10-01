---
'meocord': patch
---

The spec `meocord generate controller mentionable-select-menu` writes now selects a user and a role, and checks what the handler answers: "Selected 1 user(s) and 1 role(s)." Before, it checked only that the handler updated the message, so it passed whatever the handler said.
