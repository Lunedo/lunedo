# nginx

An nginx server block for the instance address and one portal domain. Certificates come from your own tooling, for example certbot. Read [What every proxy needs](../reverse-proxy.md#what-every-proxy-needs) first.

## Server block

The example runs nginx on the host, with the Lunedo API port published as `127.0.0.1:3000`, as the setup script does. Replace `wiki.example.org`, `help.example.org` and the certificate paths with your own.

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

`client_max_body_size 101m` allows the default **Largest file to upload** of 100 MiB plus 1 MiB; raise both together. `proxy_request_buffering off` streams uploads to Lunedo, and the timeouts of an hour keep WebSocket connections open. See [Upload size](../reverse-proxy.md#upload-size).

Each portal domain needs a certificate that covers it. Add it to `server_name` in both blocks, or give it a server block of its own. See [Own domains](../knowledge-base-portals.md#own-domains).

## Forwarded headers

Docker forwards the published port, so Lunedo sees the connection from the gateway of its Compose network, not from `127.0.0.1`. Do not trust the gateway (see [Forwarded headers](../reverse-proxy.md#forwarded-headers-and-lunedo_trusted_proxies)). With nginx on the host, leave `LUNEDO_TRUSTED_PROXIES` empty; Lunedo then ignores the forwarded headers and sees every client as the gateway.

To let Lunedo see the client addresses, run nginx as a container in the Compose project with a fixed address instead:

1. Change the upstream in the server block to `server lunedo:3000;`.
2. Add the service to `compose.yml`, with the server block as `lunedo.conf` next to it and the certificates in `/etc/ssl/lunedo` on the host:

   ```yaml
   services:
     nginx:
       image: nginx:1.30-alpine
       restart: unless-stopped
       ports:
         - "80:80"
         - "443:443"
       volumes:
         - ./lunedo.conf:/etc/nginx/conf.d/default.conf:ro
         - /etc/ssl/lunedo:/etc/ssl/lunedo:ro
       networks:
         default:
           ipv4_address: 172.30.0.10
   ```

3. Set `LUNEDO_TRUSTED_PROXIES=172.30.0.10/32` in `.env`, or use `--proxy 172.30.0.10` with the setup script.
4. Run `docker compose up -d --wait` and check the proxy as described in [Checking a proxy](../reverse-proxy.md#checking-a-proxy).

`$proxy_add_x_forwarded_for` appends to a header a client sent; Lunedo reads the entries from the right and stops at the first address that is not a trusted proxy, so a faked entry on the left is ignored.
