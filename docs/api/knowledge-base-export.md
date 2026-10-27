# Export a knowledge base as a static website

A script can rebuild the static website of a public knowledge base, for example every night, and publish it on any web server. [Static website](../user/knowledge-base-static-website.md) describes what the website contains and how to publish it by hand. The full reference of the routes is at `/api/docs` on your instance.

## Before you start

- The knowledge base must have the audience "public". Other knowledge bases are refused with `staticSiteNotPublic`, because a static website has no sign-in.
- Exporting a space needs a person's account with a role in the knowledge base: its space admin, or a member whose organization role manages spaces. Guests and service accounts cannot export spaces.
- Create a personal token for that person with the organization area `spaces` at `view` and the content level `read`; see [Getting started](getting-started.md#create-a-personal-token).
- You need the ID of the knowledge base. `GET /api/v1/spaces?type=knowledgeBase` lists the knowledge bases the token can read.

## Steps

1. Start the export with `format: "site"`. Give `siteUrl`, the address the website will be served from, to get `sitemap.xml`, `robots.txt` and language links for search engines:

   ```sh
   EXPORT=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"format": "site", "siteUrl": "https://help.example.com/"}' \
     https://wiki.example.com/api/v1/spaces/$SPACE/exports | jq -r .id)
   ```

2. Wait until the export is built. `state` goes from `queued` and `running` to `ready` or `failed`:

   ```sh
   while :; do
     STATE=$(curl -s -H "Authorization: Bearer $TOKEN" https://wiki.example.com/api/v1/exports/$EXPORT | jq -r .state)
     [ "$STATE" = ready ] && break
     [ "$STATE" = failed ] && exit 1
     sleep 10
   done
   ```

3. Download the ZIP file:

   ```sh
   curl -s -H "Authorization: Bearer $TOKEN" -o site.zip https://wiki.example.com/api/v1/exports/$EXPORT/content
   ```

4. Unpack it and publish the folder, for example on Cloudflare Pages:

   ```sh
   unzip -o site.zip -d site
   npx wrangler pages deploy site --project-name=help
   ```

Articles lie in the ZIP as `<number>-<slug>.html`, for example `1042-set-up-the-vpn-connection.html`, with translations in a folder per language such as `de/`.

## When the export fails

A failed export names the reason in `errorCode` of `GET /api/v1/exports/{exportId}`:

| `errorCode` | Meaning |
|---|---|
| `notPublic` | The audience of the knowledge base changed while the website waited to be built. |
| `noAccess` | The person lost the permission to export the space. |
| `tokenRevoked` | The token that started the export was revoked. |
| `exportDisabled` | A space admin turned export off for the space. |
| `notEnoughStorage` | The file store ran short of free space. |
| `interrupted` | The worker was interrupted too often. |

Starting an export can also be refused:

| Problem | Meaning |
|---|---|
| `staticSiteNotPublic` | The knowledge base is not public. |
| `exportRunning` | The person runs another export. Each person runs one export at a time. |
| `tooManyExports` | The person keeps five finished exports. Delete one under **Settings › My account › My exports**, or with `DELETE /api/v1/exports/{exportId}`, which needs a token with the area `spaces` at `manage`. |
| `exportDisabled` | Export is turned off for the space. |
| `notEnoughStorage` | The file store is too full for the export. |

A new export of the same space in the same format replaces the earlier one, so a nightly script does not pile up exports. A finished export is kept for 7 days, or 24 hours after its first complete download.
