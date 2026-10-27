# Microsoft Entra ID

Checked against Microsoft Entra documentation, October 2026.

People sign in with their Microsoft work account. Lunedo connects to one Entra ID tenant, through OpenID Connect or through SAML 2.0. Prefer OpenID Connect: with one app registration, Lunedo signs people in, reads their groups and synchronizes account status in the background. Use SAML when your organization requires it.

What all providers share, such as domains, credentials, testing and the first sign-in, is described in [Identity providers](../identity-providers.md). Groups and mapping rules are described in [Identity provider groups](../identity-provider-groups.md).

## OpenID Connect

### At Entra ID

1. In **Settings › Instance › People and sign-in › Sign-in methods**, choose **Add provider** and **Microsoft Entra ID**. The **Connection** step shows the redirect URI, for example `https://wiki.example.com/api/v1/auth/providers/{provider ID}/callback`.
2. In the Microsoft Entra admin center, create an app registration for a single tenant. Add the redirect URI as a redirect URI of the platform "Web".
3. Under **API permissions**, add the Microsoft Graph application permissions `GroupMember.Read.All` and `User.Read.All` and grant admin consent. Lunedo uses them with its own credential, never with the person's token, to read groups, group names and account status.
4. Create a client secret under **Certificates & secrets**, or upload Lunedo's certificate later (see step 7).
5. Under **Enterprise applications**, open the application. On **Properties**, turn on **Assignment required**; under **Users and groups**, choose **Add user/group** and assign the people or groups who may use Lunedo. Assignment does not cover members of nested groups, and assigning groups needs Entra ID P1 or higher.

### In Lunedo

6. Enter the **Directory (tenant) ID** and the **Client ID** of the app registration. **Token signature** stays at RS256 unless the tenant signs ID tokens otherwise.
7. Add the credential: the client secret with its expiry date, or choose a certificate. For a certificate, Lunedo creates the key pair; download the certificate and upload it under **Certificates & secrets** of the app registration.
8. Choose **Save and continue**, then the **User attributes** (see below) and the settings on **Accounts**. Enter every domain that is verified in the tenant, for e-mail addresses and for sign-in names.
9. Test the sign-in and choose **Finish**.

Lunedo accepts only tokens of the configured tenant. It never uses the multi-tenant endpoints; a person of another tenant is refused.

### User attributes

The identifier is fixed: the tenant ID and the object ID of the person (`tid` and `oid`). It stays the same when names or addresses change.

| Setting | Options | Default |
|---|---|---|
| E-mail address | `email` claim; User principal name; `mail` attribute read through Microsoft Graph | `email` claim |
| Sign-in name | `preferred_username` claim; User principal name; E-mail address | User principal name |

The `email` claim is empty for accounts without a mailbox. When the test sign-in reports that the provider sent no e-mail address, choose User principal name as the source, or set the address of the person in Entra ID.

### Groups

Entra ID identifies groups by their object ID, so rules keep working when a group is renamed.

- When the ID token carries a `groups` claim, Lunedo uses those object IDs. Entra ID adds the claim only when it is set up under **Token configuration**, **Add groups claim** of the app registration; **Groups assigned to the application** keeps the token small. When it carries none, or Entra ID sends an overage reference instead because the person is in too many groups, Lunedo reads the groups through Microsoft Graph.
- Groups read through Graph include nested groups.
- Lunedo reads the names of the groups through Graph at sign-in and during synchronization, so names follow renames in Entra ID.
- The rule dialog searches the groups of the tenant by name, and its preview shows how many members the chosen group has in Entra ID.

When Graph cannot be reached at sign-in, the person is signed in with the groups Lunedo knew before.

### Synchronization

Entra ID providers are synchronized in the background: Lunedo updates profiles and groups of linked accounts and deactivates accounts that are disabled or deleted in Entra ID. See [Synchronization](../identity-provider-groups.md#synchronization).

### Second factor

With **Require proof from the provider**, Lunedo checks the `amr` claim of the ID token. Entra ID does not send this claim by default: add it under **Token configuration**, **Add optional claim**, token type **ID**. Entra ID reports multi-factor sign-in there as `mfa`, the default accepted value. Without it, Lunedo refuses the sign-in.

## SAML

### At Entra ID

1. In **Settings › Instance › People and sign-in › Sign-in methods**, choose **Add provider**, **SAML 2.0**, and the identity provider **Microsoft Entra ID (SAML)**. The **Connection** step shows the entity ID and the reply URL.
2. In the Microsoft Entra admin center, create an enterprise application with SAML single sign-on. Enter the **Entity ID of Lunedo** as identifier and the **Assertion consumer service URL** as reply URL.
3. Add a group claim that sends the object IDs of the groups.
4. Assign the people or groups who may use Lunedo.
5. Copy the **App Federation Metadata Url** from the section **SAML Certificates** of the single sign-on settings.

### In Lunedo

6. Enter the **Directory (tenant) ID** and the metadata address, then choose **Save and continue**.
7. Under **User attributes**, choose the source of the e-mail address: the e-mail address claim (default) or the user principal name.
8. In the step **Microsoft Graph**, enter the client ID of an app registration that has the application permissions `GroupMember.Read.All` and `User.Read.All` with admin consent, and add a client secret or certificate for it. You can skip this step and add it later in the settings.
9. Choose the settings on **Accounts**, test the sign-in and choose **Finish**.

The identifier is the tenant ID and the object ID of the person, as with OpenID Connect, so an account can move between the two presets by linking (see [First sign-in](../identity-providers.md#first-sign-in)). The sign-in name is the user principal name.

### Microsoft Graph for SAML

SAML assertions from Entra ID carry at most 150 groups. For people in more groups, Entra ID sends a link instead, and Lunedo reads the groups through Microsoft Graph. With Graph access, Lunedo also reads group names, searches groups by name in the rule dialog and synchronizes accounts in the background.

The provider lists the Graph credentials under **Credentials for Microsoft Graph**, apart from **Lunedo's signing certificate**, and each has its own add action. Without Graph access, the provider shows the warning that it cannot read groups through Microsoft Graph: accounts in more than 150 groups lose their groups and what the rules give them.

For the SAML settings that every SAML provider shares, such as metadata refresh, signed responses and encrypted assertions, see [SAML](saml.md).

### Second factor

With **Require proof from the provider**, Lunedo compares the accepted proof values with the authentication context classes of the assertion and the values of Entra ID's authentication methods claim (`http://schemas.microsoft.com/claims/authnmethodsreferences`). Entra ID sends multi-factor values such as `mfa` there only when the optional claim `amr` with the additional property `include_granular_amr` is added to the `saml2Token` optional claims in the manifest of the app registration; the admin center has no option for it. A test sign-in shows the claims Entra ID sends.

## SCIM

With SCIM, Entra ID sends new, changed and removed people and groups to Lunedo in its provisioning cycles, about every 40 minutes, without waiting for a sign-in. Whether automatic provisioning to your own application is included depends on your Entra ID licence; check Microsoft's licensing overview. See [SCIM](../scim.md) for what Lunedo does with the requests.

1. On the provider page in Lunedo, open the tab **SCIM** and choose **Create token**. Copy the token; Lunedo shows it only once.
2. In the enterprise application in Entra ID, open **Provisioning** and create a new provisioning configuration.
3. Enter the **Tenant URL** from the SCIM tab and the token as **Secret Token**, test the connection and create the configuration.
4. Under **Attribute mapping**, open the mapping for users and change these mappings:

   | Attribute in Lunedo | Source attribute in Entra ID | When |
   |---|---|---|
   | `externalId` | `objectId` | Always. Entra ID sends `mailNickname` by default. |
   | `emails[type eq "work"].value` | `userPrincipalName` | When accounts have no mailbox. Entra ID sends `mail` by default, which is empty without a mailbox. |

5. Keep the default mapping for groups, where `externalId` is the object ID of the group.
6. Under **Users and groups**, assign the people and groups to send. With the scope "Sync only assigned users and groups", Entra ID sends only those; members of nested groups are not sent.
7. Start provisioning.

Lunedo identifies people by tenant and object ID, as at sign-in. It refuses a user whose `externalId` is not an object ID, in `POST`, `PUT` and `PATCH`, stores nothing of that request, and names the sent value and this mapping in the error. A wrong value stored earlier never blocks the correct one. A user without an e-mail address is refused as well.
