# E-mail with Microsoft 365

Lunedo sends through Microsoft 365 in two ways:

- **Microsoft Graph** (recommended): Lunedo calls `sendMail` of one sender mailbox with an app registration of its own. No SMTP is involved, and the app can be limited to the sender mailbox.
- **SMTP with OAuth2**: Lunedo signs in at `smtp.office365.com` with an access token instead of a password. Use it when the mails need the one-click unsubscribe header without keeping copies in the sender mailbox, see [Sent Items and unsubscribe headers](#sent-items-and-unsubscribe-headers).

Exchange Online is moving away from SMTP with passwords; do not use the password sign-in for Microsoft 365.

Both are set up under **Settings › Instance › Services › Delivery** and need the instance area Settings with Manage and a recent sign-in, also for test mails. The general settings, delivery and troubleshooting are on [E-mail](../email.md).

## Microsoft Graph

### Set up the app in Microsoft 365

1. In the Microsoft Entra admin center, create an app registration for e-mail only, separate from the one for sign-in, for example "Lunedo mail".
2. Note the **Directory (tenant) ID** and the **Application (client) ID** from its overview.
3. Under **API permissions**, add the Microsoft Graph application permission `Mail.Send` and grant admin consent. The app can then send as every mailbox of the tenant.
4. Recommended: limit the app to the sender mailbox with RBAC for Applications in Exchange Online, then remove `Mail.Send` from the app registration. In Exchange Online PowerShell:
   1. Connect with `Connect-ExchangeOnline`.
   2. If a command in the next steps asks you to run `Enable-OrganizationCustomization`, run it once, then repeat that command.
   3. Register the app: `New-ServicePrincipal -AppId <application ID> -ObjectId <object ID> -DisplayName "Lunedo mail"`. Take the object ID from **Enterprise applications**, not from **App registrations**.
   4. Create a scope that contains only the sender mailbox: `New-ManagementScope -Name "Lunedo sender" -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'wiki@nordwind.test'"`.
   5. Give the app the role for that scope: `New-ManagementRoleAssignment -App <application ID> -Role "Application Mail.Send" -CustomResourceScope "Lunedo sender"`.
   6. Remove the `Mail.Send` permission from the app registration in Entra ID.

   Changes to app permissions in Exchange Online can take between 30 minutes and 2 hours to apply. `Test-ServicePrincipalAuthorization -Identity <application ID> -Resource <mailbox>` shows the assignment at once. Lunedo cannot see how the permission was granted, so it cannot check whether the app is limited to the sender mailbox. It always sends only as the sender mailbox.

### Set up Lunedo

1. Open **Settings › Instance › Services › Delivery** and select **Microsoft Graph** under **Method**.
2. Enter the **Directory (tenant) ID**, the **Client ID** and the **Sender mailbox**, and optionally a **Sender name**; without it, the name of the mailbox is shown.
3. Choose whether to keep copies in the sender mailbox, see [Sent Items and unsubscribe headers](#sent-items-and-unsubscribe-headers).
4. Select **Save**. Tenant, app and sender are only valid together, so they are saved with one button.
5. Add a credential under **Client secret or certificate**:
   - **Add client secret**: create a client secret in Entra ID under **Certificates & secrets**, paste it and enter its expiry date as shown in Entra ID.
   - **Create certificate**: choose how long it is valid (1, 2 or 3 years). Lunedo creates the key pair and keeps the private key. Select **Download certificate** and upload the certificate to the app registration under **Certificates & secrets**.
6. Enter an address under **Send a test mail to** and select **Send test mail**.
7. Select **Save** again. Lunedo now sends through Microsoft Graph.

A test mail can be sent with settings before they are saved; it always uses the stored credentials. Graph accepts a mail with `202 Accepted` and delivers it later, so a successful test only means that Microsoft 365 accepted it. A delivery failure arrives as a non-delivery report in the sender mailbox, for example `550 5.7.233` when the tenant has reached its daily limit of external recipients. The message trace in the Exchange admin center shows what happened to a mail.

### Credentials and renewal

Client secrets and private keys are stored with envelope encryption and never returned. Several credentials can exist at the same time, so you can renew without a gap:

1. Add the new client secret or certificate.
2. Send a test mail.
3. Remove the old one with **Remove credential**.

The last credential cannot be removed while Lunedo sends through Microsoft Graph. The instance owner and the holders of the instance area Settings with Manage are notified 30 and 7 days before the last credential expires (event **E-mail credential expires soon**). A client secret without an expiry date gets no reminder.

### Microsoft cloud

The settings page uses the global Microsoft cloud (`https://login.microsoftonline.com` and `https://graph.microsoft.com`). Other Microsoft clouds are set with the fields `authority` and `graphUrl` of `PUT /api/v1/instance/mail/graph`, an internal route of the web client; the page keeps them when you save. Only these pairs are accepted:

| Cloud | `authority` | `graphUrl` |
|---|---|---|
| Global | `https://login.microsoftonline.com` | `https://graph.microsoft.com` |
| US Government | `https://login.microsoftonline.us` | `https://graph.microsoft.us` or `https://dod-graph.microsoft.us` |
| China (21Vianet) | `https://login.partner.microsoftonline.cn` | `https://microsoftgraph.chinacloudapi.cn` |

### Sent Items and unsubscribe headers

The setting **Keep a copy of every mail in the Sent Items of the sender mailbox** decides how Lunedo hands mails to Graph:

| Setting | What is sent | Copy in Sent Items | One-click unsubscribe header | Plain-text part |
|---|---|---|---|---|
| Off (default) | The HTML part as JSON | No | No | No |
| On | The full MIME message with all headers | Yes | Yes (`List-Unsubscribe`, `List-Unsubscribe-Post`) | Yes |

With the setting off, the unsubscribe link in the body of notification mails stays. Graph accepts the one-click unsubscribe header only in the MIME format, which also keeps the copy. For the header without copies, use [SMTP with OAuth2](#smtp-with-oauth2) instead.

When you turn the setting on, the page warns: Microsoft keeps a copy of every mail, including one-time links and excerpts of pages, in the Sent Items of the sender mailbox. Everyone who can read that mailbox, such as mailbox administrators, can read them, also pages from restricted spaces. A retention policy in Microsoft 365 can clean the copies up.

### Errors

A failed test or delivery names what failed and what to do:

| Code | Meaning and fix |
|---|---|
| `graphMailboxNotAllowed` | Exchange Online blocked the app for this mailbox. Add the mailbox to the management scope or the application access policy of the app, then test again. |
| `graphPermissionMissing` | The app has no permission to send. Assign `Application Mail.Send` in Exchange Online, limited to the sender mailbox, or grant `Mail.Send` in Entra ID. |
| `graphMailboxUnknown` | The sender mailbox does not exist in the tenant or has no Exchange Online mailbox. Check its address. |
| `graphCredentialExpired` | The client secret has expired. Create a new one in Entra ID, add it and remove the old one. |
| `graphCredentialInvalid` | Entra ID refused the secret or certificate. Check the client ID and the secret, or upload the certificate to the app registration. |
| `graphCredentialMissing` | No valid credential is stored. Add a client secret or create a certificate. |
| `graphTenantUnknown` | Entra ID does not know the tenant. Copy the directory (tenant) ID from the overview of the app registration. |
| `graphApplicationUnknown` | The app registration does not exist in this tenant. Copy the application (client) ID from its overview. |
| `graphUnreachable` | Graph or Entra ID could not be reached or was busy. Check that the server can reach `graph.microsoft.com` and `login.microsoftonline.com`, then try again in a few minutes. |
| `graphRefused` | Graph refused the mail. Check the sender mailbox and the recipient. |

Delivery through Graph is retried like delivery through SMTP, see [E-mail](../email.md#delivery).

## SMTP with OAuth2

1. In the Microsoft Entra admin center, register an app that is only for e-mail.
2. Under **API permissions**, add **Office 365 Exchange Online**, application permission `SMTP.SendAsApp`, and grant admin consent.
3. Create a client secret.
4. In Exchange Online PowerShell, connect with `Connect-ExchangeOnline`, then run the three commands the settings page shows with your values filled in. Use the object ID from **Enterprise applications**, not from **App registrations**:
   1. Register the app as a service principal in Exchange: `New-ServicePrincipal -AppId <application ID> -ObjectId <object ID> -DisplayName "Lunedo mail <application ID>"`
   2. Let this service principal use the mailbox. `Add-MailboxPermission` takes the identity of the Exchange service principal, not the application ID, so the command reads it by its display name: `Add-MailboxPermission -Identity <mailbox> -User (Get-ServicePrincipal -Identity "Lunedo mail <application ID>").Identity -AccessRights FullAccess`
   3. Allow SMTP sign-in for the mailbox: `Set-CASMailbox -Identity <mailbox> -SmtpClientAuthenticationDisabled $false`

   When security defaults are on in Entra ID, Exchange Online refuses SMTP sign-in; use [Microsoft Graph](#microsoft-graph) instead. When the sender address is not the mailbox, also give the service principal Send As permission for the sender address with `Add-RecipientPermission`.
5. In Lunedo, open **Settings › Instance › Services › Delivery**, select **SMTP** under **Method** and the service **Microsoft 365**. It fills in `smtp.office365.com`, port 587, STARTTLS and OAuth2.
6. Enter the **Mailbox**, the **Tenant ID**, the **Application (client) ID**, the **Client secret** and the **Sender address**.
7. For a cloud other than the global one, open **Advanced: other Microsoft cloud** and choose **US Government** or **China (21Vianet)** under **Microsoft cloud**. This changes the token endpoint; the server and the scope stay as above, so send a test mail to check that the mail server of that cloud accepts the token.
8. Send a test mail, then save.

Lunedo gets the token with the client credentials grant at `<authority>/<tenant>/oauth2/v2.0/token` with the scope `https://outlook.office365.com/.default`. A stored secret is kept only while tenant, application and cloud stay the same; a new app needs its secret again. Token errors are listed in [E-mail](../email.md#test-mail-fails).
