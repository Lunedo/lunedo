# Instance address

The instance address is the address people open, for example `https://wiki.example.com`. Lunedo uses it in links in e-mails and notifications, for passkeys, for the origin check of the collaboration WebSocket and for CSRF protection. It is an `http://` or `https://` origin without a path. Serve it over HTTPS through a [reverse proxy](reverse-proxy.md#tls-and-the-instance-address); signing in needs HTTPS.

The address comes from one of two places:

| Source | How it is set | How it is changed |
|---|---|---|
| `LUNEDO_INSTANCE_URL` | In the configuration, for example in `.env`. Lunedo stores it at every start. | Change the variable and restart Lunedo. The instance settings and the setup assistant show it read-only. |
| The instance setting | In the instance step of the [setup assistant](setup-assistant.md), or in the instance settings. | Under **Settings › Instance › General**, field **Address**, as described below. |

When `LUNEDO_INSTANCE_URL` is set, it always wins over the stored address, also after a restore.

## Change the address

Make sure Lunedo is reachable at the new address first: DNS, the certificate and the reverse proxy.

1. Open **Settings › Instance › General**.
2. Enter the new address in **Address** and choose **Save**.
3. Read the effects the dialog lists, then choose **Move to new address**.

The change has these effects:

- All open sessions end, also yours. The browser opens the new address, where you sign in again.
- Passkeys registered under the old address stop working. Everyone signs in with another method and adds a new passkey.
- Redirect and reply URLs at every identity provider must be updated to the new address, or sign-in through them fails. See [Identity providers](identity-providers.md).

A browser tab still open under the old address shows that Lunedo has moved, with a link to the new address, instead of failing. The change is recorded in the audit log as "Instance address changed" (`instance.addressChanged`); see [Audit log](audit-log.md).

When the address comes from `LUNEDO_INSTANCE_URL`, change the variable and restart instead. Passkeys and identity providers are affected in the same way, but Lunedo neither ends the sessions nor records the change in the audit log.

## After a change

- Update the reverse proxy and its certificates; see [Reverse proxy](reverse-proxy.md).
- Update the redirect and reply URLs at your identity providers.
- Check **Settings › Instance › Operations › System status**: under **HTTPS** it warns when no address is set or when the address does not use HTTPS. See [System status](system-status.md#https).
- Own domains of knowledge base portals are separate from the instance address and stay as they are; see [Own domains](knowledge-base-portals.md#own-domains).

## Restoring on a new address

When a backup is restored in the setup assistant on a server with another address, the restore offers to use the new address; see [Restore](restore.md).
