# Content addresses

Every item in a space has a number, and its address in the app is built from that number. Addresses stay valid when an item is renamed or moved.

## Content numbers and addresses

Every item of a space has a **number**: pages, folders, links, blog posts, whiteboards, meeting series and meeting topics. Numbers come from one sequence for the whole instance that starts at 1000, so no two items share a number, whatever their space or organization.

- A number is never reused and does not change when the item is renamed or moved.
- A copy gets a new number.
- An item restored from the trash keeps its number.
- Restoring a backup keeps all numbers and the sequence.

Links in the page tree have a number but no address of their own; opening a link opens its target.

Addresses in the app contain the space key, the type, the number and a short form of the title. The examples use the space key `ITOPS`:

| Item | Address |
|---|---|
| Space | `/spaces/ITOPS` (opens the overview page) |
| Page | `/spaces/ITOPS/pages/1040/network-plan` |
| Page history | `/spaces/ITOPS/pages/1040/history` |
| Folder | `/spaces/ITOPS/folders/1012/locations` |
| Blog post | `/spaces/ITOPS/blog/1077/new-vpn-gateway` |
| Whiteboard | `/spaces/ITOPS/whiteboards/1093/rack-layout` |
| Whiteboard history | `/spaces/ITOPS/whiteboards/1093/history` |
| Meeting series | `/spaces/ITOPS/meetings/1101/weekly-operations` |
| Meeting topic | `/spaces/ITOPS/topics/1105/firewall-change` |
| Page, blog post or whiteboard that a person sees only through a share | `/shared/1040/network-plan` |
| Pages with a label | `/spaces/ITOPS/labels/network` |

The number alone identifies the item. When the space key, the type or the short form in an address is wrong or outdated, the app replaces the address with the current one without an extra entry in the browser history. Renames and moves therefore keep links working, and `/spaces/ITOPS/pages/1040` without a short form works too.

Articles of a knowledge base have their own addresses in the portal; see [The knowledge base portal](knowledge-base-portal.md).

### Short forms of titles

The short form of a title is the same everywhere in the app and the knowledge base portal, whatever the language:

1. `ä`, `ö` and `ü` become `ae`, `oe` and `ue`, also in upper case. `ß` and `ẞ` become `ss`.
2. `ø`, `đ`, `ł` and `ħ` become `o`, `d`, `l` and `h`, also in upper case, and the dotless `ı` becomes `i`.
3. Other diacritics on Latin letters are removed: `è` becomes `e`, `ź` becomes `z`.
4. Letters of other scripts, such as Cyrillic, Greek or Chinese, stay as they are.
5. Everything that is not a letter or digit becomes a hyphen. Repeated hyphens collapse into one, and no hyphen stays at the start or end.
6. The result is lower case and at most 80 characters long, cut at a hyphen where possible.

Examples:

| Title | Short form |
|---|---|
| Flüghäfen & Co. (Wien) | `flueghaefen-co-wien` |
| Łódź – Øresund | `lodz-oresund` |
| Straße 7 | `strasse-7` |

A title without any letter or digit has no short form; its address ends with the number.

Heading anchors follow the same rule, for example `#network-plan` for a heading "Network plan". A heading without letters or digits gets the anchor `#section`. When a page has several headings with the same anchor, the second gets `-2`, the third `-3`, and so on.

### Opening an item by its number

Enter only a number, such as `1040` or `#1040`, in the search:

- The quick search shows the item first, under **Open by number**.
- Pressing Enter on the search page opens the item if you can read it; otherwise the search runs normally.

The API finds items by number as well, with `GET /api/v1/items/by-number/{number}`; see [Spaces and pages in the API](../api/spaces-and-pages.md). A number you cannot read and a number that does not exist give the same answer.
