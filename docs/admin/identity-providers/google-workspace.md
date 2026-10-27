# Google Workspace

People sign in with their Google Workspace account through OpenID Connect. At first, Google Workspace is used for sign-in only. Group synchronization can be turned on later with a service account; Lunedo then reads groups through the Google Directory API and synchronizes them in the background.

What all providers share, such as domains, credentials, testing and the first sign-in, is described in [Identity providers](../identity-providers.md). Groups and mapping rules are described in [Identity provider groups](../identity-provider-groups.md).

## Setting up sign-in

1. In **Settings › Instance › People and sign-in › Sign-in methods**, choose **Add provider** and **Google Workspace**. The **Connection** step shows the redirect URI, for example `https://wiki.example.com/api/v1/auth/providers/{provider ID}/callback`.
2. In the Google Cloud console, under **Google Auth platform**, set up the consent screen with the audience **Internal**, so that only accounts of your Workspace can use the client. Then create an OAuth client of type "Web application" and add the redirect URI as an authorized redirect URI. Copy the client secret when it is shown; Google does not show it again.
3. In Lunedo, enter the client ID and add the client secret with its expiry date, if it has one. Choose **Save and continue**.
4. Under **Accounts**, enter every domain of your Google Workspace, at least one, for e-mail addresses and for sign-in names.
5. Test the sign-in and choose **Finish**.

## Domains and the `hd` claim

Google marks every Workspace account with its domain in the `hd` claim of the ID token. Lunedo accepts a sign-in only when this domain is one of the provider's domains; private Google accounts and accounts of other Workspaces are refused. When the provider has exactly one domain, Lunedo also asks Google to offer only accounts of that domain.

Google Workspace sends the e-mail address, the name and the user ID; there is nothing to choose under **User attributes**. The identifier is the Google user ID (`sub`); the sign-in name is the e-mail address.

## Group synchronization

The ID token of Google carries no groups. Without group synchronization, mapping rules see no groups. With it, Lunedo reads the groups of each person through the Directory API with a service account, at sign-in and in the background, and the rule dialog searches the groups of the domain by name.

1. In Google Cloud, create a service account and a JSON key for it. When the organization policy `iam.disableServiceAccountKeyCreation` blocks the creation of keys, which is the default in newer organizations, an organization policy administrator must exempt the project.
2. Give the service account access to the directory, in one of two ways (see below).
3. On the provider page in Lunedo, open **Settings**, turn on **Synchronize groups** under **Synchronization**, and choose **How Lunedo reads the groups**.
4. Paste the JSON key under **Service account key** and choose **Save key**. The key is stored encrypted and never shown again; **Remove key** deletes it.

### Administrator role (recommended)

In the Google Admin console, under **Account > Admin roles**, point to a role that can read groups, for example the prebuilt role Groups Reader, choose **Assign admin** and **Assign service accounts**, enter the e-mail address of the service account and choose **Add** and **Assign role**. When the role is limited to some kinds of groups, Lunedo sees only those groups. Lunedo then requests only the read-only scope `admin.directory.group.readonly` and acts as the service account itself, so the Google audit log shows the service account.

### Domain-wide delegation

Under **Security > Access and data control > API controls > Manage Domain Wide Delegation**, choose **Add new** and authorize the client ID of the service account for the scopes `https://www.googleapis.com/auth/admin.directory.group.readonly` and `https://www.googleapis.com/auth/admin.directory.user.readonly`. The client ID is under **Advanced settings** in the details of the service account. In Lunedo, enter the address of an administrator under **Administrator for the directory**; the service account acts for that person. Delegation lets the service account use these scopes for the whole domain as that administrator. Use it only when the administrator role is not possible. Google says a change can take up to 24 hours, but usually applies sooner.

## Detecting suspended accounts

To deactivate accounts that are suspended, archived or deleted in Google Workspace, Lunedo must read users as well as groups:

- With the administrator role, assign a role that can also read users, for example a custom role with **Users > Read**, and turn on **Detect suspended accounts**. Lunedo then also requests `admin.directory.user.readonly`.
- With domain-wide delegation, Lunedo always reads users.

Without it, Lunedo does not see suspensions: a suspended person can no longer sign in through Google, but sessions already open run until they expire. Synchronization then only updates groups and deactivates nobody.

See [Synchronization](../identity-provider-groups.md#synchronization) for how runs work and how Lunedo guards against deactivating many accounts by mistake.

## Second factor

Either keep **Handled by the provider** and enforce 2-step verification in Google Workspace, or choose **Always ask for a Lunedo second factor**. **Require proof from the provider** works only when the ID token carries an `amr` claim with one of the accepted values; a test sign-in shows the claims Google sends.

Checked against Google Cloud and Google Workspace documentation, October 2026.
