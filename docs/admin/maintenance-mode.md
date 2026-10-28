# Maintenance mode

Maintenance mode makes the instance read-only while you work on it, for example during a data migration or before an update that needs manual steps. Everyone sees a message, and nobody is signed out.

## Switching it on and off

Switching needs the instance area *operations* at the level manage.

In the interface:

1. Open **Settings › Instance › Operations › Maintenance mode**.
2. Optionally enter a **Message**, for example when the maintenance ends. It has at most 500 characters.
3. Optionally tick **Pause signing in for everyone except instance administrators**.
4. Select **Switch on maintenance mode**.

To change the message or the sign-in setting while it is on, use **Save message and sign-in setting**. To end it, use **Switch off maintenance mode**.

From a script, in the installation directory of the setup script:

```sh
./lunedo maintenance on --message "Update until 18:00" --block-sign-in
./lunedo maintenance status
./lunedo maintenance off
```

`./lunedo` is the command the setup script installs. With your own Compose file, run the same command in the container, for example `docker compose exec lunedo lunedo maintenance on`. Scripts can also use `PUT /api/v1/instance/maintenance` (see `/api/docs`).

## What happens while it is on

- A banner with the message shows on every page of the app and on the sign-in page. Knowledge base portals show a note that the help is in maintenance, with the message.
- Changes are refused for everyone, also for instance administrators. The API answers `503` with the problem `maintenanceMode`, the message in `maintenanceMessage` and `Retry-After: 60`.
- Reading and search keep working, and so do exports of single pages that are sent at once (`GET /api/v1/pages/{pageId}/export`). Exports that run in the background are refused.
- The collaboration server opens documents read-only, and open editors switch to read-only with a notice. When maintenance ends, they become editable again without reloading.

### What still works

- Signing in, the second factor, passkeys, sign-in through identity providers, signing out and confirming one's identity again.
- SCIM requests of identity providers.
- Opening a share link.
- Switching maintenance mode itself, starting a backup and starting a test restore.
- Every action that removes access: ending sessions, revoking API tokens and SCIM tokens, deactivating accounts, service accounts and identity providers, removing share links, members of organizations and groups, group managers, space permissions, role assignments and break-glass access, and deactivating or removing portal accounts and portal invitations.

Every other change is refused.

### Background jobs

Jobs that change content wait in their queues and run when maintenance ends: imports, copies, exports, versions of live pages, scheduled blog publication, cleanup of removed content, trash retention, template file adoption, image versions, removal of orphaned files, removal of meeting template sections, rendering of portal articles, key rotation and the pruning of removed articles. A job that was already running finishes.

Everything else keeps running, among it backups, mail, push and chat delivery, notifications, search indexing, storage checks, retention of the audit log and of notifications, identity provider synchronization, and the expiry of organizations, guest memberships and API tokens. Access is therefore still removed when someone leaves.

### Pausing sign-in

With **Pause signing in for everyone except instance administrators** (`--block-sign-in`), only instance administrators can sign in. Others get the problem `signInPaused`. People who are signed in stay signed in and can read.

## Where it shows

Switching on, changing the message and switching off are recorded in the [audit log](audit-log.md), for example as **Maintenance mode switched on**. The [system status page](monitoring/system-status.md#maintenance) warns while it is on, and the metric `lunedo_maintenance_mode` is 1 (see [monitoring.md](monitoring.md)).
