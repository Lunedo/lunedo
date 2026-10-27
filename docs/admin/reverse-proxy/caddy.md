# Caddy

Caddy in the same Compose project as Lunedo. It gets certificates from Let's Encrypt for the instance address and, on demand, for allowed portal domains. Read [What every proxy needs](../reverse-proxy.md#what-every-proxy-needs) first.

## Compose service

Add the service to the `compose.yml` of the setup script, or to your own. It joins the default network with the fixed address `172.30.0.10`, the one address `LUNEDO_TRUSTED_PROXIES` lists: `--proxy 172.30.0.10` with the setup script, or `LUNEDO_TRUSTED_PROXIES=172.30.0.10/32` in `.env`.

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

## Caddyfile

Put the `Caddyfile` next to `compose.yml`. Replace the e-mail address and `wiki.example.org` with your own.

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

Caddy passes WebSockets and the forwarded headers by default and has no body limit.

The `https://` block serves every other domain that reaches Caddy, but only after Lunedo allowed it: before Caddy requests a certificate, it asks `GET /tls/ask?domain=<domain>`. Lunedo answers `200` for a portal domain an instance administrator has allowed and `404` for every other domain. Without portal domains, leave the `on_demand_tls` option and the `https://` block out. See [Own domains](../knowledge-base-portals.md#own-domains).

`/tls/ask` answers from the list each API node keeps in memory, so it does not query the database per request. It allows 120 requests per minute per client address, then answers `429`. Requests that come straight from an address in `LUNEDO_TRUSTED_PROXIES` or from loopback, without an `X-Forwarded-For` header, are not limited, so a flood of unknown domains cannot block certificates for allowed ones. It answers on every host and reveals nothing but yes or no for the one domain asked.

## Start

1. Set `LUNEDO_TRUSTED_PROXIES=172.30.0.10/32` in `.env`, unless the setup script did it with `--proxy`.
2. Start both containers:

   ```sh
   docker compose up -d --wait
   ```

3. Check the proxy as described in [Checking a proxy](../reverse-proxy.md#checking-a-proxy).
