# Importing through the Confluence API

Instead of an export file, Lunedo can read a space directly from Confluence Cloud or from Confluence Data Center and Server 7.9 or newer. No export is needed. Lunedo only reads; nothing changes in Confluence. For an overview of all sources, see [Imports](../imports.md).

Lunedo reads the same content an XML export contains, into the same records, so the conversion, the report and the result are the same as for an [export file](confluence-export.md). A space imported from its XML export can be re-imported through the API and the other way round, because both carry the same Confluence IDs.

## Confluence Cloud

1. In the step **Source**, choose **Confluence Cloud**.
2. In the step **Connection**, enter the **Site address** (such as `example.atlassian.net`), **Your Atlassian e-mail address** and the **API token**. Create the token at `https://id.atlassian.com/manage-profile/security/api-tokens` with **Create API token** (a token without scopes; scoped tokens only work through `api.atlassian.com`, which Lunedo does not use).
3. Choose **Test connection**. Lunedo reads the account the token belongs to and refuses a wrong token at once. Nothing is stored before the test succeeds.

Address rules:

- The site must use `https` without a port, user name or password.
- The host must end in `atlassian.net`, or be listed in **Further Atlassian sites** (see [Import settings](../imports.md#import-settings)).

People come with names and e-mail addresses from the same token and are matched to accounts by e-mail address.

## Confluence Data Center

For Confluence Data Center and Server 7.9 or newer.

1. An instance administrator adds the host of Confluence to **Further Atlassian sites** (see [Import settings](../imports.md#import-settings)).
2. In the step **Source**, choose **Confluence Data Center**.
3. In the step **Connection**, enter the **Base address**: the address you open Confluence with, including a context path, such as `https://wiki.example.com/confluence`.
4. Paste a **Personal access token**. Create it in Confluence under your avatar › Settings › Personal access tokens › **Create token**, with an account that can read every space you want to import.
5. If the server uses a certificate from your own certificate authority, open **Advanced** and paste the certificate of the authority (not the one of the server) as PEM. It is kept and deleted with the token.
6. Choose **Test connection**.

Address rules:

- The base address must use `https`. It may name a port and a context path of up to five segments.
- It must not contain a user name, password, query string or fragment.
- Its host must be listed in **Further Atlassian sites**.

Data Center does not share e-mail addresses. People come with their names and become placeholders that you map in the [report](review-and-report.md#people-and-groups) or resolve with a user list.

## Choosing spaces and page trees

The step **Selection** lists the spaces the token can read. Choose one or more.

- Each chosen space becomes an import of its own, into its own new space, with its own check, report and later re-import. Further spaces appear as drafts in the import list and share the connection and its token. Taking a space out of the selection removes its draft.
- Imports over one connection read and run one after another. A waiting import says which space goes first and continues by itself.
- For the space of the current import, the step shows the page trees below the home page with their page counts and attachment sizes. Import the whole space, or only chosen page trees. Choose the page trees of the other spaces in their own imports.
- Blog posts come only with the whole space.
- **Page history** imports every version and takes noticeably longer.

Confluence lists only what the token can read. Content that refuses to be read later is skipped and listed in the report. Space permissions and roles are read only with a token of a space administrator; otherwise the report says so. Likes and watchers are not read through the API; the report says so once per import.

## Tokens

The token is stored with envelope encryption (see [Encryption](../encryption.md)) and used only for the imports chosen with it. Lunedo deletes it:

- when the last import using it is accepted, discarded, stopped, fails or is removed;
- when the person who started the import loses the permission to import or leaves the organization;
- when every draft using it was not touched for 7 days.

A started import keeps the token while it waits for an administrator, so that another person who may import can take it over. A draft whose token was deleted says so; test the connection again to continue. The token never appears in responses, logs, error messages, job payloads, audit entries or the report.

## Network

Outgoing requests go only to the configured host, through the same protection as chat and mail deliveries:

- Addresses in private or reserved networks are refused unless `LUNEDO_OUTBOUND_ALLOWED_NETWORKS` allows them. A Data Center in your own network usually needs this (see [Configuration](../configuration.md)).
- Redirects are not followed. If Confluence answers with a redirect, enter the address Confluence really uses.
- The only exception are attachment downloads from Confluence Cloud, which Atlassian answers with a redirect to its media service `api.media.atlassian.com`. That one redirect is followed over HTTPS, without the credentials.

When Confluence asks to slow down, Lunedo waits as long as Confluence asks, up to 5 minutes per wait, and the import shows "Confluence asked to slow down". A longer pause hands the work back to the job queue, which tries again later. Only when Confluence keeps limiting after all retries does the import fail with "Confluence keeps asking to slow down"; try again later, for example outside office hours.

Reading continues after a restart with the next part of the results, never from the start.

Checked against Atlassian documentation, October 2026.
