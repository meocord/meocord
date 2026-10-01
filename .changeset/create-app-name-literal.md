---
'meocord': patch
---

`meocord create` writes any app name into `meocord.config.ts` as a valid string. A name with an apostrophe, such as `"Bob's Bot"`, or one ending in a backslash made a config that failed to parse, so the new app never built. A backslash elsewhere changed the name silently: `Back\slash` was read as `Backslash`. The name is now quoted and escaped the way the app's own Prettier config writes it, so the file also passes the app's lint unchanged. An app created with such a name before this needs its `appName` fixed by hand.
