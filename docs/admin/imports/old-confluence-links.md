# Old Confluence links

Imported pages and blog posts remember their Confluence IDs and titles, so links into the old Confluence keep working after the migration. An old link leads to the number address of the imported page, such as `/spaces/OPS/pages/1042/backup-rotation` (see [Content numbers and addresses](../../user/spaces-and-pages/content-addresses.md#content-numbers-and-addresses)).

## Recognized links

| Link form | Example |
| --- | --- |
| Page address with an ID (Cloud) | `/wiki/spaces/OPS/pages/123456/Backup+rotation` |
| Page editor address with an ID | `/wiki/spaces/OPS/pages/edit-v2/123456` |
| Blog post address with an ID (Cloud) | `/wiki/spaces/OPS/blog/2024/01/31/123457/Release+notes` or `/wiki/spaces/OPS/blog/123457` |
| Any address with a `pageId` parameter | `/pages/viewpage.action?pageId=123456` |
| Short link, which encodes the page ID | `/x/AbCd` |
| Data Center page path, by title | `/display/OPS/Backup+rotation` |
| Data Center blog post path, by date and title | `/display/OPS/2024/01/31/Release+notes` |

Paths by title find the page by its title at import time and the titles of later re-imports. If Confluence ran under a context path such as `/confluence` or `/wiki`, nothing changes: Lunedo finds the page in the rest of the path.

## Opening an old link

- Lunedo resolves old links at `/confluence/<old path>`, for example `https://wiki.example.com/confluence/display/OPS/Backup+rotation`.
- People can paste an old link into the command palette (**Old Confluence link**), or into the field **Paste an old Confluence link** on the page of an accepted import.

A link to a page the person cannot read answers exactly like a link to an unknown page: "This Confluence page is not here".

## Redirecting the old host name

To keep the old host name working, let a reverse proxy redirect it to `/confluence` on Lunedo. Requests keep their path and query string, and people sign in to Lunedo as usual.

Caddy:

```caddyfile
confluence.example.com {
	redir https://wiki.example.com/confluence{uri} permanent
}
```

nginx:

```nginx
server {
    listen 443 ssl;
    server_name confluence.example.com;
    ssl_certificate     /etc/ssl/confluence.example.com.crt;
    ssl_certificate_key /etc/ssl/confluence.example.com.key;
    return 301 https://wiki.example.com/confluence$request_uri;
}
```

Links to Confluence Cloud (`*.atlassian.net`) cannot be redirected, because the host belongs to Atlassian. Paste them into the command palette instead.
