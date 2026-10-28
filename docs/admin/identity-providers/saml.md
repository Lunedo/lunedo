# SAML

Checked against Microsoft Entra and AD FS documentation, October 2026.

Use **SAML 2.0** for identity providers such as Active Directory Federation Services (ADFS), Shibboleth or Microsoft Entra ID. Lunedo is the service provider. Profile and groups update at every sign-in; SAML has no directory Lunedo could synchronize with in the background. With [SCIM](scim.md), the provider can send changes at once.

The assistant offers three presets under **Identity provider**: Microsoft Entra ID (SAML), Active Directory Federation Services and Other SAML provider. For Entra ID, see [Microsoft Entra ID](entra-id.md#saml); this page describes the settings every SAML provider shares, and ADFS and other providers. What all providers share, such as domains, credentials, testing and the first sign-in, is described in [Identity providers](../identity-providers.md).

## Values for the identity provider

The **Connection** step shows what to enter at the identity provider, with the instance URL `https://wiki.example.com`:

| Value in Lunedo | Also called | Address |
|---|---|---|
| Entity ID of Lunedo | identifier, audience | `https://wiki.example.com/api/v1/auth/providers/{provider ID}/saml/metadata` |
| Assertion consumer service URL | reply URL | `https://wiki.example.com/api/v1/auth/providers/{provider ID}/saml/acs` |
| Metadata address of Lunedo | | the same address as the entity ID |
| Lunedo's signing certificate | | **Download metadata** or download the certificate |

Most identity providers can read Lunedo's metadata address or the downloaded file, so you do not have to enter the values by hand. Lunedo signs its authentication requests with its signing certificate (SHA-256). Upload the certificate at the identity provider if it checks signed requests.

## Metadata of the identity provider

Lunedo needs the metadata of the identity provider: its entity ID, its sign-in address and its signing certificates. Choose the **Metadata source**:

- **Metadata address**: an address starting with `https://`. Lunedo loads the metadata again every day and picks up new certificates of the identity provider by itself. **Load again** loads it at once.
- **Uploaded file**: the XML file with the metadata, at most 1 MB. Upload a new file whenever a certificate of the identity provider changes.

The provider page shows the entity ID, the sign-in address, the signing certificates with fingerprint and expiry, and when the metadata was last loaded. When a daily refresh fails, Lunedo keeps using the last good metadata, the provider list shows a warning with the error, and the failure is recorded in the [audit log](../audit-log.md). Check the metadata address, or upload the file again.

Until metadata is loaded, nobody can sign in through the provider.

## Security settings

| Setting | Default | Effect |
|---|---|---|
| Require a signed response | Off | The assertion must always be signed. With this setting, the whole response must be signed as well. Entra ID signs only the assertion by default; choose the signing option **Sign SAML response and assertion** there. In ADFS, run `Set-AdfsRelyingPartyTrust -TargetName <trust> -SamlResponseSignature MessageAndAssertion`. |
| Require encrypted assertions | Off | The identity provider encrypts the assertion with Lunedo's certificate from the metadata. Turn it on only after the identity provider is set up for it, or sign-in stops working. |
| Allow sign-in started at the identity provider | Off | Lets people start from a portal of the identity provider, such as the Microsoft app launcher. Such a sign-in cannot be tied to a request from the browser, so an attacker could sign someone into the attacker's account. It also needs the instance URL to be set. |

Lunedo further checks every response:

- Signatures and digests must use SHA-256 or stronger; SHA-1 is refused.
- The response must answer the request Lunedo sent, unless sign-in started at the identity provider is allowed, be addressed to Lunedo's assertion consumer service URL and contain exactly one assertion.
- The assertion must come from the identity provider's entity ID, be valid at the time of sign-in, with a tolerance of two minutes for clock differences, and be meant for Lunedo.
- Each assertion is accepted once.
- A response that arrives without a sign-in started in Lunedo is checked completely when it arrives. Lunedo keeps it only if it passes every check above; otherwise the sign-in page shows that the identity provider answered in an unexpected way.

With **Require proof from the provider**, Lunedo compares the accepted proof values with the authentication context classes of the assertion.

## Renewing Lunedo's signing certificate

1. Under **Credentials**, choose **Add signing certificate**. Lunedo creates a new key pair, and its metadata lists the new certificate at once.
2. Let the identity provider load Lunedo's metadata again, or download the certificate and add it there.
3. Once the identity provider uses the new certificate, remove the old one.

## ADFS

1. Choose **SAML 2.0** and the identity provider **Active Directory Federation Services**. Enter the federation metadata address of ADFS, usually `https://adfs.example.com/FederationMetadata/2007-06/FederationMetadata.xml`, with the name of the ADFS farm, not of a single server.
2. In ADFS Management, choose **Add Relying Party Trust**, choose **Claims aware**, and let the wizard import the data about the relying party from Lunedo's metadata address.
3. In the claim issuance policy of the trust, add a rule with the template **Send LDAP Attributes as Claims** and the attribute store Active Directory that sends the attributes below. `objectGUID` is usually not in the list of LDAP attributes; type it, and type `objectGUID` as the outgoing claim type.
4. Choose **Save and continue**, check the attributes, and test the sign-in.

| Setting in Lunedo | Default claim type |
|---|---|
| Attribute for the identifier | `objectGUID` |
| Attribute for the e-mail address | `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress` |
| Attribute for the sign-in name | `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn` |
| Attribute for the display name | `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name` |
| Attribute for groups | `http://schemas.microsoft.com/ws/2008/06/identity/claims/groupsid` |

The identifier is the person's `objectGUID`. ADFS sends it as Base64 text; Lunedo converts it to the usual GUID form, so the identifier matches the one an Active Directory provider uses.

Groups come as SIDs by default: in the same rule, map the LDAP attribute "Token-Groups as SIDs" to the outgoing claim type Group SID. SIDs stay the same when a group is renamed. Group names ("Token-Groups - Unqualified Names") remain possible with **Group values** set to names; then renaming a group in Active Directory breaks the rules for it.

## Other SAML providers

1. Choose **SAML 2.0** and the identity provider **Other SAML provider**, and enter the metadata address or upload the metadata file.
2. At the identity provider, create a SAML service provider with Lunedo's entity ID and assertion consumer service URL, or let it read Lunedo's metadata.
3. Configure the attributes in Lunedo:

| Setting | Default | Notes |
|---|---|---|
| Attribute for the identifier | empty | An attribute that never changes for a person. Leave it empty to use the persistent NameID; the assertion must then carry a NameID of the format `persistent`. |
| Attribute for the e-mail address | `email` | Required. |
| Attribute for the sign-in name | empty | Optional. |
| Attribute for the display name | empty | Optional. |
| Attribute for groups | empty | Optional. |
| Group values | Names | Whether the groups attribute carries identifiers or names. |

When the group values are names, the rule list and the rule dialog warn that renaming a group at the identity provider breaks the rules for it. Use identifiers if the identity provider can send them.

When a groups attribute is set and an assertion does not carry it, the person counts as having no groups, and instance administrators see a banner once the provider stops sending the attribute (see [Identity provider groups](identity-provider-groups.md#groups)).
