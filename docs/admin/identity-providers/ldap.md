# LDAP and Active Directory

With an LDAP provider, people sign in on the Lunedo sign-in page with their directory password. Lunedo looks them up with a service account, checks the password with the directory, reads their groups, and synchronizes groups and account status in the background. Lunedo never changes directory passwords.

The assistant offers two presets under **Directory**: **Active Directory** and **Other LDAP directory**, for example OpenLDAP or FreeIPA. What all providers share, such as domains, credentials and the first sign-in, is described in [Identity providers](../identity-providers.md). Groups and mapping rules are described in [Identity provider groups](../identity-provider-groups.md).

## Before you start

Create a service account in the directory that may read people and groups. It needs no other rights.

## Connecting the directory

1. In **Settings › Instance › People and sign-in › Sign-in methods**, choose **Add provider** and **LDAP or Active Directory**, then choose the directory.
2. Enter the connection:

   | Field | Notes |
   |---|---|
   | Server address | For example `ldaps://dc01.example.com`. A server name alone, such as `dc01.example.com`, means `ldaps://dc01.example.com:636`, and Lunedo stores and shows it in that form. No path. |
   | Use StartTLS | Only for `ldap://` addresses: encrypts the connection before any password is sent. `ldaps://` is encrypted already. |
   | Service account | The account Lunedo uses to look people up. |
   | Password of the service account | Stored encrypted and used only to search the directory. |
   | Base DN for people | The part of the directory that holds the people who may sign in, for example `OU=Staff,DC=example,DC=com`. Lunedo also searches everything below it. |
   | Base DN for groups | The part of the directory that holds the groups, for example `OU=Groups,DC=example,DC=com`. Lunedo also searches everything below it. |
   | Filter for people, Filter for groups | Which entries count as people and groups. The suggested values fit most directories. |
   | CA certificate | Optional. Needed when the server certificate was issued by your own certificate authority. |

3. Choose **Save and continue**. Lunedo connects to the directory before saving. When this fails, the message says whether the server, its certificate, the service account or the search for people failed.
4. Choose the sign-in name and the attributes under **User attributes**, and the settings on **Accounts**. Enter the domains of the e-mail addresses and sign-in names in the directory.
5. Test the directory and choose **Finish**.

Plain `ldap://` without StartTLS is refused, so passwords never travel unencrypted. Connections use TLS 1.2 or newer, and the server certificate must match the server name. Connecting has a timeout of 10 seconds, each directory operation one of 20 seconds.

### CA certificate

Without a CA certificate, Lunedo trusts only public certificate authorities. To trust your own, choose **Upload CA certificate** in the connection settings of the provider or in the test step:

- Upload the certificate of the certificate authority in PEM format, not the certificate of the server. A file can hold up to 20 certificates, for example an intermediate and a root.
- 30 days before the CA certificate expires, the provider list warns. Upload the new certificate before then, or Lunedo can no longer connect.
- **Remove CA certificate** returns to public authorities only. If the directory uses a certificate of your own authority, sign-in and synchronization stop working.

## Active Directory

| Setting | Default | Notes |
|---|---|---|
| Service account | | A distinguished name, a user principal name such as `svc-lunedo@example.com`, or `EXAMPLE\svc-lunedo`. Lunedo sends the name exactly as entered, and a refused service account is reported with that name. |
| Filter for people | `(&(objectCategory=person)(objectClass=user))` | |
| Filter for groups | `(objectClass=group)` | |
| Sign-in name | User principal name | Or the Windows user name (`sAMAccountName`), or the e-mail address. |
| Attribute for the e-mail address | `mail` | |
| Attribute for the display name | `displayName` | Falls back to `cn`. |

People and groups are identified by their `objectGUID`. Group memberships include nested groups. Group names come from `cn`.

An account counts as disabled when it is disabled in Active Directory or its expiry date (`accountExpires`) has passed.

When Active Directory refuses a password because it has expired, must be changed, the account is locked or disabled, or the person may not sign in at this time, the sign-in page tells the person so and what to do. Control characters in messages of the directory, such as the null byte Active Directory appends, are removed before they are stored or shown.

## OpenLDAP and other directories

| Setting | Default | Notes |
|---|---|---|
| Service account | | A distinguished name, for example `CN=lunedo,OU=Service,DC=example,DC=com`. |
| Filter for people | `(objectClass=inetOrgPerson)` | |
| Filter for groups | `(\|(objectClass=groupOfNames)(objectClass=groupOfUniqueNames))` | |
| Sign-in name | E-mail address | Or the user name (`uid`). |
| Attribute for the e-mail address | `mail` | |
| Attribute for the sign-in name | `uid` | |
| Attribute for the display name | `cn` | |
| Attribute for group names | `cn` | |
| Group membership | `member` attribute of the group | Or the `memberOf` attribute of the person. |
| Attribute for disabled accounts | none | Optional. |
| Values that mean disabled | none | Up to 20 values, separated by commas. Without values, any value of the attribute means disabled. |

People and groups are identified by their `entryUUID`. With **Group membership** set to the `member` attribute, Lunedo finds groups whose `member` or `uniqueMember` holds the person. Nested groups count, up to ten levels.

Without **Attribute for disabled accounts**, Lunedo deactivates an account only when the person no longer exists under the base DN for people.

## User attributes

Under **User attributes**, enter the sign-in name of a test person and choose **Read attributes**. Lunedo reads every attribute the directory returns for this person and offers them for the e-mail address, sign-in name and display name, with the value of the test person. Without a test person, Lunedo reads the first person the directory returns. Passwords and binary values are never shown.

## Signing in

On the sign-in page, people enter their e-mail address first. When its domain belongs to the directory, the page asks for the sign-in name at the directory and the password. Lunedo finds exactly one person with the sign-in name under the base DN and filter for people and checks the password with the directory.

Lunedo's own attempt limits and lockouts apply before the directory is asked (see [Authentication](../authentication.md#rate-limits-and-lockouts)). Accounts without a Lunedo password confirm sensitive actions with their directory password.

## Testing the directory

**Test the directory** connects with the service account and searches for a person. Enter the sign-in name of a test person, or leave it empty to use the first person found. Nothing is saved and no account is created. The test shows the person found, the groups and the attributes the directory returned.

| Check | When it fails |
|---|---|
| Connection to the server | Check the server address, the port and the firewall between Lunedo and the directory. |
| Server certificate | Upload the CA certificate that issued the server's certificate. |
| Service account | Check the name of the service account exactly as shown in the message, and its password. |
| Search for people | Check the base DNs and the filters. |

## Synchronization

LDAP providers are synchronized in the background: each run reads the people under the base DN for people, updates profiles and groups of linked accounts, and deactivates accounts that are disabled or no longer found. A base DN for people or groups that does not exist fails the run instead of returning no entries, so a moved unit never looks as if everyone left. See [Synchronization](../identity-provider-groups.md#synchronization).

## Second factor

A directory password proves no second factor. The provider setting **Second factor after a sign-in through this provider** offers:

- **Always ask for a Lunedo second factor** (default): after every sign-in with the directory password, Lunedo asks for its own second factor; people without one set one up first.
- **No additional second factor**: Lunedo still asks for one where the instance or an organization requires it.
