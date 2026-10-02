---
'meocord': minor
---

A presenter can draw its views, such as with a canvas library, and attach what it draws:

- **`ResponseView.files`** carries files, an `AttachmentBuilder` or `{ name, data }`, which MeoCord sends with the view and shows for you. In an embed, the first image is the embed's image. In a Components V2 container, images go in galleries of up to 10 below the text, and other files as file components. A file the view's own `components` show by `attachment://<name>` is not shown again.
- **`ResponseView.image` and `thumbnail`** name one of the files, or a URL, to use as the embed's image or thumbnail, or the container's leading image and the text's thumbnail.
- **`loading()` and `error()` may return a promise.** A slow drawing never misses Discord's three seconds. The loading view is drawn after `@Defer` acknowledges the click. An interaction not yet acknowledged is acknowledged privately before a drawn error view, which then replaces the acknowledgement; should that drawing fail, MeoCord's own view answers instead. Discord refusing the acknowledgement, as for an interaction past its three seconds, is logged once as the refused send, never as the presenter failing, and an interaction Discord no longer knows is not answered again.
- **A view past Discord's limits is sent without its files**, with a warning: more than 10 attachments on the message, counting those it keeps, or a file over the interaction's attachment size limit, 20 MiB without one. A send Discord refuses as too large, as one with a file whose size could not be checked first, is sent again without its files. The user still gets the answer.
- **A presenter's optional `messageError()` draws a message command's error replies**: the usage reply, a guard's or validation's reason, a `UserError`'s message, and the DMs `dmOnError` and `dmOnCooldown` send, as embeds with its files. It receives a `MessageResponseContext`, with the `message` in place of an interaction. A presenter without it, such as the one a new app is generated with, leaves those replies plain text, exactly as before. Should `messageError()` throw, reject or return a view an embed cannot hold, the reply or DM is sent as that plain text, and the failure is logged as the call's fault, so a testing module's `dispatch` rejects with it.

Edits that add a view's files keep the message's own attachments, and a drawn loading view's files leave when the lock does.
