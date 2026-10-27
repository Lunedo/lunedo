# Setup assistant

After the containers run, the instance is set up once in the browser. The setup assistant creates the owner account and the first organization and hands you the keys. It is protected by a one-time setup code, so only someone who operates the server can run it. For automated deployments, [setup through configuration](setup-through-configuration.md) skips the assistant.

## Setup code

The [setup script](installation/script.md) generates the setup code, writes it to `.env` as `LUNEDO_SETUP_CODE` and prints the setup link. Without the script, while setup is not complete, every start of an API node prints a link with a one-time setup code to the log:

```
Setup link: https://wiki.example.com/setup#code=7KQ2-M9XA-P4RT-HB3C. Open it in a browser to set up the instance.
```

Read it with:

```sh
docker compose logs lunedo | grep "Setup link"
```

- The link uses the instance address stored by the assistant, otherwise `LUNEDO_INSTANCE_URL`. Without either, the log shows only the path, `/setup#code=…`; put the address of the server in front of it.
- The code is in the URL fragment, which browsers do not send to the server, so it does not reach proxy or access logs. The setup page takes the code from the fragment, fills it in and removes the fragment from the address bar.
- Every start issues a new code, and the earlier one stops working. With several API nodes, use the newest code.
- The code works once. A generated code has 16 characters, 80 bits, so it cannot be guessed; entering codes is limited to 10 attempts per client in 15 minutes.
- It is the only secret Lunedo ever writes to its log.

### A setup code of your own

Set `LUNEDO_SETUP_CODE`, or `LUNEDO_SETUP_CODE_FILE` with the path of a file that holds it, for example as a field in a container template. Lunedo then uses it instead of a generated code and does not print it.

- It needs at least 12 characters, not counting spaces and hyphens, and at most 64. Another length stops the start with exit code 78.
- Letters are compared without regard to case; spaces and hyphens are ignored.
- Like a generated code, it works once per start.
- Once setup is complete, it is ignored, and every start logs that the variable can be removed.

Entering the code starts a setup session in this browser. It ends after an hour without use and a day after the code was entered; then enter the code from the newest start again.

## Steps

The assistant opens with **Welcome**: the field for the setup code, **Set up a new instance**, and three ways to restore a backup instead (see [Restore during the setup](#restore-during-the-setup)). The steps follow in this order, and a menu "Step n of 7 · <name>" above the title lists them; steps already reached can be chosen there. The browser back button goes back one step.

| Step | Content |
|---|---|
| **Instance** | The address of the instance, taken from the address the setup is opened with, and the **Instance name**. An address set by `LUNEDO_INSTANCE_URL` is shown locked. |
| **System check** | Database, file storage, clock, the address and HTTPS. Errors block the setup; warnings do not. See [System check](system-check.md). |
| **Owner account** | Owner account with password and TOTP. The step can be repeated until setup is complete. |
| **Emergency kit** | One-time download of the emergency kit, then a confirmation that it is stored safely. |
| **Organization** | The first organization with name, language, time zone and formats. The owner becomes its owner and has it as home organization. Its language and time zone also become the defaults of the instance, for pages outside an organization such as sign-in. |
| **Summary** | Every step with **Change**, which goes back to it, and **Finish setup**. |

**Finish setup** completes the setup and signs the owner in. The last page, **Lunedo is ready**, suggests what to do next: set up e-mail, invite people, create the first space and connect an identity provider. Every step is required. The setup state is stored in the database, so all nodes agree on it.

E-mail is set up afterwards under **Settings › Instance › Services › Delivery**; see [E-mail](email.md). Until then, **Settings › Instance › General** shows that Lunedo sends no invitations and no e-mail notifications.

### Formats of the organization

The organization step proposes the formats from the language and time zone it opens with. The proposal is shown in one line and opens for changes on click; it is stored at the organization level, and everyone can change it for themselves later. Choosing another language in the step does not change the proposal.

| Language and time zone | Date | Time | Numbers | Week starts on |
|---|---|---|---|---|
| German | `D MMM YYYY` | 24-hour | `de-DE`, `de-CH` in `Europe/Zurich` and `Europe/Vaduz` | Monday |
| English, time zone `America/…` or `US/…` | `D MMM YYYY` | 12-hour | `en-US` | Sunday |
| English, every other time zone | `D MMM YYYY` | 24-hour | `en-US` | Monday |

### Emergency kit

The emergency kit is one text file, `lunedo-emergency-kit-<host>.txt`. It holds, each with a sentence on what it is for:

- the address of the instance and the date;
- ten new recovery codes of the owner, created when the kit is downloaded;
- `LUNEDO_MASTER_KEYS`, which encrypts stored secrets such as the passwords of mail servers and identity providers;
- `LUNEDO_BACKUP_KEY`, which encrypts the backups.

Keep it outside the server, for example in a password manager. Whoever has it can sign in as the owner and decrypt backups. The kit can be downloaded only once. Changing the owner account afterwards makes its recovery codes invalid, so the step asks for a new kit.

Confirming the step also confirms the backup key on the backups page. Outside the setup the two stay separate: new recovery codes come from the account settings, the keys from the server; see [Encryption](encryption.md).

## Restore during the setup

Instead of setting up a new instance, **Welcome** restores a backup into this empty instance: **Upload a backup**, **From an S3 target** or **From the server**. It asks for the keys of the earlier server, restores the database and the file store, and restarts the instance. The steps are described in [Restore](restore.md).

## Setup through configuration

All values of the assistant can be given through configuration instead; see [Setup through configuration](setup-through-configuration.md). The assistant is then skipped and no setup code is printed. The owner sets up a second factor at the first sign-in, and the keys must be backed up by the operator.
