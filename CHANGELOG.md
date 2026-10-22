# Changelog

What changed for the people who run and use Pagehall. Each release lists its changes in the groups New, Improved, Fixed, Breaking changes and Manual steps. A release that cannot be reached from every earlier version says from which version to update. The admin area and the update command read this file; [docs/operations.md](docs/operations.md#changelog) describes the format.

## Unreleased

### New

- A system status page for instance administrators that says for every check whether it is ok, what is wrong and where it is fixed.
- Maintenance mode makes the instance read-only with a message for everyone and can pause signing in for everyone except instance administrators.
- An optional update check shows new versions with their changes and the commands to update.
- A setup script installs Pagehall with Docker Compose and updates it with one command, with a backup before every update.
- Prometheus metrics for backups, jobs, mail delivery, storage, the collaboration server, maintenance mode and available updates.
- Documentation and tested examples for Caddy, Nginx and Traefik in front of Pagehall.
