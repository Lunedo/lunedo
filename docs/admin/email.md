# E-mail

Lunedo sends some e-mail directly, without regard to preferences:

- password resets, e-mail address changes, use of recovery codes, invitations (also portal invitations of a knowledge base), self-registration and test mails, which belong to a flow the person started;
- notices about the person's own account: an administrator reset the second factor, the account now signs in through an identity provider, or it became a local account and needs a password;
- mails to addresses outside Lunedo: the notice of an emergency sign-in to the **Further e-mail addresses**, see [Emergency sign-in](identity-providers.md#emergency-sign-in), and the warnings about backups and the file store, and their test mail, to the [operations contacts](notifications.md#operations-contacts).

Reminders and notices, such as expiring access or a new sign-in, are notifications; e-mail is one of their channels, see [Notifications](notifications.md#e-mail).

Without a mail server, notifications stay in the app and nobody can reset a password by e-mail. The system status then shows the warning `notConfigured`, see [Troubleshooting](#troubleshooting).

The e-mail settings are under **Settings › Instance › Services › Delivery**. The same page holds browser push and the operations contacts, see [Notifications](notifications.md).

## Permissions

| Action | Needs |
|---|---|
| See the e-mail settings and the delivery state | Instance area Settings with View |
| Change the method, the SMTP or Microsoft Graph settings, add or remove credentials | Instance area Settings with Manage and a recent sign-in |
| Send a test mail | The same: Settings with Manage and a recent sign-in |

A recent sign-in means that you confirmed your identity within the time set by **Confirmation for sensitive changes** (`auth.reauthenticationMinutes`, default 10 minutes). When it is older, Lunedo asks for your password, passkey or authenticator code before the change or the test.

## Choosing a method

| Method | Use it for |
|---|---|
| SMTP with password | Your own mail server, a local relay, or a mail service such as SendGrid, Mailgun, Amazon SES, Postmark or Brevo |
| SMTP with OAuth2 | Microsoft 365 or Google Workspace through SMTP, or a mail server that accepts tokens from your own token endpoint |
| Microsoft Graph | Microsoft 365 without SMTP |

For Microsoft 365, Microsoft Graph is recommended; see [Microsoft 365](email/microsoft-365.md). For Google Workspace, see [Google Workspace](email/google-workspace.md).

The method is the instance setting `mail.method`. The setup assistant does not set up e-mail; when no mail server is set, its last screen links to the e-mail settings. Setup through configuration reads the `LUNEDO_SMTP_*` variables once, when the instance is set up, see [Setup through configuration](setup-through-configuration.md). There are no variables for Microsoft Graph. After the setup, the settings page is the place to change e-mail.

### Changing the method

**Method** under **Sending method** chooses which settings the page shows. The method changes only when you save the settings of the other method:

1. Select **SMTP** or **Microsoft Graph** under **Method**.
2. Fill in the settings and send a test mail.
3. Save. For Microsoft Graph, also add a client secret or a certificate, see [Microsoft 365](email/microsoft-365.md).

The page then shows "Currently through SMTP" or "Currently through Microsoft Graph". Switching to a method whose settings are not saved yet is refused with `mailNotReady`: Microsoft Graph needs saved settings and at least one credential that has not expired, SMTP needs saved SMTP settings. Method changes and changes to the settings are recorded in the audit log, see [Audit log](audit-log.md).

## SMTP

| Field | Meaning |
|---|---|
| **Service** | A preset that fills in server, port and connection security. **Microsoft 365** and **Google Workspace** also set **Sign-in** to OAuth2 and the matching provider. **Own mail server** leaves them free. |
| **Server**, **Port** | The mail server and its port |
| **Security** | The connection security, see below |
| **Sign-in** | **Password** or **OAuth2** |
| **User name**, **Password** | Empty when the server needs no sign-in. A stored password is kept when the field stays empty. |
| **Sender address** | The address mails come from. Many servers only allow the address of the account that signs in. |

Presets:

| Service | Server | Port | Security |
|---|---|---|---|
| Microsoft 365 | `smtp.office365.com` | 587 | STARTTLS, OAuth2 |
| Google Workspace | `smtp.gmail.com` | 465 | TLS, OAuth2 |
| SendGrid | `smtp.sendgrid.net` | 587 | STARTTLS |
| Mailgun (US) | `smtp.mailgun.org` | 587 | STARTTLS |
| Mailgun (EU) | `smtp.eu.mailgun.org` | 587 | STARTTLS |
| Amazon SES (Frankfurt) | `email-smtp.eu-central-1.amazonaws.com` | 587 | STARTTLS |
| Amazon SES (Ireland) | `email-smtp.eu-west-1.amazonaws.com` | 587 | STARTTLS |
| Amazon SES (N. Virginia) | `email-smtp.us-east-1.amazonaws.com` | 587 | STARTTLS |
| Postmark | `smtp.postmarkapp.com` | 587 | STARTTLS |
| Brevo | `smtp-relay.brevo.com` | 587 | STARTTLS |

User name, password or API key and the sender stay as you enter them.

| Security | Behavior |
|---|---|
| TLS | Connects with TLS, usually port 465. |
| STARTTLS | Requires the upgrade to TLS, usually port 587; fails when the server does not offer it. |
| None | Plain text, for a relay that runs next to Lunedo or a mail catcher. Cannot be combined with a user name or OAuth2. |

TLS connections need at least TLS 1.2, and certificates are always verified.

The password is stored with envelope encryption and never returned. A test mail can be sent with settings before they are saved; without a new password it uses the stored one, but only while server, port and user name stay the same. With OAuth2, the stored client secret or key is used only while server, port, mailbox and the app (tenant, client and Microsoft cloud, the service account, or token endpoint and client) stay the same; otherwise enter it again. A successful test means that the server accepted the mail. Many servers reject it later and send a non-delivery report to the sender address, which Lunedo cannot see.

### SMTP with OAuth2

Instead of a password, SMTP can sign in with an access token through SASL XOAUTH2. Choose **OAuth2** under **Sign-in**, then the **Provider**:

| Provider | Grant | Lunedo stores |
|---|---|---|
| Microsoft 365 | Client credentials, scope `https://outlook.office365.com/.default` | Tenant ID, application ID, Microsoft cloud; the client secret |
| Google Workspace | Signed assertion of a service account with domain-wide delegation, scope `https://mail.google.com/` | Service account and its client ID; only the private key of the key file |
| Other token endpoint | Client credentials at a token endpoint with a scope | Token endpoint, client ID, scope; the client secret |

**Mailbox** is the mailbox Lunedo signs in as, usually also the sender address. OAuth2 needs TLS or STARTTLS. The settings show the steps to take at the provider, with the values to copy, before the fields.

For **Other token endpoint**:

1. Make sure the token endpoint issues access tokens with the client credentials grant and the mail server accepts them through XOAUTH2.
2. Enter the **Token endpoint** (starting with `https://`), the **Client ID**, the **Client secret** and the **Scope** the mail server expects.
3. Enter the **Mailbox** and send a test mail.

Secrets and access tokens are stored with envelope encryption and never returned or logged. Lunedo fetches a token when it needs one and keeps it, shared by all nodes, until five minutes before it expires; when the mail server refuses a stored token, it fetches a new one once. Changing the SMTP settings drops the stored token. A test mail always fetches a fresh token.

## Delivery

A mail is written to an outbox in the same transaction as the change that causes it, encrypted because it can contain links with tokens. A job delivers it and deletes it afterwards. Delivery runs in its own jobs with time limits, so a failing mail server never blocks other jobs or requests.

- **Retries.** A failed delivery is retried up to eight times. The first retry waits 30 to 60 seconds, and every further wait doubles, so the attempts spread over two to four hours. After the last attempt the mail is marked as failed and its content is removed.
- **Lost mails.** A job looks every minute for mails whose delivery was never started, for example after a crash right after the commit, and queues them.
- **Send rate.** Lunedo sends at most **E-mails per minute** from its sender address. When it is not set, the limit depends on the sending method: 30 for Microsoft Graph, the limit of a Microsoft 365 mailbox, and no limit for SMTP, because an SMTP server can be anything from a relay to a single mailbox. Set it in the section **Delivery** of the e-mail settings, from 1 to 10,000, when your mail service limits the rate, for example to 30 when you send through Microsoft 365 over SMTP ([Sending limits](email/microsoft-365.md#sending-limits)). The limit counts the last 60 seconds and applies to all workers and nodes together. Further mails wait for a free place without using up a retry. Each worker sends up to four mails at a time, so the configured rate is reached also for a large backlog. Many mails at once, for example after an import, are then sent over several minutes.
- **No duplicates.** Before sending, a node claims the mail, so two nodes never send it at the same time. A claim older than ten minutes, left by a node that stopped while sending, is handed to the next run. Each mail carries a `Message-ID` derived from its ID, except through Microsoft Graph with the default setting, so a mail sent again after such a stop has the same ID and mail systems can recognize it.

The section **Delivery** on the settings page holds **E-mails per minute** and shows the **Last delivery error** with its cause and the step that failed, and the **Last e-mail handed to the server**. Logs name the mail ID, template, attempt and error code, never recipients, content, secrets or tokens.

## Language and layout

Mails are written in the language of the recipient's account, English or German, inherited from the home organization or the instance unless the person chose one. Dates in notification mails use the date format and time zone of the account.

Every mail has a fixed layout: the organization's logo, or its name, at the top, the instance's accent color, the text, at most one action button followed by its address in plain text, and a footer with the instance name. Logo and name come from the organization the mail is about. Links and codes are set by the template and cannot be changed by organizations. Mails go out with a plain-text and an HTML part, except through Microsoft Graph with the default setting, see [Microsoft 365](email/microsoft-365.md#sent-items-and-unsubscribe-headers).

## Troubleshooting

### Test mail fails

A failed test names the cause, the step that failed and a code for administrators:

| Step | What to check |
|---|---|
| getting an access token | The OAuth2 settings at the provider; see the token errors below. |
| connecting to the mail server | Server name and port, the connection security (465 usually needs TLS, 587 STARTTLS), firewalls. Lunedo waits 20 seconds for the connection and 20 seconds for the greeting. |
| signing in at the mail server | User name and password, or for OAuth2 that the app may use the mailbox and SMTP sign-in is allowed for it. |
| sending the message | Sender and recipient. Many servers only accept the address of the account that signs in as sender. |

| Token error | Meaning |
|---|---|
| `oauthTokenUnreachable` | The token endpoint could not be reached or is not available. |
| `oauthClientRejected` | The client ID or client secret was not accepted, or the secret has expired. |
| `oauthNotAuthorized` | The app may not get a token for this mailbox: check the permission and admin consent, or the domain-wide delegation with its scope. |
| `oauthScopeRejected` | The scope was not accepted. |
| `oauthTokenRefused` | The token endpoint refused the request: check tenant, client and token endpoint. |
| `oauthKeyInvalid` | The stored key of the Google service account cannot be read: choose the key file again. |

Errors of Microsoft Graph are listed in [Microsoft 365](email/microsoft-365.md#errors).

### The test succeeds but mail does not arrive

The server accepted the mail and rejected it later. Look for a non-delivery report in the mailbox of the sender address, and in the logs or message trace of the mail service.

### Status `notConfigured`

**Settings › Instance › Operations › System status** shows the e-mail item as a warning when no method has saved settings. Set up SMTP or Microsoft Graph as described above. See [System status](monitoring/system-status.md#e-mail).

### Status `deliveryFailing`

The e-mail item is an error when the last delivery attempt failed and no mail was delivered since. The facts show the method, the time and code of the last failure and the last success. Open **Settings › Instance › Services › Delivery**, read the **Last delivery error**, fix the cause and send a test mail. The status returns to OK with the next successful delivery. Mails that are still being retried are delivered then; mails whose attempts ran out are not sent again.
