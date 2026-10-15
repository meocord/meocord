---
'meocord': patch
---

Two message handlers whose patterns differ only in which params are optional, such as `'a {x} {y?}'` and `'a {x:int?} {y:int?}'`, can take the same messages, and which one ran depended on the controllers' order. They now rank by their params, a required param ahead of an optional one in the same position, so the same handler answers whatever the order, and startup warns, naming both and the one that answers. The next major version (5.0) stops the bot at startup for such a pair, as it already does for two patterns that match exactly the same messages.
