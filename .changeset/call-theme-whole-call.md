---
'meocord': patch
---

A call keeps the theme it started with for its whole run. When an app on MeoCord's default theme handled a call while another app in the same process, such as a second testing module calling `init({ ready: true })`, claimed the theme read outside calls, `useTheme()` in the waiting call switched to the other app's theme partway through. Now every call of an app that doesn't own the theme read outside calls has its own theme from the start. A bot claims that theme as it starts, so its calls are unchanged.
