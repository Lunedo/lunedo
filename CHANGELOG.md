# Changelog

What changed for the people who run and use Lunedo. Each release lists its changes in the groups New, Improved, Fixed, Breaking changes and Manual steps. A release that cannot be reached from every earlier version says from which version to update. The admin area and the update command read this file; [docs/development/changelog.md](docs/development/changelog.md) describes the format.


## 0.1.0 · 2026-11-01

The first release of Lunedo.

### New

- Spaces and pages: every organization keeps its content in spaces, each with a tree of pages, folders, links and whiteboards. Every item has a number from one sequence for the whole instance, and its address stays valid when it is renamed or moved.
- Editor: pages, blog posts and templates are made of blocks such as headings, lists, tables, tabs, embeds, file previews and reports, inserted with `/`.
- Editing together: people who edit the same page, blog post or whiteboard work on one shared document and see each other's changes and cursors as they type.
- Publishing: in publish mode readers see the last published version while editors work on a draft; in live mode they see every change at once. A page status such as "In progress" or "Verified" tells readers how far a page is.
- Owners, trash and archive: content has an owner who keeps it up to date. Deleted content can be restored from the trash for a while, and archived content stays readable but read-only.
- Copying pages, folders and whiteboards within a space or into another space of the same organization.
- Sharing and restrictions: share a page with people and groups outside its space, create share links, or restrict who may view or edit it. Confidential spaces are readable only by their members; administrators cannot give themselves access.
- Blog: every space except a knowledge base has a blog for news and announcements.
- Meetings: meeting series with meeting notes, topics on the agenda and decisions that appear in the decision log; tasks with assignees and due dates in pages.
- Diagrams and whiteboards: draw.io, Mermaid and PlantUML diagrams in pages, and Excalidraw whiteboards and drawings. The instance serves everything the editors need, so they work without internet access.
- Reports and reuse: page properties, label, page, decision and task reports, child page and attachment lists, and content reused on several pages. Every report shows only what the viewer may read.
- Templates: built-in templates in English and German, own templates for the instance, an organization or a space, and template files to share them between instances.
- Knowledge bases: articles in areas and topics, written in the normal editor and read in a portal of their own at `/help/<path>/`, with an audience, translations, regular reviews and a download as a static website.
- Search over everything a person may read, with filters and counts per filter.
- Notifications in the app, by e-mail and as browser push messages, chosen per kind of event, and chat channels to Microsoft Teams, Slack, Discord, Matrix or any webhook.
- Export of a page, a page with its subpages or a whole space as PDF, Word, HTML or Markdown.
- Imports of Confluence spaces from an export file or through the Confluence API, of Markdown folders and of Word documents. Every import lands in a quarantine space for review first, comes with a report and can be repeated later to take over newer content.
- Sign-in with password and a second factor (authenticator app, passkey, recovery codes) or with a passkey alone, and through identity providers: Microsoft Entra ID, Google Workspace and other OpenID Connect providers, SAML 2.0 and LDAP or Active Directory, with provider groups and SCIM. Accounts linked to a provider are managed by it and sign in only through it.
- Organizations with members, guests, groups, invitations and roles, and service accounts with API tokens for scripts and integrations.
- An HTTP API for scripts and integrations, described on every instance at `/api/docs`.
- Installation with a setup script and Docker Compose, a setup assistant with a system check, and setup through configuration.
- Operation: a system status page, maintenance mode, an update check with the changes of new versions, Prometheus metrics and health endpoints, and an audit log of every action that affects security, access or configuration.
- Encrypted backups on a schedule to a directory or S3-compatible storage, with test restores, and a backup before every update.
- Encryption of stored secrets, files and backups, with key rotation. Files are kept in a local directory or in S3-compatible storage.
- E-mail through SMTP, Microsoft 365 or Google Workspace.
