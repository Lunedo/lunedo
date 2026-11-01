# Static website

Checked against Cloudflare, nginx and GitHub documentation, November 2026.

A public knowledge base can be downloaded as a static website: a ZIP file with plain HTML, CSS and JavaScript files that any web server can serve. The Lunedo instance stays the place where articles are edited. After changes, download a new ZIP and upload it again, by hand or with your own script ([Knowledge base export](../../api/knowledge-base-export.md) shows how to do this through the API).

## Downloading the website

The knowledge base must have the audience **Public**, because a static website has no sign-in (see [Knowledge base access](knowledge-base-access.md#audience)). Export must be switched on for the knowledge base.

1. Open **Space settings › Content › Export**.
2. Under **Static website**, optionally enter the **Address of the website**, for example `https://help.example.com/`. It is used for the sitemap and the language links; the website works at any address.
3. Click **Download as static website**.

The website is built in the background like other exports, with the same notification, download lifetime and audit entry (see [Export](../export.md)). If the audience changes before the website is built, the build fails and says that the knowledge base is no longer public.

## Content of the ZIP file

| Path | Content |
|---|---|
| `index.html` | the start page |
| `<number>-<short form>.html` | every published article that anonymous readers can read, such as `1040-set-up-the-vpn-connection.html`, with the article's number from 1000 on |
| `de/1040-vpn-verbindung-einrichten.html` | translations, in a folder per enabled language, with the number of the original |
| `topics/<number>-<short form>.html` | a page per area and topic, such as `topics/1012-vpn.html` |
| `contact.html`, `search.html` | the contact page and the search page |
| `search-index.json` | the search index |
| `de/…` | start, area, contact and search pages and the search index of each further language |
| `files/` | images and files in their display versions. Files of other types than images, audio, video, PDF, office documents, archives and plain text, such as HTML, XML or JavaScript, get an added `.txt` so that web servers send them as text; scripts and event handlers are removed from SVG images |
| `_assets/` | fonts, styles, scripts and the logo |
| `1040.html`, `1040-<earlier short form>.html` | small pages that redirect the bare number and earlier addresses of an article |
| `_redirects` | the same redirects for Cloudflare Pages and Netlify |
| `404.html` | the page for unknown addresses |
| `sitemap.xml`, `robots.txt` | only when an address of the website was entered |

Articles are rendered like in the portal, with includes from the same knowledge base and allowed embeds. With an address of the website and more than one language, the pages also carry language links for search engines.

Folders with a view restriction and their articles are never part of the website. Things that need Lunedo are left out: "Was this helpful?", reader statistics, the most-read list, frequent searches, sign-in and the account menu. The contact links stay, because they open the reader's e-mail program.

All links are relative, so the website works under any domain and in a subfolder. The search runs in the browser, searches the reader's language first and falls back to the default language with a note. It needs JavaScript and a web server: opened from a local folder, browsers do not let the page read the index, and the search page says so.

## Publishing on Cloudflare Pages

In the dashboard, open **Workers & Pages**, choose **Create application** and the option to upload your files by drag and drop. Name the project, drag the ZIP file or the unpacked folder into the upload area and deploy. Each new upload replaces the website. An upload in the dashboard takes at most 1,000 files of up to 25 MiB each; upload larger websites with Wrangler.

With Wrangler, which takes only the unpacked folder and up to 20,000 files:

```sh
unzip "IT Help 2026-10-20.zip" -d site
npx wrangler pages deploy site --project-name=it-help
```

Cloudflare Pages reads `_redirects` and `404.html` by itself and serves `/1040-set-up-the-vpn-connection` for `1040-set-up-the-vpn-connection.html`.

`_redirects` holds two rules for each redirected address, one with and one without `.html`. Cloudflare Pages takes at most 2,000 such rules. The HTML redirect pages are part of the website in any case.

## Any web server

Copy the unpacked folder to the web server's document root or a subfolder. Without further settings, the website works with its `.html` addresses and the HTML redirect pages. To serve addresses without `.html` and the `404.html` page with nginx, for a website in the subfolder `/help/`:

```nginx
location /help/ {
    try_files $uri $uri.html $uri/index.html =404;
    error_page 404 /help/404.html;
}
```

On GitHub Pages, publishing from a branch runs Jekyll, which leaves out folders whose names start with an underscore, such as `_assets/`. Add an empty file `.nojekyll` next to `index.html`, or publish with a GitHub Actions workflow. GitHub Pages does not read `_redirects`; earlier addresses work through the HTML redirect pages.
