# Imports

Routes behind the import wizard: a Confluence space from an export file or through the Confluence API, a folder of Markdown files, or Word documents, each into a new space that stays in quarantine until it is accepted. [Imports](../admin/imports.md) describes the flow and the sources in the interface. The full reference, with every field, is at `/api/docs` on your instance.

## Who can use them

Importing needs the organization area `spaces` with `manage`. The person who starts an import runs it; reviewers read the quarantine space and the report.

API tokens need the organization scope `spaces` with `manage` for every step that starts, changes or decides an import. Reading an import, its report, people, groups and changes works with any organization scope. A token bound to an organization works only for imports of that organization; a token limited to drafts or to single knowledge bases cannot run imports. A token without the scope is refused with `forbidden` and the denial `tokenScope`. As with a session, a token only acts on imports its owner runs, reviews or may take over.

## Flow

| Step | Route | Token scope |
|---|---|---|
| 1. Start a draft with the `source` | `POST /api/v1/organizations/{organizationId}/imports` | spaces: manage |
| 2. Upload the file in parts, or list the import folder | `POST …/import-uploads`, `PUT …/import-uploads/{uploadId}/parts/{number}`, `POST …/import-uploads/{uploadId}/complete`; `GET …/import-folder` | spaces: manage |
| 3. Choose the file, the space name and key and the options | `PATCH /api/v1/imports/{importId}` | spaces: manage |
| 4. For the Confluence API: connect and choose the spaces | `PUT /api/v1/imports/{importId}/connection`, `…/connection/selection` | spaces: manage |
| 5. For a Confluence export: choose how people are recognized | `PUT /api/v1/imports/{importId}/people-source` | spaces: manage |
| 6. Wait until `state` is `ready`, then start | `GET /api/v1/imports/{importId}`, `POST …/start` | spaces: manage |
| 7. Follow the progress and read the report | `GET /api/v1/imports/{importId}`, `…/report`, `…/report/entries`, `…/report/export` | any organization scope |
| 8. Map people and groups, then accept or discard | `POST …/people/mappings`, `PUT …/groups/{groupKey}`, `POST …/accept`, `POST …/discard` | spaces: manage |

`source` is `confluence-xml`, `confluence-csv`, `confluence-cloud`, `confluence-dc`, `markdown` or `word`. `GET /api/v1/organizations/{organizationId}/imports` lists the imports the caller runs or reviews.

## Uploading a file

Large exports are uploaded in parts, so an interrupted upload continues without sending finished parts again.

1. Start the upload with the file's name and size in bytes:

   ```sh
   curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"name": "export.zip", "size": 734003200}' \
     https://wiki.example.com/api/v1/organizations/$ORG/import-uploads
   ```

   The answer has the upload's `id`, `partSize` (16 MiB) and `partCount`.

2. Send each part as `application/octet-stream`, numbered from 1, with its SHA-256 in hexadecimal. Every part except the last has exactly `partSize` bytes. Sending a part again replaces it.

   ```sh
   curl -s -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/octet-stream" \
     --data-binary @part-1 \
     "https://wiki.example.com/api/v1/organizations/$ORG/import-uploads/$UPLOAD/parts/1?sha256=$PART_SHA256"
   ```

3. Complete the upload with the SHA-256 over the hexadecimal SHA-256 values of all parts, joined in order. The server reads every part again and compares.

   ```sh
   curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d "{\"sha256\": \"$TOTAL_SHA256\"}" \
     https://wiki.example.com/api/v1/organizations/$ORG/import-uploads/$UPLOAD/complete
   ```

`GET …/import-uploads/{uploadId}` lists the parts already stored, to continue after a lost connection. An upload that no import uses is deleted after 7 days.

Uploads above the instance's upload limit (**Largest export to upload**, default 2 GiB) are refused before any part is sent with `uploadTooLarge`, and uploads beyond the organization's limit (**Import storage per organization**, default 20 GiB) with `organizationImportLimit`. For larger files, the server's import folder is the fallback; see [Imports](../admin/imports.md).

## States

`state` of an import is `draft`, `analyzing` (the export is read), `ready`, `running`, `held` (the person who started it lost the permission, and another administrator has to take over), `stopping` or `discarding`, `review` (the quarantine space waits for a decision), and at the end `accepted`, `discarded`, `stopped` or `failed`. `phase` names the step a running import is in.

Discarding and stopping need the key of the space typed as `confirmation`.

## Old Confluence links

`GET /api/v1/confluence-links?url=` finds the page imported from an old Confluence address. A link to a page the caller cannot read gives the same answer as an unknown link, `404`. See [Old Confluence links](../admin/imports/old-confluence-links.md).

## Re-imports

A re-import of a space that an earlier import created starts with `POST /api/v1/organizations/{organizationId}/imports` and the `spaceId` of that space. Its changes are listed, compared and applied with the routes under `/api/v1/imports/{importId}/changes`. See [Re-import](../admin/imports/reimport.md).
