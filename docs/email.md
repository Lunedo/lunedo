# E-mail

Pagehall sends e-mail for password resets, e-mail address changes, recovery code use and setup tests. Notification mails follow with the notification center.

## SMTP

SMTP is an instance setting, configured in the setup assistant or through configuration. The password is stored with envelope encryption.

| Security | Behavior |
|---|---|
| `tls` | Connects with TLS, usually port 465 |
| `starttls` | Requires the upgrade to TLS, usually port 587; fails when the server does not offer it |
| `none` | Plain text, for a local relay or a mail catcher; cannot be combined with credentials |

Certificates are always verified. SMTP with OAuth2 and Microsoft Graph are planned as further transports.

## Delivery

A mail is written to the outbox in the same transaction as the change that causes it, encrypted because it can contain links with tokens. A job delivers it and deletes it afterwards. Failed deliveries are retried eight times with growing delays; after the last attempt the mail is marked as failed and its content is removed. A job queues mails whose delivery was never started, for example after a crash right after the commit, every minute.

Logs name the mail ID, template and error code, never recipients or content.

Mails are written in the language of the account, English or German, as plain text with a simple HTML version.

## Development

The development environment includes [Mailpit](https://mailpit.axllent.org/). It catches every mail; its web interface is at `http://localhost:8025`. In the setup assistant, use host `mailpit`, port `1025` and security `none`.
