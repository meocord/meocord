---
'meocord': patch
---

Under `useStrictMocks()`, the mocks now keep the files a message is sent with as Discord does, so a test sees an edit lose them. An embed's image and a Components V2 component's media show their upload by CDN URL, the component's with `attachment_id`, and `attachments` lists only the uploads no embed or component shows. An edit that sends `files` or `attachments` keeps only the uploads it lists, and none when it lists no `attachments`, as discord.js then lists the new files alone; component media whose upload an edit removed reads back not found (`loading_state` 3), as does a later edit that points at it again, and media re-sent with its CDN URL reads back without `attachment_id` while its upload stays on the message. A CDN URL from another channel is an image the message doesn't hold.

A component's `attachment://` reaches a kept upload in an edit that lists no attachments, or lists it as `{ id, filename }`; listed as `{ id }` or as discord.js's `Attachment`, it is refused with a 400, as Discord refuses it. So are an attachment the message doesn't have, an upload listed under another filename, and a File component pointed at a URL. A new file of the same name wins, then the newer of two kept uploads that share a name. An embed's `attachment://` reaches a kept upload however it is listed. This applies to an interaction's answers and edits, a mock message's `edit()` and `reply()`, and a channel's `send()`.

In default mode the mocks behave as before, and log one warning where strict mocks differ. A test under strict mocks that points media at `attachment://` of a file it didn't send now fails as it would against Discord.
