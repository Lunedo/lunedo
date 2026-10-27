# E-mail

Lunedo sends e-mail for password resets, e-mail address changes, recovery code use, setup tests, invitations and self-registration. Reminders and notices, such as expiring access or break-glass access, are notifications; e-mail is one of their channels, see [notifications.md](notifications.md).

## Sending method

Lunedo sends either through SMTP or through Microsoft Graph (`mail.method`, instance setting). A method takes effect when its settings are saved; switching to Microsoft Graph needs saved Graph settings and a credential. Changes are audited as `mail.methodChanged`, `mail.smtpChanged`, `mail.graphChanged`, `mail.credentialAdded` and `mail.credentialRemoved`; test mails as `mail.testSent` with the method.

## SMTP

SMTP is an instance setting, configured in the setup assistant, in the instance administration or through configuration. The password is stored with envelope encryption and never returned; changing the configuration needs a recent sign-in. A test mail can be sent with a configuration before it is saved; without a new password it uses the stored one. A successful test means that the server accepted the mail; many servers reject it later and send a non-delivery report to the sender address, which Lunedo cannot see.

| Security | Behavior |
|---|---|
| `tls` | Connects with TLS, usually port 465 |
| `starttls` | Requires the upgrade to TLS, usually port 587; fails when the server does not offer it |
| `none` | Plain text, for a local relay or a mail catcher; cannot be combined with credentials |

Certificates are always verified.

Services such as SendGrid, Mailgun, Amazon SES, Postmark and Brevo are used through SMTP. The settings offer presets for them that fill in server, port and connection security, nothing else; user name, password or API key and sender stay as entered. The presets for Microsoft 365 and Google Workspace also choose OAuth2.

### SMTP with OAuth2

Instead of a password, SMTP can sign in with an access token through SASL XOAUTH2 (`oauth2` in the SMTP configuration). The user name is the mailbox Lunedo signs in as. OAuth2 needs TLS or STARTTLS.

| Provider | Grant | Lunedo stores |
|---|---|---|
| `microsoft365` | Client credentials at `{authority}/{tenant}/oauth2/v2.0/token` with the scope `https://outlook.office365.com/.default` | Tenant ID, application ID, Microsoft cloud; the client secret |
| `google` | Signed JWT assertion of a service account with domain-wide delegation, subject the mailbox, scope `https://mail.google.com/`, at `https://oauth2.googleapis.com/token` | Service account and its client ID; only the private key of the uploaded key file |
| `generic` | Client credentials at a token endpoint (HTTPS) with a scope | Token endpoint, client ID, scope; the client secret |

Setup in Microsoft 365: register an app, add the application permission `SMTP.SendAsApp` of Office 365 Exchange Online with admin consent, create a client secret, then in Exchange Online PowerShell register the service principal (`New-ServicePrincipal -AppId … -ObjectId …`, with the object ID from Enterprise applications), give it the mailbox (`Add-MailboxPermission -Identity … -User … -AccessRights FullAccess`) and allow SMTP sign-in for it (`Set-CASMailbox -Identity … -SmtpClientAuthenticationDisabled $false`). Setup in Google Workspace: create a service account with a JSON key, then add its client ID with the scope `https://mail.google.com/` under domain-wide delegation in the Admin console. The settings show these steps and the values to copy before the fields. Google advises against service account keys; rotate the key regularly and upload the new one.

Secrets and access tokens are stored with envelope encryption and never returned or logged. Lunedo fetches a token when it needs one and keeps it, shared by all nodes, until five minutes before it expires; when the mail server refuses a stored token, it fetches a new one once. Changing the SMTP configuration drops the stored token; a new OAuth2 client needs its secret again, and switching back to a password removes the OAuth2 secret. A test mail fetches a fresh token and names the step that failed (`token`, `connect`, `authenticate`, `send`); token errors are `oauthTokenUnreachable`, `oauthClientRejected`, `oauthNotAuthorized`, `oauthScopeRejected`, `oauthTokenRefused` and `oauthKeyInvalid`.

## Microsoft Graph

Exchange Online is moving away from SMTP with passwords. With Microsoft Graph, Lunedo sends through `sendMail` of one sender mailbox, with an app registration of its own:

1. In the Entra admin center, create an app registration for e-mail only, separate from the one for sign-in.
2. Give the app the right to send. There are two ways:
   - Recommended: grant it only for the sender mailbox, in Exchange Online with RBAC for applications, and not in Entra ID. Create a service principal for the app (`New-ServicePrincipal`), a management scope that contains only the sender mailbox (`New-ManagementScope`), and assign the role `Application Mail.Send` with that scope (`New-ManagementRoleAssignment -Role "Application Mail.Send" -App … -CustomResourceScope …`). A tenant that has never been customized needs `Enable-OrganizationCustomization` first, which can take several hours to complete.
   - Simple: grant `Mail.Send` as an application permission in Entra ID, with admin consent. The app can then send as every mailbox of the tenant.

   Lunedo cannot see which way was chosen. It sends only as the sender mailbox, but it does not know whether the app is limited to it.
3. In Lunedo, enter the directory (tenant) ID, the application (client) ID and the sender mailbox, optionally a sender name, and add a client secret or let Lunedo create a certificate, whose public part is uploaded to the app registration. Secrets and private keys are stored with envelope encryption and never returned. As with identity providers, several credentials can exist during a renewal, the last one cannot be removed while Graph sends, and the holders of the instance settings area are notified 30 and 7 days before the last one expires (`mail.credentialExpiring`).

The authority and the Graph endpoint default to the global Microsoft cloud; other Microsoft clouds can be set, other hosts only with `LUNEDO_INSECURE_IDENTITY_PROVIDERS` for development. A test mail can be sent with settings before they are saved. Errors name what failed and what to do:

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

Delivery through Graph is retried like delivery through SMTP. By default **Keep a copy of every mail in the Sent Items of the sender mailbox** is off: Lunedo sends the HTML part as JSON with `saveToSentItems: false`, so no copy stays in the mailbox. Graph accepts the one-click unsubscribe header only in the MIME format, so these mails carry no `List-Unsubscribe` header and no text part; the unsubscribe link in the body stays. For one-click unsubscribe with Microsoft 365, use SMTP with OAuth. With the setting on, Lunedo sends the full MIME message with a text and an HTML part and all headers, and Graph keeps a copy of every mail in the Sent Items of the sender mailbox, including one-time links and excerpts of pages, which everyone who can read the mailbox, such as mailbox administrators, can read. A retention policy can clean the copies up.

Graph accepts a mail with `202 Accepted` and delivers it later, so a successful test only means that Microsoft 365 accepted it. A delivery failure arrives as a non-delivery report in the sender mailbox, for example `550 5.7.233` when a new or trial tenant may not send to external recipients yet. The message trace in the Exchange admin center shows what happened to it.

## Delivery

A mail is written to the outbox in the same transaction as the change that causes it, encrypted because it can contain links with tokens. A job delivers it and deletes it afterwards. Failed deliveries are retried eight times with growing delays; after the last attempt the mail is marked as failed and its content is removed. A job queues mails whose delivery was never started, for example after a crash right after the commit, every minute.

Before sending, a node claims the mail (`sending`), so two nodes never send it at the same time. A claim older than ten minutes, left by a node that stopped while sending, is handed to the next run. Each mail carries a `Message-ID` derived from its ID, so a mail that is sent again after such a stop has the same ID and mail systems can recognize it. Delivery runs in its own jobs with time limits, so a failing mail server never blocks other jobs or requests. The e-mail settings show the last delivery error with its step and the last successful delivery (`delivery` in `GET /api/v1/instance/mail`).

Logs name the mail ID, template and error code, never recipients, content, secrets or tokens.

Mails are written in the language of the account, inherited from its home organization unless the account chose one, in English or German. Dates in notification mails use the date format and time zone of the account. Mails to people without an account use the language of the organization.

Every mail has a plain-text and an HTML version with a fixed layout: the organization's logo, or its name, at the top, its accent color, the text, at most one action button followed by its address in plain text, and a footer with the instance name. Notification mails add a link to the notification preferences and an unsubscribe link, see [notifications.md](notifications.md#e-mail). Logo and color come from the organization the mail is about; everything else, including links and codes, is set by the template and cannot be changed by organizations.

## Development

The development environment includes [Mailpit](https://mailpit.axllent.org/). It catches every mail; its web interface is at `http://localhost:8025`. In the setup assistant, use host `mailpit`, port `1025` and security `none`.
