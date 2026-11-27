---
'meocord': patch
---

`@Defer`'s lock no longer deletes a Components V2 message's uploaded files when the presenter's loading view has files of its own, and the restore no longer leaves its images broken. The same holds for an error view with files added to a private component message, and for an answer that replaces a loading view with files. Discord lists a V2 message's uploads only in its components' media, and an embed's images only in the embed, so MeoCord kept none of them. Such an edit now keeps every upload the message shows or holds, its media stay attachment-backed, and the limit of 10 files counts them. A loading or error view whose file is named like one the message keeps is sent without its files, with a warning, as Discord would show the view's file in its place. Of two kept files sharing a name, Discord shows the newer one wherever the name is used; a File component showing the older one can't be kept, and MeoCord warns, naming it.
