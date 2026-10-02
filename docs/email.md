# E-mail

Pagehall sends e-mail for password resets, e-mail address changes, recovery code use, setup tests, invitations and self-registration. Reminders and notices, such as expiring access or break-glass access, are notifications; e-mail is one of their channels, see [notifications.md](notifications.md).

## SMTP

SMTP is an instance setting, configured in the setup assistant, in the instance administration or through configuration. The password is stored with envelope encryption and never returned; changing the configuration needs a recent sign-in. A test mail can be sent with a configuration before it is saved; without a new password it uses the stored one.

| Security | Behavior |
|---|---|
| `tls` | Connects with TLS, usually port 465 |
| `starttls` | Requires the upgrade to TLS, usually port 587; fails when the server does not offer it |
| `none` | Plain text, for a local relay or a mail catcher; cannot be combined with credentials |

Certificates are always verified. SMTP with OAuth2 and Microsoft Graph are planned as further transports.

## Delivery

A mail is written to the outbox in the same transaction as the change that causes it, encrypted because it can contain links with tokens. A job delivers it and deletes it afterwards. Failed deliveries are retried eight times with growing delays; after the last attempt the mail is marked as failed and its content is removed. A job queues mails whose delivery was never started, for example after a crash right after the commit, every minute.

Logs name the mail ID, template and error code, never recipients or content.

Mails are written in the language of the account, inherited from its home organization unless the account chose one, in English or German. Dates in notification mails use the date format and time zone of the account. Mails to people without an account use the language of the organization.

Every mail has a plain-text and an HTML version with a fixed layout: the organization's logo, or its name, at the top, its accent color, the text, at most one action button followed by its address in plain text, and a footer with the instance name. Notification mails add a link to the notification preferences. Logo and color come from the organization the mail is about; everything else, including links and codes, is set by the template and cannot be changed by organizations.

## Development

The development environment includes [Mailpit](https://mailpit.axllent.org/). It catches every mail; its web interface is at `http://localhost:8025`. In the setup assistant, use host `mailpit`, port `1025` and security `none`.
