# Notifications, watching and chat channels

Two parts of notifications are in the public API: watching items and spaces, and chat channels that post to Microsoft Teams, Slack, Discord, Matrix or a generic webhook. [Notifications](../user/notifications.md) describes them for readers, [Chat channels](../admin/chat-channels.md) for administrators. The full reference is at `/api/docs` on your instance.

The notification inbox, its live stream, the unread count and browser push serve the web client. They need a signed-in session and are not part of `/api/docs`. The unsubscribe links in notification e-mails are not part of `/api/docs` either, but they work without signing in; the token in the link identifies what they turn off.

## Watching

| Route | What it does | Permission |
|---|---|---|
| `GET /api/v1/items/{itemId}/watch` | The caller's watch state of a page, blog post, meeting series or meeting topic | read the item |
| `PUT /api/v1/items/{itemId}/watch` | Watches, mutes or stops watching it | read the item |
| `DELETE /api/v1/items/{itemId}/watch` | Removes the caller's own state, so the state of the series or space applies | read the item |
| `GET`, `PUT`, `DELETE /api/v1/spaces/{spaceId}/watch` | The same for a space | read the space |

`PUT` takes:

```json
{ "state": "muted", "keepActionable": true }
```

- `state` is `watching` (changes and comments arrive), `muted` (nothing about it arrives) or `notWatching` (stops watching it even when its space or meeting series is watched).
- `keepActionable`, for `muted`, keeps mentions, assigned tasks, shares with the caller and access requests the caller can decide. It is `true` by default.

`GET` returns `own`, the state the caller set (or `null`, and `automatic: true` when it came from creating, editing or commenting), and `effective`, the state that applies with its `source`: `target`, `series` or `space`. The most specific state wins, except that an automatic watch never overrides a mute further up.

Watching grants nothing. Notifications reach a watcher only while they can read the item; the watch stays, so they resume when access returns.

## Chat channels

| Route | What it does | Permission |
|---|---|---|
| `GET`, `POST /api/v1/spaces/{spaceId}/chat-channels` | Lists and connects the channels of a space | `space.manage` |
| `PATCH`, `DELETE /api/v1/spaces/{spaceId}/chat-channels/{channelId}` | Changes and disconnects a channel | `space.manage` |
| `POST /api/v1/spaces/{spaceId}/chat-channels/test` | Sends a test message before connecting | `space.manage` |
| `POST /api/v1/spaces/{spaceId}/chat-channels/{channelId}/test` | Sends a test message to a connected channel | `space.manage` |
| `GET /api/v1/organizations/{organizationId}/chat-channels` | Lists the channels for the organization announcement | `organization.integrations.view` |
| `POST`, `PATCH`, `DELETE …/chat-channels…`, `…/test` | The same routes for the organization | `organization.integrations.manage` |

A new channel has `kind` (`teams`, `slack`, `discord`, `matrix`, `webhook`), `name` (1 to 80 characters), `events` and `target`:

- Teams, Slack, Discord and generic webhooks: `{ "url": "…" }`, the webhook address the service created.
- Matrix: `{ "homeserver": "…", "roomId": "…", "accessToken": "…" }`. The room can be an alias such as `#ops:example.com`, a matrix.to link or a room ID; it is resolved to the room ID when saving.

Events of a space: `pagePublished` (the first version of a page), `pageChanged` (later versions, combined per page for one hour), `blogPostPublished`, `decisionRecorded`, `pageStatusChanged` and `commentCreated`. The organization has `announcementPublished`.

- Addresses, tokens and the signing secret are stored encrypted and never returned.
- A space has at most 20 channels. Confidential and personal spaces cannot have chat channels (`confidentialSpace`).
- Requests go to public addresses only. Private, loopback and link-local addresses are refused unless the instance allows them (`chatAddressBlocked`).
- A channel whose service keeps failing gets `state: "failing"` with the reason in `failure`, and nothing more is posted until a test message succeeds, the `target` is changed or a new signing secret is created.

Only content every member of the space can read is posted: published, not in the trash or archive, and without a view restriction on it or a page above it.

## Generic webhooks

A generic webhook receives a `POST` with a JSON body:

```json
{
  "id": "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5c01",
  "event": "pagePublished",
  "occurredAt": "2026-10-20T08:15:00.000Z",
  "organizationId": "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a6b",
  "space": { "id": "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a10", "key": "OPS", "name": "Operations" },
  "item": {
    "id": "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5b42",
    "kind": "page",
    "title": "VPN access",
    "url": "https://wiki.example.com/spaces/OPS/pages/1042/vpn-access"
  },
  "actor": { "name": "Lena Vogt" },
  "text": "…"
}
```

`space`, `item` and `actor` are `null` where they do not apply, for example `space` for an organization announcement. `item.url` can be `null` too. `text` is the message as plain lines. A test message arrives with `event` and `X-Lunedo-Event` set to `test`.

with these headers:

| Header | Content |
|---|---|
| `X-Lunedo-Event` | the event, such as `pagePublished` |
| `X-Lunedo-Delivery` | the ID of the delivery, the same as `id` in the body; a retry keeps it |
| `X-Lunedo-Timestamp` | Unix time in seconds when the request was made |
| `X-Lunedo-Signature` | `sha256=` followed by the hexadecimal HMAC-SHA256 of the timestamp, a dot and the raw body, with the signing secret as key |

The signing secret is returned once, as `signingSecret`, when the channel is saved. `PATCH` with `"newSecret": true` creates a new one, also returned once.

To check a request, compute the HMAC over `<X-Lunedo-Timestamp>.<raw body>` and compare it with the header in constant time. Refuse requests whose timestamp is far from your clock, and use `X-Lunedo-Delivery` to drop repeated deliveries.

```sh
EXPECTED="sha256=$(printf '%s.%s' "$TIMESTAMP" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/^.* //')"
[ "$EXPECTED" = "$SIGNATURE" ] && echo valid
```

Deliveries are retried up to five times with growing pauses.
