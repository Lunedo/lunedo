# Setup through configuration

For automated deployments, the values of the [setup assistant](setup-assistant.md) can be given through configuration instead. The first API node that starts applies them, the assistant is skipped and no setup code is printed.

## Settings

| Setting | Required | Meaning |
|---|---|---|
| `LUNEDO_INSTANCE_URL` | yes | Address of the instance, for example `https://wiki.example.com`, without a path. |
| `LUNEDO_OWNER_EMAIL` | yes | E-mail address of the owner account. |
| `LUNEDO_OWNER_NAME` | yes | Name of the owner account. |
| `LUNEDO_OWNER_PASSWORD` | yes | Password of the owner account. A secret; it can also be given as `LUNEDO_OWNER_PASSWORD_FILE`. |
| `LUNEDO_ORGANIZATION_NAME` | yes | Name of the first organization. |
| `LUNEDO_INSTANCE_NAME` | no | Name of the instance, `Lunedo` by default. |
| `LUNEDO_ORGANIZATION_LANGUAGE` | no | Language of the first organization, `en` or `de`. |
| `LUNEDO_ORGANIZATION_TIME_ZONE` | no | IANA time zone of the first organization, for example `Europe/Vienna`. |
| `LUNEDO_SMTP_HOST`, `LUNEDO_SMTP_PORT`, `LUNEDO_SMTP_SECURITY`, `LUNEDO_SMTP_USERNAME`, `LUNEDO_SMTP_PASSWORD`, `LUNEDO_SMTP_FROM` | no | The mail server for outgoing e-mail; see [Environment variables](environment-variables.md#setup-through-configuration). |

Setting any of the owner, organization or instance name settings starts setup through configuration. Then the start fails with exit code 78 and names every missing or invalid value:

- `LUNEDO_INSTANCE_URL`, `LUNEDO_OWNER_EMAIL`, `LUNEDO_OWNER_NAME`, `LUNEDO_OWNER_PASSWORD` and `LUNEDO_ORGANIZATION_NAME` are required together.
- `LUNEDO_OWNER_EMAIL` and `LUNEDO_SMTP_FROM` must be e-mail addresses, and the time zone must be an IANA time zone.
- SMTP settings are allowed only together with setup through configuration. With any of them, `LUNEDO_SMTP_HOST` and `LUNEDO_SMTP_FROM` are required, `LUNEDO_SMTP_USERNAME` and `LUNEDO_SMTP_PASSWORD` go together, and `LUNEDO_SMTP_SECURITY=none` cannot be combined with credentials.

A password that does not meet the password policy stops the start with exit code 1 and a message that names `LUNEDO_OWNER_PASSWORD`.

## What is applied

When setup is not complete yet, the first API node that starts:

1. stores the instance address and, when given, the instance name;
2. creates the owner account;
3. creates the first organization with the owner as its owner. Without a language or time zone, the organization gets those of the instance. It gets the formats the assistant would propose for its language and time zone; see [Formats of the organization](setup-assistant.md#formats-of-the-organization);
4. sets up the SMTP server, when given;
5. marks every step of the assistant as done and logs "Setup applied from the configuration".

The values are applied once. Later changes to these settings have no effect; change the instance, the account and the organization in their settings instead. `LUNEDO_INSTANCE_URL` is the exception: it stays in force as the address of the instance; see [Instance address](instance-address.md).

The settings are still checked at every start. To remove them from the configuration, remove all of them together, except `LUNEDO_INSTANCE_URL`; removing only some of them stops the start.

## After the first start

- The owner must set up a second factor at the first sign-in.
- The assistant's emergency kit step is skipped. Back up the master keys and the backup keys yourself: the values of `LUNEDO_MASTER_KEYS` and `LUNEDO_BACKUP_KEY`, or the files `master-keys` and `backup-keys` in the secrets directory when Lunedo generated them. See [Encryption](encryption.md).

## The instance address on its own

`LUNEDO_INSTANCE_URL` can also be set on its own. Then it only defines the address: the setup link in the log uses it, and the assistant shows it locked in the instance step, but setup still runs through the assistant.
