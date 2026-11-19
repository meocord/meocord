---
'meocord': patch
---

Two component calls holding one message with `@Defer`'s lock no longer leave it locked wrongly when one finishes as the other locks it. Until now, depending on which edit reached Discord last, the call still running could have its control enabled again with no loading view, letting the user click it twice, or the call that had finished could keep its control disabled until the other one ended. Edits to a locked message now go out one after another, each drawn as the lock stands when it is sent, so the message always shows the calls still holding it. While several calls hold a message, it shows the loading view of the call that locked it last, also once another call releases it.
