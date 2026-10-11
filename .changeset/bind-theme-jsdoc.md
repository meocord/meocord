---
'meocord': patch
---

`bindTheme`'s documentation now says that a bound function runs in the whole theme of the call that bound it, the server's and user's themes included. Every later call, such as another member's click on a collector, is answered in the starting member's theme. Its example comment said "the handler's theme", which left that out. Nothing about the behaviour changes.
