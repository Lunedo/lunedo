# Notifications

Lunedo tells you about mentions, tasks, shares, access requests, comments and changes on content you watch, and about events in the administration you take part in. You choose per kind of event whether a notification appears in the app, arrives by e-mail and arrives as a browser push message.

Notifications in the app also work when the instance has no mail server.

## The notification panel

Select the bell in the main navigation, or press **N**, to open the panel. The bell shows the number of unread notifications, up to "99+".

- The tabs **All**, **Mentions** and **Watched** filter the list. **Watched** holds comments, changes, page status and owner changes on content you watch.
- **Unread only** hides what you have read.
- **Show all** opens the full page at `/notifications`. It adds the tab **Requests** with the access requests you can decide, and a **Space** filter.
- **Mark all as read** marks every notification in the list as read.

The list is grouped into **Today**, **Yesterday**, **This week** and **Older**. The arrow keys, **Home** and **End** move between the notifications.

Several events of the same kind about the same item become one notification while they keep coming, for example "Anna Berg and 2 others changed Network plan" with "7 changes". A new notification starts after 30 minutes without a new event, and after 24 hours at the latest. Changes to several pages of one space are shown together, for example "3 pages changed in IT"; **Show all** lists the pages.

### Acting on a notification

- Selecting a notification opens what it is about and marks it as read.
- Pointing at a notification shows its actions; on touch screens they are under **More actions**: **Mark as read** or **Mark as unread**, **Open**, and **Stop watching the page** or **Stop watching the space**. Stopping can be undone in the confirmation.
- **Reply**, among these actions, answers a comment directly from the notification.
- An access request can be approved or declined in the notification.
- A task assigned to you can be marked as **Done** in the notification.

A notification about something you can no longer open is hidden. Notifications are kept for 90 days unless your administrators set another period. A link to a removed notification says "This notification is no longer available".

Changes, comments and other content events never notify you about your own actions. Imported content notifies nobody, also not about mentions in it. When a copy, import or export you started finishes, you are notified.

## Notification settings

Open **Settings › My account › Notifications**, or **Notification settings** on the notifications page.

Under **Events**, each kind of event has three channels: **In the app**, **E-mail** (**Off**, **Immediately** or **In the daily digest**) and **Browser push**. The column **Browser push** appears only when the instance has browser push turned on. Each change saves at once.

Every channel shows where its value comes from: a value you chose, or the default of your organization. **Reset** returns to the inherited value. When your organization locked a choice, it cannot be changed here.

These are the shipped defaults; your organization can change them:

| Event | In the app | E-mail | Browser push |
|---|---|---|---|
| Mentions of me | on | Immediately | on |
| Tasks assigned to me | on | Immediately | on |
| Pages shared with me and answers to my access requests | on | Immediately | on |
| Access requests I can decide | on | Immediately | on |
| Comments and replies on content I watch | on | In the daily digest | off |
| Changes to content I watch | on | Off | off |
| Copies I made | on | Off | off |
| New posts in blogs I follow | on | In the daily digest | off |
| Meeting reminders and notes | on | Off | off |
| Article reviews | on | In the daily digest | off |
| Ownership and page status changes | on | Off | off |

The collapsed section **Administration and security** lists the events of the administration, such as **Sign-in from a new browser**, **API token expires soon**, **Guest access ends soon** or **A backup fails**. They reach only the people responsible for them. **Space administration** and **Imports and exports** are in the app only by default; every other administration event is sent by e-mail immediately.

The same screen holds the [daily digest](#e-mail), [browser push](#browser-push), the [watching](#watching) options and the **Followed blogs**. A blog is followed with **Follow blog** on its page; see [Blog](blog.md).

Organization administrators set the defaults for their organization under **Settings › Organization › Notifications**; see [Notifications for administrators](../admin/notifications.md).

## Watching

You watch pages, blog posts, whiteboards, meeting series and spaces. Watching a space covers everything in it; watching a meeting series covers its meetings and topics. Use **Watch** or **Watch this space** in the menu of the item or space.

Each watched item or space has one of three states:

- **Watching**: changes and comments notify you.
- **Muted**: nothing about the item or space notifies you. **Mute…** asks whether mentions, tasks assigned to you, pages shared with you and access requests you can decide still arrive; this is on by default.
- **Not watching**: you chose not to watch this item, even though you watch its space.

You watch an item automatically when you create, edit or comment on it, or become its owner, unless you chose a state for it before. **Watch what I create, edit or comment on** under **Watching** in the notification settings turns this off.

The state that applies comes from the item, then its meeting series, then its space; the most specific state wins. A state you chose yourself wins over an automatic watch, also when you chose it on the meeting series or the space.

Watching never grants access. While you cannot read an item, nothing about it arrives, and the watch stays, so notifications resume when your access returns.

**Settings › My account › Watched items** lists what you watch and what you mute, in the tabs **Watching** and **Muted**, with the reason (**Automatic**, **Watched by you** or **Muted by you**) and the date. Search by name or space, filter by **Type** and **Space**, select several entries and stop watching, mute or unmute them together.

## E-mail

E-mails are sent when you chose **Immediately** or **In the daily digest** for an event, your account has an e-mail address and the instance has a mail server. Without a mail server, the settings say "E-mail is not set up" and notifications stay in the app.

- **Immediately**: mentions, tasks, shares and access requests are sent about two minutes after the event, so several events about the same item arrive in one mail. Other content events, such as changes and comments, are sent once the notification stopped growing for 30 minutes, or 24 hours after it started, so a burst of changes becomes one mail. Administration events are sent at once.
- **In the daily digest**: one mail per day with everything marked for the digest, grouped by space and item, newest first. It is sent only when something happened. Under **Daily digest**, **Send the digest at** sets the time, 08:00 by default, in the time zone of **Settings › My account › Preferences**. With **Send a daily summary by e-mail** off, these notifications stay in the app.

Before a mail is sent, Lunedo checks again that you still want it by e-mail, still have access and have not read the notification in the app. Mails contain short excerpts only of what you can read at that moment.

Each mail links to the notification, which opens what it is about and marks it as read, and to the notification settings. Its footer has a link that stops these mails without signing in. The link turns off e-mail for that one event, or the daily digest, and asks before it does. Notifications still appear in the app. Mails about security events (such as a sign-in from a new browser or an emergency sign-in) and about storage and backups have no such link.

Mail programs show their own unsubscribe button when a mail carries the `List-Unsubscribe` header. Mails sent through Microsoft Graph carry it only when the instance keeps a copy in the Sent Items of the sender mailbox; see [Microsoft 365](../admin/email/microsoft-365.md).

Mails that belong to something you started, such as a password reset, a change of your e-mail address or an invitation, do not depend on these settings.

## Browser push

Browser push shows notifications on your device while Lunedo is not open. It is off until an instance administrator turns it on. Messages go through the push service of your browser maker; their content is encrypted, but they leave the server. A message holds the text of the event, the title of the item and a link.

1. Open **Settings › My account › Notifications**.
2. Under **Browser push**, select **Turn on for this device**.
3. Allow notifications when the browser asks.

**Devices with browser push** lists your devices, with the current one marked **This device**. **Remove** stops push on a device. You can have up to 20 devices; remove one before adding another. Push on a device ends when you sign out there or the session ends.

Push follows the **Browser push** column of the event list. A notification that is combined into an existing one is not pushed again. Current versions of Firefox, Chrome, Edge and Safari support push. On iPhone and iPad, Safari offers push only to web apps added to the Home Screen.

## Chat channels

Space administrators can post new pages, changes, blog posts, decisions, page status changes and comments of a space to Microsoft Teams, Slack, Discord, Matrix or a webhook. See [Chat channels](../admin/chat-channels.md).
