# Real-time collaboration

People who edit a page at the same time work on one shared document. Lunedo uses [Yjs](https://yjs.dev) for the document and [Hocuspocus](https://tiptap.dev/docs/hocuspocus) for the server (`apps/collab`). The collaboration server runs in the `collab` role of the image (part of `all`). How operators route `/collab` through a reverse proxy or a load balancer is in [reverse-proxy.md](../admin/reverse-proxy.md); how it looks to people who edit is in [collaboration.md](../user/collaboration.md).

The limits and close codes below are defined in `apps/collab/src/limits.ts`.

## Connections

The web client connects to `wss://<instance address>/collab` with the document name `page:<page ID>` for pages and blog posts, and `whiteboard:<item ID>` for whiteboards. In a single container, the API forwards WebSocket connections on `/collab` to the local collaboration server (`LUNEDO_COLLAB_UPSTREAM` changes the target); in development, the Vite dev server forwards them.

A connection is accepted only when:

- the client address stays below 300 connections per minute,
- it carries no `Authorization` header (API tokens never open collaboration connections),
- its `Origin` is the instance address,
- it carries the session cookie of a fully signed-in person, and that person stays below 60 connections per minute,
- the document name names an existing item of the matching kind that the person may view, and
- the person may edit it.

A refused connection receives one of these reasons, which the client shows as a problem in the editor: `tooManyConnections`, `tokenNotAllowed`, `originNotAllowed`, `notSignedIn`, `pageNotFound`, `noEditPermission`. When the check itself fails, for example because the database is unreachable, the reason is `permission-denied`.

## Close codes

An open connection is closed with one of these codes:

| Code | Reason | When |
|---|---|---|
| 4400 | `updateRejected` | An update failed validation, see [Validation](#validation). |
| 4401 | `sessionEnded` | The person's session ended. |
| 4403 | `permissionRevoked` | The person lost edit permission. |
| 4429 | `tooManyMessages` | The connection sent more than about 100 messages per second (burst 400). |
| 4503 | `unavailable` | Checking the connection again failed, for example during a database outage. |

The first four end editing in the tab; the editor shows what happened and what to do. `unavailable` is temporary: the client keeps its changes, shows the editor as offline and reattaches after 1, 2, 5, 10 and then every 30 seconds until the connection is synced again.

## Validation

Every update is checked before it reaches the document: the update is applied to a validated copy, and the result must pass the editor schema (see [editor-schema.md](editor-schema.md)). For whiteboards, only the elements an update changes are checked against the scene rules, while the size of the whole scene is kept up to date. Updates above 2 MiB, presence updates above 64 KiB and updates that use the Yjs client of another account are refused as well; WebSocket frames above 8 MiB are not read at all.

A refused update closes the connection with `updateRejected`, nothing of it is stored, and the audit log records `page.updateRejected` (or `whiteboard.updateRejected`) with the reason and the kinds of problems, never the content.

The server records which Yjs client belongs to which account (`collaboration_clients`), so changes can be attributed later.

## Saving

The collaboration server stores a document about 800 ms after the last change and at least every 10 seconds while people keep typing. For pages, the Yjs state and the JSON snapshot that readers, the API and search use are stored in one transaction that holds a lock on the page's row. Before storing, the node merges the stored state into its own, so two nodes storing the same page never lose an update.

After storing, the server sends the stateless message `{"type":"saved","revision":<n>,"stateVector":"<base64>"}` to everyone editing the document. The state vector describes what was stored, so a client shows "Saved" only when its own changes are included. When storing fails, clients receive `{"type":"saveFailed"}`, the editor shows "Not saved", and the server tries again after 5 seconds.

Changes written through the API reach open editors at once: the API raises a PostgreSQL notification, and every collaboration node that has the document open merges the stored state.

When the browser loses its network connection, the editor shows "Offline, changes are kept in this tab" at once and disconnects. When the connection returns, it reconnects and the changes are merged with what others wrote meanwhile. Closing the tab with unsaved changes asks for confirmation.

## Permissions

Permission changes take effect on open connections at once, also on other nodes. Changes of access or of the page tree in a space recheck the connections in that space; changes of groups, accounts, organizations and role assignments recheck the connections they can affect. A person who loses edit permission is disconnected with `permissionRevoked`. An ended session (sign-out, ended sessions, a changed or reset password) closes that person's connections with `sessionEnded`, without rechecking anyone else. Every 30 seconds the server checks all open connections again, including their sessions.

## Maintenance mode

While maintenance mode is on, every connection is read-only: the server accepts connections but ignores changes. When a connection opens and whenever the mode changes, the server sends `{"type":"maintenance","enabled":<true|false>,"message":"<text>"}`, where the message is the administrators' note and may be empty. The editor then shows "Read-only during maintenance"; when the mode ends, it reattaches and editing works again without a reload. See [maintenance-mode.md](../admin/maintenance-mode.md).

## Several nodes

A single collaboration node needs no Redis. With more than one, set `LUNEDO_REDIS_URL` on every collaboration node: updates, presence and save messages travel between the nodes through Redis, so people on different nodes see each other's changes immediately. Without Redis, nodes still converge through the database, but only after a document is stored. Any Redis-compatible server works, for example Redis or Valkey; the development environment uses Valkey.

## Whiteboards

Whiteboards use the same server with the document name `whiteboard:<item ID>`. Their scene format in Yjs and the rules for elements are described in [editor-schema.md](editor-schema.md#whiteboard-scenes); the API for scenes, images and versions is in [diagrams-and-whiteboards.md](../api/diagrams-and-whiteboards.md).
