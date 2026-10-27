# Backups to a directory

Lunedo can write its backups to a directory inside the container. Mount a network share (NFS or SMB) there to keep the backups on another machine. Set the target under **Settings › Instance › Operations › Backups**, section **Target**, with **Where backups are written** set to **Directory**. The other backup settings are described in [Backups](../backups.md).

## The directory

**Directory** is an absolute path inside the container, for example `/var/lib/lunedo/backups`, the default of `LUNEDO_BACKUP_DIR`. The directory:

- must exist and be writable by the container user (user 1000, `node`);
- must not be, or lie inside, the file store (`LUNEDO_FILES_DIR`), the secrets directory (`LUNEDO_SECRETS_DIR`), the import folder (`LUNEDO_IMPORT_DIR`) or the work directory (`LUNEDO_WORK_DIR`);
- must not contain the work directory, and must not be the root directory.

When the directory is on the same volume as the file store, the section warns that one disk failure loses both. Mount a separate disk or a network share, or use [S3-compatible storage](s3.md).

**Test connection** writes, reads, lists and deletes a small test file without saving the settings. A failure names the step and the cause: the directory does not exist in the container, the container user may not write there, the file system is mounted read-only, or the target is full. **Save target** saves the settings.

A backup is written under a temporary name and renamed when it is complete, so the directory never shows a partial backup under a backup name. Before each backup, Lunedo removes unfinished files of its own earlier runs.

## Setup script

The Compose file of the setup script mounts the folder `backups` of the installation directory (for example `/opt/lunedo/backups`) at `/var/lib/lunedo/backups`. The script gives it to user 1000 with mode 750. This folder is on the same disk as the file store unless you mount something else there, so copy its content to another machine or use a network share.

## A network share as target

Mount the share into the container and use the mount point as directory. With Docker Compose and NFS:

```yaml
services:
  lunedo:
    volumes:
      - lunedo-data:/var/lib/lunedo
      - backups:/mnt/backups

volumes:
  lunedo-data:
  backups:
    driver: local
    driver_opts:
      type: nfs
      o: addr=nas.example.com,rw,nfsvers=4
      device: ":/export/lunedo-backups"
```

For SMB, use `type: cifs`, `device: "//nas.example.com/lunedo-backups"` and `o: "username=lunedo,password=${SMB_PASSWORD:?Set SMB_PASSWORD in .env},uid=1000,gid=1000,file_mode=0600,dir_mode=0700"`, and put `SMB_PASSWORD` into `.env` (mode 600) instead of writing the password into `compose.yml`. The container runs as user 1000 (`node`).

Then:

1. Run `docker compose up -d` so that the container gets the new mount.
2. Set **Directory** to `/mnt/backups`.
3. Use **Test connection**, then **Save target**.
