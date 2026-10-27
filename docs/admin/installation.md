# Installation

Lunedo runs as a container image with Docker Compose, next to a PostgreSQL database. Installing it takes three parts:

1. Check the [requirements](requirements.md): a host with Docker, PostgreSQL 16 or newer, and a free port.
2. Start the containers, in one of two ways:
   - [With the setup script](installation/script.md). It checks the host, writes the Compose file and the secrets, starts Lunedo and later updates it with one command. Use it on a single Linux or macOS host.
   - [With your own Compose file](installation/compose.md). Use it for container platforms, templates or a setup you manage yourself.
3. Set up the instance once:
   - [With the setup assistant](setup-assistant.md) in the browser, protected by a one-time setup code. It runs the [system check](system-check.md), creates the owner account and the first organization, and hands you the emergency kit with the keys.
   - [Through configuration](setup-through-configuration.md), for automated deployments without a browser.

Lunedo does not speak TLS itself. Put it behind a [reverse proxy](reverse-proxy.md) with a certificate before you invite people; examples exist for [Caddy](reverse-proxy/caddy.md), [nginx](reverse-proxy/nginx.md) and [Traefik](reverse-proxy/traefik.md).

Every setting Lunedo reads is listed in [Configuration](configuration.md). Later updates are described in [Updates](updates.md).
