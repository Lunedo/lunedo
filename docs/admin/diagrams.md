# Diagrams on the server

Pages can contain draw.io, Mermaid and PlantUML diagrams (see [Diagrams](../user/blocks/diagrams.md)). Everything these blocks need is served by the instance itself. They work without internet access, diagrams never leave the server, and there is nothing to install or configure.

## draw.io

Lunedo ships draw.io **31.4.6** unchanged, except for its configuration files, and serves it under `/drawio/31.4.6/`. The web build downloads the release archive from GitHub, checks its SHA-256 against the pinned value and leaves out the server parts, cloud connectors, plugins and source maps. The instance never contacts diagrams.net.

**Settings › Instance › Services › Rendering** shows the shipped version under **draw.io editor**.

The icon sets and shape libraries of draw.io come with an additional condition from their authors: they may not be used in Atlassian products or the Atlassian Marketplace. Lunedo is neither; diagrams created with them are not affected.

## Mermaid and PlantUML

Mermaid and PlantUML diagrams are rendered in the browser of the person who saves them. PlantUML uses the official JavaScript build of PlantUML (`@plantuml/core`, MIT). The instance needs no Java, no Graphviz and no render service, and the optional [render container](rendering.md) is not involved. Exports, the print view and search use the stored image.

Where no browser can render, for example in an export of a diagram that was imported and never saved, the block shows its source with a note instead of an image.

## Security

- Diagram images are sanitized on the server before they are stored: scripts, event handlers, links, external resources and unknown elements are removed. Labels of draw.io diagrams keep simple formatting. Mermaid and PlantUML images may not contain HTML.
- Images are served like other SVG files (`Content-Security-Policy: sandbox`, `X-Content-Type-Options: nosniff`) and shown as images, never inline.
- draw.io files are checked against the elements draw.io writes. Compressed pages are stored uncompressed, event handlers and links other than web, mail and page links are removed, and document type declarations are refused.
- The draw.io editor runs in a sandboxed frame without access to the session. Its content security policy allows connections only to the instance and no other frames. It starts with cloud storage, plugins, update checks, sharing and telemetry switched off.
- Mermaid and PlantUML render in a hidden sandboxed frame (`/diagram.html`) without access to the session and without any network access. Mermaid runs with `securityLevel: "strict"`: no HTML labels, no click handlers, no scripts.
- PlantUML refuses `!include` and its variants, `!import`, `!theme … from`, `%load_json`, `%getenv`, `%getallenv`, `%file_exists`, `%dirpath` and `%filename` before rendering. The standard themes of PlantUML are available; its standard library is not.
- People who cannot read a page cannot fetch its diagram files or images.

## Limits

| What | Limit |
| --- | --- |
| draw.io file | 4 MiB, 50,000 elements, 300,000 attributes, 1,000 pages |
| draw.io image | 10 MiB, 20,000 × 20,000 pixels |
| Mermaid or PlantUML source | 50,000 characters |
| Mermaid or PlantUML image | 2 MiB, 20,000 × 20,000 pixels |
| Mermaid or PlantUML rendering | 10 seconds |
| Opening the draw.io editor | 60 seconds |
| Saving the image from the draw.io editor | 30 seconds |

The organization's **Largest file to upload** applies as for every attachment (see [Storage](storage.md)).

The diagram routes of the API are described in [Diagrams and whiteboards in the API](../api/diagrams-and-whiteboards.md).
