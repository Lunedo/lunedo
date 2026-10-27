# E-mail with Google Workspace

Lunedo sends through Google Workspace with SMTP and OAuth2: a Google Cloud service account with domain-wide delegation signs in at `smtp.gmail.com` as one mailbox. No password of the mailbox is stored.

The settings are under **Settings › Instance › Services › Delivery** and need the instance area Settings with Manage and a recent sign-in, also for test mails. The general settings, delivery and troubleshooting are on [E-mail](../email.md).

## Create the service account

1. In the Google Cloud console, create a service account in a project of your organization, for example "lunedo-mail".
2. Under **Keys**, add a key of the type JSON and download the key file.
3. Note the **client ID** of the service account, a number.

## Allow domain-wide delegation

1. In the Google Admin console, open **Security › Access and data control › API controls › Manage domain-wide delegation**.
2. Add a new entry with the client ID of the service account and the scope `https://mail.google.com/`.
3. Save. Google may need a few minutes, rarely up to 24 hours, before the delegation works.

The delegation lets the service account act as any mailbox of the domain. Lunedo uses it only for the mailbox you enter.

## Set up Lunedo

1. Open **Settings › Instance › Services › Delivery** and select **SMTP** under **Method**.
2. Choose the service **Google Workspace**. It fills in `smtp.gmail.com`, port 465, TLS and OAuth2 with the provider **Google Workspace**.
3. Enter the **Mailbox** Lunedo signs in as, for example `wiki@nordwind.test`, and the **Sender address**, usually the same.
4. Under **Key file of the service account**, choose the JSON key file. Lunedo reads the service account and its client ID from it and shows them, and stores only the private key, encrypted.
5. Enter an address under **Send a test mail to** and select **Send test mail**.
6. Save.

Lunedo signs a JWT assertion with the private key, with the mailbox as subject and the scope `https://mail.google.com/`, and exchanges it at `https://oauth2.googleapis.com/token` for an access token. Tokens are kept until five minutes before they expire.

## Rotating the key

Google advises against long-lived service account keys. Rotate the key regularly:

1. In the Google Cloud console, add a new JSON key to the service account.
2. In Lunedo, choose the new key file under **Key file of the service account**. A stored key is replaced by the file you choose.
3. Send a test mail, then save.
4. Delete the old key in the Google Cloud console.

The client ID stays the same, so the delegation does not change.

## Errors

| Code | Meaning and fix |
|---|---|
| `oauthNotAuthorized` | The service account may not get a token for this mailbox. Check the domain-wide delegation, its client ID and the scope `https://mail.google.com/`, and wait for Google to apply a new delegation. |
| `oauthScopeRejected` | The scope was not accepted. Check the scope of the delegation. |
| `oauthKeyInvalid` | The stored key cannot be read. Choose the key file again. |
| `oauthClientRejected`, `oauthTokenRefused` | Google did not accept the request, for example because the key was deleted or the service account disabled. Check the service account and upload a current key. |
| `oauthTokenUnreachable` | `oauth2.googleapis.com` could not be reached. Check the network connection of the server. |

Other failures are described in [E-mail](../email.md#troubleshooting).
