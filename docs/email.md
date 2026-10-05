# E-mail

Pagehall sends e-mail for password resets, e-mail address changes, recovery code use, setup tests, invitations and self-registration. Reminders and notices, such as expiring access or break-glass access, are notifications; e-mail is one of their channels, see [notifications.md](notifications.md).

## Sending method

Pagehall sends either through SMTP or through Microsoft Graph (`mail.method`, instance setting). A method takes effect when its settings are saved; switching to Microsoft Graph needs saved Graph settings and a credential. Changes are audited as `mail.methodChanged`, `mail.smtpChanged`, `mail.graphChanged`, `mail.credentialAdded` and `mail.credentialRemoved`; test mails as `mail.testSent` with the method.

## SMTP

SMTP is an instance setting, configured in the setup assistant, in the instance administration or through configuration. The password is stored with envelope encryption and never returned; changing the configuration needs a recent sign-in. A test mail can be sent with a configuration before it is saved; without a new password it uses the stored one. A successful test means that the server accepted the mail; many servers reject it later and send a non-delivery report to the sender address, which Pagehall cannot see.

| Security | Behavior |
|---|---|
| `tls` | Connects with TLS, usually port 465 |
| `starttls` | Requires the upgrade to TLS, usually port 587; fails when the server does not offer it |
| `none` | Plain text, for a local relay or a mail catcher; cannot be combined with credentials |

Certificates are always verified.

Services such as SendGrid, Mailgun, Amazon SES, Postmark and Brevo are used through SMTP. The settings offer presets for them that fill in server, port and connection security, nothing else; user name, password or API key and sender stay as entered.

## Microsoft Graph

Exchange Online is moving away from SMTP with passwords. With Microsoft Graph, Pagehall sends through `sendMail` of one sender mailbox, with an app registration of its own:

1. In the Entra admin center, create an app registration for e-mail only, separate from the one for sign-in.
2. Give the app the right to send. There are two ways:
   - Recommended: grant it only for the sender mailbox, in Exchange Online with RBAC for applications, and not in Entra ID. Create a service principal for the app (`New-ServicePrincipal`), a management scope that contains only the sender mailbox (`New-ManagementScope`), and assign the role `Application Mail.Send` with that scope (`New-ManagementRoleAssignment -Role "Application Mail.Send" -App … -CustomResourceScope …`). A tenant that has never been customized needs `Enable-OrganizationCustomization` first, which can take several hours to complete.
   - Simple: grant `Mail.Send` as an application permission in Entra ID, with admin consent. The app can then send as every mailbox of the tenant.

   Pagehall cannot see which way was chosen. It sends only as the sender mailbox, but it does not know whether the app is limited to it.
3. In Pagehall, enter the directory (tenant) ID, the application (client) ID and the sender mailbox, optionally a sender name, and add a client secret or let Pagehall create a certificate, whose public part is uploaded to the app registration. Secrets and private keys are stored with envelope encryption and never returned. As with identity providers, several credentials can exist during a renewal, the last one cannot be removed while Graph sends, and the holders of the instance settings area are notified 30 and 7 days before the last one expires (`mail.credentialExpiring`).

The authority and the Graph endpoint default to the global Microsoft cloud; other Microsoft clouds can be set, other hosts only with `PAGEHALL_INSECURE_IDENTITY_PROVIDERS` for development. A test mail can be sent with settings before they are saved. Errors name what failed and what to do:

| Code | Meaning |
|---|---|
| `graphMailboxNotAllowed` | Exchange Online blocked the app for this mailbox: add it to the management scope or the access policy. |
| `graphPermissionMissing` | The app has no permission to send: assign `Application Mail.Send` in Exchange Online or grant `Mail.Send` in Entra ID. |
| `graphMailboxUnknown` | The sender mailbox does not exist or has no Exchange Online mailbox. |
| `graphCredentialExpired` | The client secret has expired: add a new one. |
| `graphCredentialInvalid` | Entra ID refused the secret or certificate. |
| `graphCredentialMissing` | No valid credential is stored. |
| `graphTenantUnknown`, `graphApplicationUnknown` | Wrong tenant or client ID. |
| `graphUnreachable`, `graphRefused` | Graph could not be reached, was busy or refused the mail. |

Delivery through Graph is retried like delivery through SMTP.

Graph accepts a mail with `202 Accepted` and delivers it later, so a successful test only means that Microsoft 365 accepted it. A delivery failure arrives as a non-delivery report in the sender mailbox, for example `550 5.7.233` when a new or trial tenant may not send to external recipients yet. Pagehall sends with `saveToSentItems: false`, so the sent mail itself does not appear in Sent Items; the message trace in the Exchange admin center shows what happened to it.

## Delivery

A mail is written to the outbox in the same transaction as the change that causes it, encrypted because it can contain links with tokens. A job delivers it and deletes it afterwards. Failed deliveries are retried eight times with growing delays; after the last attempt the mail is marked as failed and its content is removed. A job queues mails whose delivery was never started, for example after a crash right after the commit, every minute.

Logs name the mail ID, template and error code, never recipients, content, secrets or tokens.

Mails are written in the language of the account, inherited from its home organization unless the account chose one, in English or German. Dates in notification mails use the date format and time zone of the account. Mails to people without an account use the language of the organization.

Every mail has a plain-text and an HTML version with a fixed layout: the organization's logo, or its name, at the top, its accent color, the text, at most one action button followed by its address in plain text, and a footer with the instance name. Notification mails add a link to the notification preferences. Logo and color come from the organization the mail is about; everything else, including links and codes, is set by the template and cannot be changed by organizations.

## Development

The development environment includes [Mailpit](https://mailpit.axllent.org/). It catches every mail; its web interface is at `http://localhost:8025`. In the setup assistant, use host `mailpit`, port `1025` and security `none`.
