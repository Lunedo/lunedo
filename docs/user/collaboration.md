# Editing together

People who edit a page at the same time work on one shared document. Everyone sees the others' changes as they type, and nobody overwrites anyone else. The same applies to blog posts and [whiteboards](whiteboards.md).

## Starting to edit

Readers see the rendered page. People with the editor role choose **Edit** or press E to edit. While others edit the same page, their avatars appear in the editor header ("2 people are editing"), and their cursors and selections appear in the text with their names.

Drawings and draw.io diagrams are edited in a window of their own. While someone edits one, the others see "Anna is editing this drawing" or "Anna is editing this diagram" on the block and keep editing the rest of the page.

Whether readers see each change at once or only after publishing depends on the page's mode; see [Publishing and page status](spaces-and-pages/publishing-and-page-status.md).

## Saving

There is no save button. Lunedo stores the page about a second after you stop typing, and at least every 10 seconds while people keep typing. The indicator in the editor header shows the state:

| Indicator | Meaning |
|---|---|
| Connecting … | The editor is connecting to the server. |
| Editing | You are typing. |
| Saving… | Your changes are on their way to the server. |
| Saved | Your own changes are stored. The indicator waits until the stored state contains them, not only someone else's. |
| Saved to draft | In publish mode: your changes are stored in the draft. Readers see them after publishing. |
| Offline, changes are kept in this tab | The connection is lost. Keep working; nothing is lost while the tab stays open. |
| Not saved | Storing failed. The server tries again. |

When the network returns, the editor reconnects on its own and merges your changes with what others wrote in the meantime. Closing the tab or the browser while changes are not stored yet asks for confirmation first.

Changes written through the API reach open editors at once.

## When editing stops

Some events end editing in an open page. The editor then shows a notice with what happened and what to do:

| Notice | Cause | What to do |
|---|---|---|
| You are signed out | The session ended. | Sign in again. |
| Your session ended | You signed out elsewhere, sessions were ended or the password was changed. Changes made before are saved. | Sign in again. |
| You can no longer edit this page | Your edit permission was removed while the page was open. Changes made before were saved. | Ask a space admin for the editor role. |
| You can read this page but not edit it | You have no edit permission. | Ask a space admin for the editor role. |
| The page cannot be edited | It was moved or you lost access. | Reload to see where it is now. |
| Too many open editors | The page is open in many tabs. | Close some tabs and reload. |
| Your last change could not be saved | The change did not match the allowed page content. Nothing of it was stored. | Reload; changes saved before stay. |
| Editing paused | Too many changes arrived in a short time. | Wait a moment, then reload. |
| Editing is not available at this address | The page was opened under another address than the instance address. | Open the page through the instance address. |
| Editing needs a signed-in session | API tokens cannot edit together with others. | Sign in in the browser. |

When the server cannot check your access for a moment, for example while its database is unreachable, it closes the connection and the editor shows "Offline, changes are kept in this tab" and reconnects on its own, first after a second and then at growing intervals up to 30 seconds.

## Maintenance mode

While an administrator has turned on [maintenance mode](../admin/maintenance-mode.md), pages open read-only with the notice "Read-only during maintenance". You can read the page. Editing works again as soon as maintenance ends, without reloading.
