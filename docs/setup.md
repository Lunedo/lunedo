# Setup

A new instance is set up once, either through the setup assistant or through configuration.

## Setup code

While setup is not complete, every start of an API node prints a one-time setup code to the log:

```
Setup code: 7KQ2-M9XA-P4RT-HB3C. Open Pagehall in a browser and enter this code to set up the instance.
```

Read it with `docker compose logs pagehall | grep "Setup code"`. A new start issues a new code and the earlier one stops working, so with several API nodes use the newest code. The code works once and proves that whoever runs the assistant operates the server. It is the only secret Pagehall ever writes to its log. Exchanges are limited to 10 per client in 15 minutes; the code has 80 bits, so it cannot be guessed.

The code is exchanged for a setup session, held in the cookie `__Host-pagehall-setup`. A setup session ends after an hour without use and a day after the code was entered.

## Steps

Steps are registered by the modules; the assistant shows them in order:

| Step | Required | Content |
|---|---|---|
| `systemCheck` | yes | Database version and migrations, file storage, instance URL, HTTPS, clock difference between application and database. Warnings do not block setup. |
| `instance` | yes | Instance URL and name. |
| `owner` | yes | Owner account with password and TOTP, then ten recovery codes. The step can be repeated until setup is complete. |
| `keyBackup` | yes | One-time download of the master keys and backup keys, then a confirmation that they are stored safely. |
| `mail` | no | SMTP settings with a test mail. |

The setup state is stored in the database, so all nodes agree on it.

## Endpoints

All endpoints are internal. After setup they answer `404` like routes that do not exist.

| Endpoint | Access |
|---|---|
| `GET /api/v1/setup` | public until setup is complete |
| `POST /api/v1/setup/session` with `{ "code": "..." }` | public until setup is complete |
| `GET /api/v1/setup/steps` | setup session |
| `POST /api/v1/setup/steps/{step}/{action}` | setup session |
| `POST /api/v1/setup/complete` | setup session |

Actions: `systemCheck/acknowledge`, `instance/save`, `owner/createAccount`, `owner/beginTotp`, `owner/confirmTotp`, `keyBackup/download`, `keyBackup/confirm`, `mail/save`, `mail/test`.

## Setup through configuration

All values can be given through configuration instead, see [configuration.md](configuration.md#setup-through-configuration). The assistant is then skipped and no setup code is printed. The owner sets up a second factor at the first sign-in, and the keys must be backed up by the operator.
