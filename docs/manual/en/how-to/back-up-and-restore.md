# Back up and restore

This guide makes backups, restores them, moves the vault to another server, and keeps copies in S3-compatible storage.

It is for people who run the server.

## Make and download a backup

Open Settings → **Backup & restore** (owner only).

- **Back up now** makes a backup. You can download any backup from the list.
- Automatic backups run when the interval has passed (24 hours by default) and something changed since the last automatic backup. Only automatic backups are pruned beyond the count you keep (14 by default).
- Choose whether backups include the config (password and token hashes, permission tables).

A backup is one `.tar.gz` file with the full Git history of every note and attachment. The format is in [Reference](../reference.md#backup-file-format). Changes made outside the server right before a backup are committed and included.

To turn automatic backups off on a server, set `KEYRING_BACKUP_SCHEDULER=0`.

## Restore a backup

Choose **Restore** on a backup in the list. Restoring the config is optional.

Before it switches the vault, the restore saves the current state as a `pre-restore` backup and keeps the current Git HEAD at `refs/keyring/before-restore-<timestamp>`. A restore can therefore be undone. Settings cannot be closed while a restore or upload is running.

## Move to another server

1. Download a backup from the old server.
2. On the new server, upload it in Settings → **Backup & restore**.
3. Choose **Restore**. Restore the config too to keep passwords and agents.

## Keep backups in S3-compatible storage

The source of truth stays on the server's disk (vault folder and Git). S3-compatible storage (AWS S3, Cloudflare R2, MinIO, Backblaze B2 and others) adds two things. To set it up with Docker, see [Deploy with Docker](deploy-with-docker.md#3-choose-s3-storage-optional). All keys are in [Configuration](../configuration.md).

The bucket is never made public. Attachments are still served by the server after it checks permissions.

### Remote backups

Remote backups turn on as soon as `KEYRING_S3_BUCKET` and the keys are set.

- Every backup is also uploaded to `<prefix>backups/` (**Also upload to S3**, on by default).
- Automatic backups on S3 are pruned to their own count (**Automatic backups to keep on S3**, 30 by default).
- If an upload fails, the local backup is still made and the admin console shows a warning.

If you lose the server, start a new one with the same S3 settings. In Settings → **Backup & restore**, find the backup under the S3 remote backups, then fetch it and restore it.

### Large attachments in S3

With `KEYRING_S3_BLOBS=1`, attachments (non-Markdown files) at or above the size threshold (`KEYRING_S3_BLOB_MIN_KB`, 256 KB by default) are uploaded to `<prefix>blobs/` under their content hash and left out of Git. Git keeps only a path-to-hash list, `.keyring-blobs.json`, the same approach as Git LFS. The files stay in the vault folder, so the app, API, sync and other editors see no difference, while Git history and backups get smaller.

- When you turn it on, large attachments already in Git are dropped from history too. Copies inside past commits remain.
- If an upload fails, the write still succeeds and the file waits to upload, retried every 5 minutes. Waiting attachments are not included in backups, and the admin console warns about them.
- A restore downloads attachments from S3 according to that backup's list and removes attachments created after it.
- S3 objects are named by content hash, so they are never overwritten and never deleted, because past backups may point to them. If you add versioning or lifecycle rules to the bucket, exclude `blobs/`.
- Attachment history is in the Git history of `.keyring-blobs.json`, not in the note history view.

### Encrypt before upload

With `KEYRING_S3_ENCRYPTION_KEY` set, backups and attachments are encrypted on the server with AES-256-GCM before upload. The storage operator, or anyone with a leaked access key, cannot read the contents.

- Use a long random string as the key, for example from `openssl rand -base64 32`.
- The key is stretched with scrypt. The salt and a key check value are kept in `<prefix>encryption.json`; they are not secret.
- Starting with a different key logs a message and stops uploads, so data under different keys never mixes.
- Attachments go to `<prefix>blobs-enc/` under HMAC names instead of content hashes, so nobody can tell which files you have by matching hashes. Sizes, upload times and backup names are not hidden.
- Backups and attachments uploaded before you turned encryption on stay readable. Downloaded attachments are checked against their content hash.
- Local backups on the server's disk are not encrypted. Leave disk encryption to the operating system.

> [!WARNING]
> If you lose the key, encrypted backups and attachments cannot be recovered. Store it outside the server, for example in a password manager. Changing the key is not supported.

## Next steps

- [Manage the server](manage-the-server.md)
- [Deploy with Docker](deploy-with-docker.md)
