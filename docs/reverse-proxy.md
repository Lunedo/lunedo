# Reverse proxy

Pagehall does not terminate TLS. Put it behind the reverse proxy you already run, which holds the certificates and forwards everything to the API port of the Pagehall container (3000). The API serves the web client and the API, and forwards the collaboration WebSocket on `/collab` to the collaboration server in the same container, so the proxy needs only one upstream.

This page has tested examples for [Caddy](#caddy), [Nginx](#nginx) and [Traefik](#traefik). CI starts each example in front of a test instance and checks a page, a WebSocket connection to `/collab` and a large upload (`scripts/reverse-proxy-check.sh`).

## What every proxy needs

### TLS and the instance address

- Serve Pagehall over HTTPS only and redirect HTTP to HTTPS. Sign-in cookies are `Secure` and browsers store them only over HTTPS.
- `PAGEHALL_INSTANCE_URL` (or the instance address in the setup assistant) is the address people open, for example `https://wiki.example.org`. Links in e-mails, the WebSocket origin check and CSRF protection use it.

### Forwarded headers and `PAGEHALL_TRUSTED_PROXIES`

Pagehall reads the client address from `X-Forwarded-For`, the protocol from `X-Forwarded-Proto` and the host from `X-Forwarded-Host`, but only from proxies listed in `PAGEHALL_TRUSTED_PROXIES` (comma-separated addresses and CIDR ranges). From every other address these headers are ignored, so nobody can fake a client address to get around rate limits.

- The proxy must set all three headers and replace values sent by the client. Caddy and Traefik do this by default; the Nginx example sets them.
- With the proxy in the same Compose project, list the subnet of the network. The Compose file of the setup script gives its network the fixed subnet `172.30.0.0/24` (`--subnet` changes it) and trusts it. With the proxy on the host, Pagehall sees the gateway of that network, which is in the same subnet.
- The system status page shows a warning under HTTPS when the instance address does not use HTTPS.

### WebSockets

Editors keep a WebSocket connection to `wss://<instance>/collab` open while a page is open. The proxy must:

- pass the `Upgrade` and `Connection` headers (Caddy and Traefik do this by default);
- keep idle connections open for at least a minute. The collaboration server pings every client, and the editor reconnects on its own after a closed connection, but short timeouts cause needless reconnects. The examples allow an hour.

### Upload size

Files are uploaded in one request with the file as the body. The largest allowed file is the setting **Largest file to upload** under **Instance settings → Pages and trash** (`files.maxFileSizeMegabytes`, 100 MB by default; organizations can only lower it). Imports are uploaded in parts of 16 MiB, so they need no larger limit.

- Set the proxy's body limit to at least the largest file to upload plus 1 MB, or turn it off and let Pagehall enforce its own limit. The Nginx example uses 101 MB; Caddy has no limit by default.
- Do not buffer request bodies in the proxy (`proxy_request_buffering off` in Nginx), and allow slow uploads to take long: Traefik's default `readTimeout` of 60 seconds cuts off uploads of large files on slow connections.

When you raise **Largest file to upload**, raise the proxy limit too, otherwise uploads fail at the proxy with status 413 before they reach Pagehall.

### Own domains for knowledge base portals

A knowledge base portal can have its own domain ([knowledge-bases.md](knowledge-bases.md#own-domains)). The proxy holds the certificate for it and sends it to Pagehall like the instance address; Pagehall decides by the host which portal answers.

- With Caddy, on-demand TLS gets certificates automatically when the first visitor arrives. Caddy asks Pagehall first whether the domain is allowed: `GET /tls/ask?domain=<domain>` answers `200` for a domain an instance administrator has allowed and `404` for every other domain. It answers from the list each API node keeps in memory, so it does not query the database per request, and it allows 120 requests per minute per client address (then `429`). Checks the proxy sends itself, from an address in `PAGEHALL_TRUSTED_PROXIES` or the loopback address without `X-Forwarded-For`, are not limited, so a flood of unknown domains cannot block certificates for allowed ones. It answers on every host and reveals nothing but yes or no for the one domain asked.
- With Nginx and Traefik, list the portal domains next to the instance address and get certificates for them as for any other site.

## Caddy

Caddy in the same Compose project as Pagehall. Add the service to the `compose.yml` of the setup script, or to your own; it joins the default network, whose subnet `PAGEHALL_TRUSTED_PROXIES` already trusts (`172.30.0.0/24` with the setup script). Caddy gets certificates from Let's Encrypt for the instance address and, on demand, for allowed portal domains.

<!-- reverse-proxy-check: caddy-compose -->
```yaml
services:
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data

volumes:
  caddy-data:
```

<!-- reverse-proxy-check: caddy -->
```caddyfile
{
	email admin@example.org
	on_demand_tls {
		ask http://pagehall:3000/tls/ask
	}
}

wiki.example.org {
	reverse_proxy pagehall:3000
}

https:// {
	tls {
		on_demand
	}
	reverse_proxy pagehall:3000
}
```

Caddy passes WebSockets and the forwarded headers by default and has no body limit. The `https://` block serves every other domain that reaches Caddy, but only after `/tls/ask` allowed it; without portal domains, leave it out.

## Nginx

An Nginx server block for the instance address and one portal domain, with the Pagehall API port published on the host as `127.0.0.1:3000`. Certificates come from your own tooling, for example certbot.

<!-- reverse-proxy-check: nginx -->
```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

upstream pagehall {
    server 127.0.0.1:3000;
    keepalive 16;
}

server {
    listen 80;
    listen [::]:80;
    server_name wiki.example.org help.example.org;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name wiki.example.org help.example.org;

    ssl_certificate     /etc/ssl/pagehall/fullchain.pem;
    ssl_certificate_key /etc/ssl/pagehall/privkey.pem;

    client_max_body_size 101m;
    proxy_request_buffering off;

    location / {
        proxy_pass http://pagehall;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 1h;
        proxy_send_timeout 1h;
    }
}
```

Docker forwards the published port, so Pagehall sees the connection from the gateway of its Compose network, not from `127.0.0.1`; the trusted subnet of the setup script (`172.30.0.0/24`) covers it. With your own Compose file, set `PAGEHALL_TRUSTED_PROXIES` to the subnet of the network. `$proxy_add_x_forwarded_for` appends to a header a client sent; Pagehall reads the entries from the right and stops at the first address that is not a trusted proxy, so a faked entry on the left is ignored. Each portal domain needs a certificate that covers it; add it to `server_name` in both blocks, or give it a server block of its own.

## Traefik

Traefik with the file provider. The static configuration sets the entry points with timeouts for uploads and WebSockets and a Let's Encrypt resolver; the dynamic configuration routes the instance address and one portal domain to Pagehall.

<!-- reverse-proxy-check: traefik -->
```yaml
entryPoints:
  web:
    address: ":80"
    http:
      redirections:
        entryPoint:
          to: websecure
          scheme: https
  websecure:
    address: ":443"
    transport:
      respondingTimeouts:
        readTimeout: 1h
        idleTimeout: 1h

providers:
  file:
    filename: /etc/traefik/dynamic.yml

certificatesResolvers:
  letsencrypt:
    acme:
      email: admin@example.org
      storage: /letsencrypt/acme.json
      httpChallenge:
        entryPoint: web
```

<!-- reverse-proxy-check: traefik-dynamic -->
```yaml
http:
  routers:
    pagehall:
      rule: Host(`wiki.example.org`) || Host(`help.example.org`)
      entryPoints: [websecure]
      service: pagehall
      tls:
        certResolver: letsencrypt
  services:
    pagehall:
      loadBalancer:
        servers:
          - url: http://pagehall:3000
```

Traefik passes WebSockets and the forwarded headers by default and has no body limit. Its `readTimeout` of 60 seconds would cut off long uploads, so the example raises it. Run Traefik in the Compose project of Pagehall as in the Caddy example, so that the trusted subnet covers it. With Docker labels instead of the file provider, put the same rule, entry point and resolver on the `pagehall` service and set `traefik.http.services.pagehall.loadbalancer.server.port=3000`.

## Checking a proxy

After changing the proxy, open the system status page under **Instance settings → System status**. It shows whether the instance address uses HTTPS. To check by hand:

```sh
curl -sS -o /dev/null -w '%{http_code}\n' https://wiki.example.org/health/ready
curl -sS -o /dev/null -w '%{http_code}\n' "https://wiki.example.org/tls/ask?domain=help.example.org"
```

The first command prints `200`. The second prints `200` for an allowed portal domain and `404` otherwise.
