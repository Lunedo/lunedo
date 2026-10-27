# Traefik

Traefik with the file provider. The static configuration sets the entry points with timeouts for uploads and WebSockets and a Let's Encrypt resolver; the dynamic configuration routes the instance address and one portal domain to Lunedo. Read [What every proxy needs](../reverse-proxy.md#what-every-proxy-needs) first.

## Static configuration

Save it as `traefik.yml` next to `compose.yml`, and replace the e-mail address with your own.

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

Traefik's default `readTimeout` of 60 seconds would cut off long uploads, so the example raises it to an hour, which also keeps WebSocket connections open.

## Dynamic configuration

Save it as `dynamic.yml`, and replace `wiki.example.org` and `help.example.org` with your own host names. Without a portal domain, keep only the first `Host` rule. See [Own domains](../knowledge-base-portals.md#own-domains).

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

Traefik passes WebSockets and the forwarded headers by default and has no body limit.

## Compose service

Run Traefik in the Compose project of Lunedo with a fixed address, and trust that address:

```yaml
services:
  traefik:
    image: traefik:v3.7
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./traefik.yml:/etc/traefik/traefik.yml:ro
      - ./dynamic.yml:/etc/traefik/dynamic.yml:ro
      - traefik-acme:/letsencrypt
    networks:
      default:
        ipv4_address: 172.30.0.10

volumes:
  traefik-acme:
```

1. Add the service to `compose.yml`.
2. Set `LUNEDO_TRUSTED_PROXIES=172.30.0.10/32` in `.env`, or use `--proxy 172.30.0.10` with the setup script.
3. Run `docker compose up -d --wait` and check the proxy as described in [Checking a proxy](../reverse-proxy.md#checking-a-proxy).

With Docker labels instead of the file provider, put the same rule, entry point and resolver on the `lunedo` service and set `traefik.http.services.lunedo.loadbalancer.server.port=3000`.
