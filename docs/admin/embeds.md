# Allowing external embeds

An external embed shows a video, design, presentation or document of another service inside a page (see [Embeds, file previews, tabs and whiteboard blocks](../user/blocks/embeds-and-blocks.md)). Pages embed content only from services on the embed allowlist. An address that is not on the list appears as a link with a short hint.

The list has two levels:

| Level | Where | Who | Setting key |
| --- | --- | --- | --- |
| Instance | **Settings › Instance › Services › External embeds** | Instance administrators | `embeds.services` |
| Organization | **Settings › Organization › Content › Pages and trash**, panel **External embeds allowlist** | Organization administrators | `embeds.allowedServices` |

The instance list defines the services and their rules. An organization can only narrow it, never extend it. There is no further level per space.

Changes apply at once. When a service is added, its embeds show the frame without editing the pages; when a service is removed, its embeds turn back into links. The reader's browser loads the content directly from the service.

## Default services

The default instance list allows:

- YouTube, through the privacy-enhanced domain `youtube-nocookie.com`
- Vimeo, with `dnt=1`
- Loom
- Figma
- Miro
- Google Docs, Slides and Sheets
- Microsoft Stream and SharePoint

**Add a default service back** restores a default service that was removed.

## Narrowing the list for an organization

By default an organization allows all services of the instance. To narrow the list, clear the services the organization should not embed. A narrowed list keeps its own value: a service the instance adds later is not added to it. **Allow all services of the instance** returns to the instance list.

## Services and rules

The instance list holds up to 50 services. Each service has a name and up to 20 rules. A rule has:

- an **Address pattern** for share links, up to 500 characters;
- an **Embed address** built from it. Leave it empty to embed the link as it is;
- the **Address sent to the service**.

Patterns are `https` addresses that end with a fixed domain. Placeholders fill whole parts of the address:

| Placeholder | Stands for |
|---|---|
| `{name}` | One part: a label at the start of the host, one path segment or the value of a query parameter |
| `{*}` | Any number of path segments, once per pattern |
| `{url}` | In the embed address only: the whole link, encoded |

Examples:

| Pattern | Embed address |
|---|---|
| `https://www.youtube.com/watch?v={video}` | `https://www.youtube-nocookie.com/embed/{video}` |
| `https://www.figma.com/design/{file}/{*}` | `https://www.figma.com/embed?embed_host=lunedo&url={url}` |
| `https://{tenant}.sharepoint.com/{*}/_layouts/15/embed.aspx?UniqueId={file}` | The same address |

For SharePoint and Stream, paste the address from the embed code that SharePoint offers, not the share link.

Captured values are decoded and encoded again for the embed address. Values that are dot segments or contain slashes are refused, so a link cannot point the frame to another path of the service. Frame markup is never stored.

### Address sent to the service

- **Nothing (recommended)** (`no-referrer`, the default): the service learns nothing about the page that embeds it.
- **Address of this instance** (`strict-origin`): the frame sends only the origin of the instance, such as `https://wiki.example.com/`, never the path of the page, and nothing at all to a service without `https`. Some video services refuse to play without it. The default YouTube rules use it, because YouTube rejects many embeds that send no referrer.

## Security

- Frames run with `sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation"`, `allow="fullscreen; picture-in-picture; encrypted-media"` and the referrer policy of the matching rule. The service runs in its own origin and cannot reach the page, the session or other frames.
- The web client sends `Content-Security-Policy: frame-src 'self' …` with the origins of all embed addresses of the instance list, so the browser refuses frames from any other origin even if a page contained one.
- A frame loads only when it comes close to the visible part of the page, so opening a long page sends nothing to the services further down.

The embed allowlist also decides how Confluence Widget Connector, Lucidchart and Miro macros are imported (see [What Lunedo takes over from Confluence](imports/confluence-reference.md#macros)) and which embeds knowledge base portals show.
