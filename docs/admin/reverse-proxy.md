# Reverse proxy

Lunedo does not terminate TLS. Put it behind the reverse proxy you already run, which holds the certificates and forwards everything to the API port of the Lunedo container (3000). The API serves the web client and the API, and forwards the collaboration WebSocket on `/collab` to the collaboration server in the same container, so the proxy needs only one upstream.

Tested examples:

- [Caddy](reverse-proxy/caddy.md), in the Compose project of Lunedo, with automatic certificates, also for portal domains.
- [nginx](reverse-proxy/nginx.md), on the host or in the Compose project, with certificates from your own tooling.
- [Traefik](reverse-proxy/traefik.md), with the file provider and Let's Encrypt.

## What every proxy needs

### TLS and the instance address

- Serve Lunedo over HTTPS only and redirect HTTP to HTTPS. Sign-in cookies are `Secure`, and browsers store them only over HTTPS.
- The instance address, from `LUNEDO_INSTANCE_URL` or the setup assistant, is the address people open, for example `https://wiki.example.com`. Links in e-mails, the WebSocket origin check and CSRF protection use it. See [Instance address](instance-address.md).
- The [system status](monitoring/system-status.md#https) page shows a warning under **HTTPS** when no instance address is set or when it does not use HTTPS.

### Forwarded headers and `LUNEDO_TRUSTED_PROXIES`

Lunedo reads the client address from `X-Forwarded-For`, the protocol from `X-Forwarded-Proto` and the host from `X-Forwarded-Host`, but only from proxies listed in `LUNEDO_TRUSTED_PROXIES` (comma-separated addresses and CIDR ranges). From every other address these headers are ignored, so nobody can fake a client address to get around rate limits.

- The proxy must set all three headers. It must replace the values a client sent, or, for `X-Forwarded-For`, append the client address it sees as the rightmost entry. Caddy and Traefik do this by default; the nginx example sets the headers and appends to `X-Forwarded-For`.
- Trust only the address of the proxy, never a whole subnet: every container in a trusted subnet could set these headers. Run the proxy in the Compose project of Lunedo with a fixed address, as the examples do, and set `LUNEDO_TRUSTED_PROXIES` to that one address. The setup script does this with `--proxy 172.30.0.10`; it accepts one IPv4 address and refuses the gateway of the network. Without it, it trusts no proxy.
- Never trust the gateway of the Compose network (`172.30.0.1` with the setup script). A proxy on the host reaches Lunedo through the published port and arrives from the gateway, but so does every other program on the host, which could then fake client addresses, get around rate limits and write wrong addresses into sessions and the audit log. With a proxy on the host, leave `LUNEDO_TRUSTED_PROXIES` empty: Lunedo then ignores the forwarded headers and sees every request as coming from the gateway, so rate limits per client address apply to all clients together. Moving the proxy into the Compose project avoids that.
- With a proxy on the host, the lockout per client also applies to all clients together. By default, 20 wrong passwords within 15 minutes from anyone lock the sign-in with a password for everybody, the instance owner included, for 1 minute, and each further lockout within a day doubles that, up to 60 minutes (see [Rate limits and lockouts](authentication.md#rate-limits-and-lockouts)). Run the proxy in the Compose project of Lunedo for an instance that can be reached from the internet.
- Lunedo reads the entries of `X-Forwarded-For` from the right and stops at the first address that is not a trusted proxy, so an entry a client faked on the left is ignored.

### WebSockets

Editors keep a WebSocket connection to `wss://<instance address>/collab` open while a page is open. The proxy must:

- pass the `Upgrade` and `Connection` headers (Caddy and Traefik do this by default);
- keep idle connections open for at least a minute. The collaboration server pings every client, and the editor reconnects on its own after a closed connection, but short timeouts cause needless reconnects. The examples allow an hour;
- keep the `Host`, `Cookie` and `Origin` headers unchanged. A connection is accepted only with the session cookie of a signed-in person and with the instance address as its `Origin`.

Each account may open 60 and each client address 300 collaboration connections per minute.

### Upload size

Files are uploaded in one request with the file as the body. The largest allowed file is the setting **Largest file to upload** under **Settings › Instance › People and sign-in › Policies**, section **Files** (100 MiB by default). Organizations can only lower it. Imports are uploaded in parts of 16 MiB, so they need no larger limit.

- Set the proxy's body limit to at least the largest file to upload plus 1 MiB, or turn it off and let Lunedo enforce its own limit. The nginx example uses `101m`; Caddy and Traefik have no limit by default.
- Do not buffer request bodies in the proxy (`proxy_request_buffering off` in nginx), and allow slow uploads to take long: Traefik's default `readTimeout` of 60 seconds cuts off uploads of large files on slow connections.

When you raise **Largest file to upload**, raise the proxy limit too, otherwise uploads fail at the proxy with status `413` before they reach Lunedo.

### Own domains for knowledge base portals

A knowledge base portal can have its own domain. The proxy holds the certificate for it and sends it to Lunedo like the instance address; Lunedo decides by the host which portal answers. With Caddy, on-demand TLS gets certificates automatically after Lunedo confirmed the domain through `/tls/ask`; with nginx and Traefik, list the portal domains next to the instance address. See [Own domains](knowledge-base-portals.md#own-domains).

### Separate origin for attachments

With `LUNEDO_FILES_URL`, for example `https://files.wiki.example.com`, attachment content and previews are served from a separate origin. Give that host name a certificate and forward it to the same Lunedo upstream as the instance address.

## Several nodes

In a single container (`all`), the API forwards WebSocket connections on `/collab` to the local collaboration server, so only the API port needs to be published. `LUNEDO_COLLAB_UPSTREAM` changes where the API forwards to.

With separate roles (`api`, `collab`, `worker`, see [Container roles](requirements.md#container-roles)) behind a load balancer:

- Route `/collab` to the collaboration nodes, with WebSocket support and idle timeouts above 60 seconds, and everything else to the API nodes.
- Keep the `Host`, `Cookie` and `Origin` headers unchanged.
- Use `/health/ready` of each node as the health check; see [Monitoring](monitoring.md).
- With more than one collaboration node, set `LUNEDO_REDIS_URL` on every collaboration node. Updates, presence and save messages then travel between the nodes through Redis, so people on different nodes see each other's changes immediately. Without Redis, a node takes over the changes of other nodes only from the database, when it stores the page after a change on its own node; until then, people on different nodes do not see each other's changes. Any Redis-compatible server works, for example Valkey.
- Give every node the same configuration and the same keys. Without a shared secrets volume, configure all secrets explicitly; see [Configuration](configuration.md#secrets).

## Checking a proxy

After changing the proxy, open **Settings › Instance › Operations › System status**. It shows under **HTTPS** whether the instance address uses HTTPS. To check by hand:

```sh
curl -sS -o /dev/null -w '%{http_code}\n' https://wiki.example.com/health/ready
curl -sS -o /dev/null -w '%{http_code}\n' "https://wiki.example.com/tls/ask?domain=help.example.com"
```

The first command prints `200`. The second prints `200` for an allowed portal domain and `404` otherwise.
