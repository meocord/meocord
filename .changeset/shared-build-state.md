---
'meocord': patch
---

When MeoCord's ES module and CommonJS builds load in one process, as when an ES module bot uses a CommonJS package that requires `meocord/common`, the two builds now keep one copy of the state they both use. Before, each build kept its own, so code reached through the other build:

- read MeoCord's default theme outside a call, from `useTheme()` and the deprecated `Theme` statics, instead of the started app's;
- coloured an answer outside a call, as in a collector's callback, with the default theme;
- ran a handler without the theme of a `@UseTheme` imported from the other build;
- dropped a colour one build's `Theme` static set when the other set another;
- left the issues of a usage error the other build made in English in `translateError`;
- printed a warn-once warning, and the warning about an unknown `MEOCORD_LOG_LEVEL`, once from each build;
- printed a value `hideInLogs` was given through the other build;
- under Bun, left a refusal at startup unreported once both builds had refused something, since each build's listener left the rejection to the other's.

Nothing to change in your code.
