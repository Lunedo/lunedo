# Real-time collaboration

People who edit a page at the same time work on one shared document. Lunedo uses [Yjs](https://yjs.dev) for the document and [Hocuspocus](https://tiptap.dev/docs/hocuspocus) for the server. The collaboration server runs in the `collab` role of the image (part of `all`).

## Connections

The web client connects to `wss://<instance address>/collab` with the document name `page:<page ID>` for pages and blog posts, and `whiteboard:<item ID>` for whiteboards ([whiteboards.md](whiteboards.md)).

- In a single container (`all`), the API forwards WebSocket connections on `/collab` to the local collaboration server, so only the API port needs to be published. `LUNEDO_COLLAB_UPSTREAM` changes where the API forwards to.
- With separate roles behind a load balancer, route `/collab` to the collaboration nodes, with WebSocket support and idle timeouts above 60 seconds. Keep the `Host`, `Cookie` and `Origin` headers unchanged.

A connection is accepted only when:

- it carries the session cookie of a signed-in person and no `Authorization` header (API tokens never open collaboration connections),
- its `Origin` is the instance address,
- the person may edit the page, and
- the person and the client address stay below the connection rate limits (60 per account and 300 per address and minute).

Refused connections receive one of these reasons: `notSignedIn`, `tokenNotAllowed`, `originNotAllowed`, `pageNotFound`, `noEditPermission`, `tooManyConnections`.

## Validation

Every update is checked before it reaches the document: the update is applied to a validated copy, and the result must pass the editor schema (see [editor-schema.md](editor-schema.md)). For whiteboards, only the elements an update changes are checked against the scene rules described there, while the size of the whole scene is kept up to date. Updates above 2 MiB, presence updates above 64 KiB and updates that use the Yjs client of another account are refused as well. A refused update closes the page's connection with the reason `updateRejected`, nothing of it is stored, and the audit log records `page.updateRejected` (or `whiteboard.updateRejected`) with the reason and the kinds of problems, never the content. A connection that sends more than about 100 messages per second is closed with `tooManyMessages`.

The server records which Yjs client belongs to which account, so changes can be attributed later.

## Saving

The collaboration server stores a page about 800 ms after the last change and at least every 10 seconds while people keep typing. The Yjs state and the JSON snapshot that readers, the API and search use are stored in one transaction. Before storing, a node merges the stored state into its own, so two nodes storing the same page never lose an update.

After storing, the server sends the stateless message `{"type":"saved","revision":<n>,"stateVector":"<base64>"}` to everyone editing the page. The state vector describes what was stored, so a client shows "Saved" only when its own changes are included. When storing fails, clients receive `{"type":"saveFailed"}` and the server tries again.

Changes written through the API reach open editors at once.

When the browser loses its network connection, the editor shows "Offline" at once and keeps the changes in the tab. When the connection returns, it reconnects and the changes are merged with what others wrote meanwhile. Closing the tab with unsaved changes asks for confirmation.

## Permissions

Permission changes take effect on open connections at once, also on other nodes. A person who loses edit permission is disconnected with the reason `permissionRevoked`; an ended session (sign-out, ended sessions, a changed or reset password) closes that person's connections at once with `sessionEnded`, without rechecking anyone else. Every 30 seconds the server checks all open connections again.

## Several nodes

A single collaboration node needs no Redis. With more than one, set `LUNEDO_REDIS_URL` on every collaboration node: updates, presence and save messages travel between the nodes through Redis, so people on different nodes see each other's changes immediately. Without Redis, nodes still converge through the database, but only after a page is stored.

Any Redis-compatible server works, for example Redis or Valkey.
