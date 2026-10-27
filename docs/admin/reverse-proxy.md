# Reverse proxy

Lunedo does not terminate TLS. Put it behind the reverse proxy you already run, which holds the certificates and forwards everything to the API port of the Lunedo container (3000). The API serves the web client and the API, and forwards the collaboration WebSocket on `/collab` to the collaboration server in the same container, so the proxy needs only one upstream.

This page has tested examples for [Caddy](#caddy), [Nginx](#nginx) and [Traefik](#traefik). CI starts each example in front of a test instance and checks a page, a WebSocket connection to `/collab` and a large upload (`scripts/reverse-proxy-check.sh`).

## What every proxy needs

### TLS and the instance address

- Serve Lunedo over HTTPS only and redirect HTTP to HTTPS. Sign-in cookies are `Secure` and browsers store them only over HTTPS.
- `LUNEDO_INSTANCE_URL` (or the instance address in the setup assistant) is the address people open, for example `https://wiki.example.org`. Links in e-mails, the WebSocket origin check and CSRF protection use it.

### Forwarded headers and `LUNEDO_TRUSTED_PROXIES`

Lunedo reads the client address from `X-Forwarded-For`, the protocol from `X-Forwarded-Proto` and the host from `X-Forwarded-Host`, but only from proxies listed in `LUNEDO_TRUSTED_PROXIES` (comma-separated addresses and CIDR ranges). From every other address these headers are ignored, so nobody can fake a client address to get around rate limits.

- The proxy must set all three headers and replace values sent by the client. Caddy and Traefik do this by default; the Nginx example sets them.
- Trust only the address of the proxy, never a whole subnet: every container in a trusted subnet could set these headers. Run the proxy in the Compose project of Lunedo with a fixed address, as the Caddy example does, and set `LUNEDO_TRUSTED_PROXIES` to that one address. The setup script does this with `--proxy 172.30.0.10`; without it, it trusts no proxy.
- Never trust the gateway of the Compose network (`172.30.0.1` with the setup script). A proxy on the host reaches Lunedo through the published port and arrives from the gateway, but so does every other program on the host, which could then fake client addresses, get around rate limits and write wrong addresses into sessions and the audit log. With a proxy on the host, leave `LUNEDO_TRUSTED_PROXIES` empty: Lunedo then ignores the forwarded headers and sees every request as coming from the gateway, so rate limits per client address apply to all clients together. Moving the proxy into the Compose project avoids that.
- The system status page shows a warning under HTTPS when the instance address does not use HTTPS.

### WebSockets

Editors keep a WebSocket connection to `wss://<instance>/collab` open while a page is open. The proxy must:

- pass the `Upgrade` and `Connection` headers (Caddy and Traefik do this by default);
- keep idle connections open for at least a minute. The collaboration server pings every client, and the editor reconnects on its own after a closed connection, but short timeouts cause needless reconnects. The examples allow an hour.

### Upload size

Files are uploaded in one request with the file as the body. The largest allowed file is the setting **Largest file to upload** under **Instance settings → Pages and trash** (`files.maxFileSizeMegabytes`, 100 MB by default; organizations can only lower it). Imports are uploaded in parts of 16 MiB, so they need no larger limit.

- Set the proxy's body limit to at least the largest file to upload plus 1 MB, or turn it off and let Lunedo enforce its own limit. The Nginx example uses 101 MB; Caddy has no limit by default.
- Do not buffer request bodies in the proxy (`proxy_request_buffering off` in Nginx), and allow slow uploads to take long: Traefik's default `readTimeout` of 60 seconds cuts off uploads of large files on slow connections.

When you raise **Largest file to upload**, raise the proxy limit too, otherwise uploads fail at the proxy with status 413 before they reach Lunedo.

### Own domains for knowledge base portals

A knowledge base portal can have its own domain ([knowledge-bases.md](knowledge-bases.md#own-domains)). The proxy holds the certificate for it and sends it to Lunedo like the instance address; Lunedo decides by the host which portal answers.

- With Caddy, on-demand TLS gets certificates automatically when the first visitor arrives. Caddy asks Lunedo first whether the domain is allowed: `GET /tls/ask?domain=<domain>` answers `200` for a domain an instance administrator has allowed and `404` for every other domain. It answers from the list each API node keeps in memory, so it does not query the database per request, and it allows 120 requests per minute per client address (then `429`). Checks the proxy sends itself, from an address in `LUNEDO_TRUSTED_PROXIES` or the loopback address without `X-Forwarded-For`, are not limited, so a flood of unknown domains cannot block certificates for allowed ones. It answers on every host and reveals nothing but yes or no for the one domain asked.
- With Nginx and Traefik, list the portal domains next to the instance address and get certificates for them as for any other site.

## Caddy

Caddy in the same Compose project as Lunedo. Add the service to the `compose.yml` of the setup script, or to your own; it joins the default network with the fixed address `172.30.0.10`, the one address `LUNEDO_TRUSTED_PROXIES` lists (`--proxy 172.30.0.10` with the setup script, or `LUNEDO_TRUSTED_PROXIES=172.30.0.10/32` in `.env`). Caddy gets certificates from Let's Encrypt for the instance address and, on demand, for allowed portal domains.

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
    networks:
      default:
        ipv4_address: 172.30.0.10

volumes:
  caddy-data:
```

<!-- reverse-proxy-check: caddy -->
```caddyfile
{
	email admin@example.org
	on_demand_tls {
		ask http://lunedo:3000/tls/ask
	}
}

wiki.example.org {
	reverse_proxy lunedo:3000
}

https:// {
	tls {
		on_demand
	}
	reverse_proxy lunedo:3000
}
```

Caddy passes WebSockets and the forwarded headers by default and has no body limit. The `https://` block serves every other domain that reaches Caddy, but only after `/tls/ask` allowed it; without portal domains, leave it out.

## Nginx

An Nginx server block for the instance address and one portal domain, with the Lunedo API port published on the host as `127.0.0.1:3000`. Certificates come from your own tooling, for example certbot.

<!-- reverse-proxy-check: nginx -->
```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

upstream lunedo {
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

    ssl_certificate     /etc/ssl/lunedo/fullchain.pem;
    ssl_certificate_key /etc/ssl/lunedo/privkey.pem;

    client_max_body_size 101m;
    proxy_request_buffering off;

    location / {
        proxy_pass http://lunedo;
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

Docker forwards the published port, so Lunedo sees the connection from the gateway of its Compose network, not from `127.0.0.1`. Do not trust the gateway (see [Forwarded headers](#forwarded-headers-and-lunedo_trusted_proxies)); leave `LUNEDO_TRUSTED_PROXIES` empty, or run Nginx as a container in the Compose project with a fixed address, use `server lunedo:3000;` as upstream and trust that address. `$proxy_add_x_forwarded_for` appends to a header a client sent; Lunedo reads the entries from the right and stops at the first address that is not a trusted proxy, so a faked entry on the left is ignored. Each portal domain needs a certificate that covers it; add it to `server_name` in both blocks, or give it a server block of its own.

## Traefik

Traefik with the file provider. The static configuration sets the entry points with timeouts for uploads and WebSockets and a Let's Encrypt resolver; the dynamic configuration routes the instance address and one portal domain to Lunedo.

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
    lunedo:
      rule: Host(`wiki.example.org`) || Host(`help.example.org`)
      entryPoints: [websecure]
      service: lunedo
      tls:
        certResolver: letsencrypt
  services:
    lunedo:
      loadBalancer:
        servers:
          - url: http://lunedo:3000
```

Traefik passes WebSockets and the forwarded headers by default and has no body limit. Its `readTimeout` of 60 seconds would cut off long uploads, so the example raises it. Run Traefik in the Compose project of Lunedo with a fixed address as in the Caddy example, and trust that address. With Docker labels instead of the file provider, put the same rule, entry point and resolver on the `lunedo` service and set `traefik.http.services.lunedo.loadbalancer.server.port=3000`.

## Checking a proxy

After changing the proxy, open the system status page under **Instance settings → System status**. It shows whether the instance address uses HTTPS. To check by hand:

```sh
curl -sS -o /dev/null -w '%{http_code}\n' https://wiki.example.org/health/ready
curl -sS -o /dev/null -w '%{http_code}\n' "https://wiki.example.org/tls/ask?domain=help.example.org"
```

The first command prints `200`. The second prints `200` for an allowed portal domain and `404` otherwise.
