# Knowledge base portals

Readers open a knowledge base in its portal, a lean site without the navigation and editor of the app (see [Knowledge base portal](../user/knowledge-bases/knowledge-base-portal.md)). Every knowledge base has a portal at `/help/<path>/` on the instance. Instance administrators can also allow own domains for portals.

The instance settings for all portals are under **Settings › Instance › Services › Knowledge base portals**.

## Link to the app

The account menu of the portal shows a link to the app for people who can see at least one space, never for portal accounts. **Name of the link to the app** sets its text, up to 60 characters, for example "Go to the Example wiki". Leave it empty for "Go to the wiki". The setting key is `portal.appLinkName`.

## Own domains

A knowledge base can have its own domain, for example the address of an older help center, such as `help.example.com`. Each domain belongs to one organization, which can use it for one of its knowledge bases.

### Allowing a domain

1. Open **Settings › Instance › Services › Knowledge base portals** and choose **Allow domain** under **Portal domains**.
2. Enter only the domain name, without `https://` and without a path, and search the organization that may use it.
3. A space admin of a knowledge base in that organization chooses the domain under **Space settings › Address**, field **Own domain**. The list shows only domains that are free or already used by this knowledge base. The page shows the DNS record to copy before saving.

The table **Portal domains** shows each domain with its organization and the knowledge base that uses it. **Remove** takes a domain away: the knowledge base can no longer be reached on it, and everyone signed in there is signed out. The knowledge base stays reachable under its path on the instance.

Allowing and removing a domain, and changing the address of a portal, are recorded in the [audit log](audit-log.md).

### DNS

Point the domain to the instance before the space admin saves it. **Space settings › Address** shows the record to add at the DNS provider, a `CNAME` record to the host name of the instance:

```
help.example.com CNAME wiki.example.com.
```

DNS does not allow a `CNAME` record on a bare domain such as `example.com`; use a subdomain, or add `A` and `AAAA` records with the addresses of the instance there.

### Reverse proxy and certificates

Lunedo does not request certificates itself. The reverse proxy holds the certificate for each portal domain and sends the domain to Lunedo like the instance address; Lunedo decides by the host which portal answers. Portals on own domains need HTTPS.

- **Caddy** gets certificates on demand when the first visitor arrives. Configure `on_demand_tls` with `ask http://lunedo:3000/tls/ask` and a site block for all other domains, as in the [Caddy example](reverse-proxy/caddy.md).
- **Nginx** and **Traefik**: list the portal domains next to the instance address and get certificates for them as for any other site, see [Nginx](reverse-proxy/nginx.md) and [Traefik](reverse-proxy/traefik.md).

### Certificate check

`GET /tls/ask?domain=<domain>` tells a reverse proxy whether to request a certificate:

- It answers `200` for a domain an instance administrator has allowed and `404` for every other domain. It reveals nothing but yes or no for the one domain asked.
- It answers from the list each API node keeps in memory, so it does not query the database per request. Each node reloads the list whenever a domain is allowed or removed on any node.
- It allows 120 requests per minute per client address, then answers `429`. Requests the proxy sends itself, from an address in `LUNEDO_TRUSTED_PROXIES` or the loopback address without `X-Forwarded-For`, are not limited, so a flood of unknown domains cannot block certificates for allowed ones.

To check a domain by hand:

```sh
curl -sS -o /dev/null -w '%{http_code}\n' "https://wiki.example.com/tls/ask?domain=help.example.com"
```

The command prints `200` for an allowed portal domain and `404` otherwise.

### What answers on an own domain

- Only the portal answers. The app and `/api/` are not reachable there.
- Health checks (`/health/…`), `/metrics` and `/tls/ask` answer on every host without a database lookup.
- While the database cannot be reached, requests to hosts other than the instance address get status `503`.
- The portal keeps working under `/help/<path>/` on the instance as well.

### Signing in on an own domain

On its own domain the portal has a session of its own, which belongs to the session of the instance.

- A visitor without a session there is sent to the instance. When they are already signed in there, they come back at once with a session for the domain; otherwise they sign in first.
- People who do not belong to the organization of the domain are asked once per account and domain whether to sign in there. The answer is remembered and recorded in the audit log. Members of the organization are not asked.
- The handoff uses a one-time code that is valid for 60 seconds, bound to the domain and to a random value in a cookie of the domain.
- Signing out in the portal also ends the instance session it belongs to, so the person is signed out of the portal and the app in that browser. When the instance session ends, by sign-out, expiry, deactivation or "sign out everywhere", the session of the domain ends too.
