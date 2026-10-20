# Manage the server

This guide covers the admin console: server status, agents, devices, updates, your password and passkey login.

It is for the owner of a Keyring Notes server.

## Open the admin console

The admin console is the **Server** group in Settings, or the **Server administration (settings)** command. Only the owner can use it; agent tokens get 403. There is no Server group in local mode (the app, or `?local`).

| Tab | What you can do |
| --- | --- |
| **Server status** | See version and uptime, note and file counts and size, commit count and last change, free disk space, backup status, and each agent's last access. It warns about no HTTPS, no allowed hosts, no backups or low disk space |
| **Agents & permissions** | Create an agent (the token and an MCP config example are shown once), edit per-folder permission tables, reissue tokens, delete agents |
| **Devices** | See devices connected from the app and their last sync, and disconnect a device |
| **Backup & restore** | Back up, download, upload, restore, and set automatic backups. See [Back up and restore](back-up-and-restore.md) |
| **Automation** | Webhooks and scheduled jobs. See [Automate with webhooks](automate-with-webhooks.md) |
| **Updates** | See the current and latest version, and how to update |
| **Security** | Change the password, register and delete passkeys, read the remote access guide |

On screens that show a token or webhook secret only once, or with an unsaved permission table or webhook form, you are asked before closing Settings or switching groups.

## Change the password

Change it in **Security**. Every other device is logged out. You can also set it from the terminal with `pnpm keyring passwd`, or `docker compose exec keyring keyring passwd` with Docker.

## Log in with a passkey

A passkey logs you in with a fingerprint, face recognition, the device lock or a security key (WebAuthn), without a password.

1. Open **Security** and click **Register a passkey for this address**.
2. Follow your browser's prompt.

The login screen then shows **Log in with a passkey**. Password login stays available as your fallback if you lose the passkey.

- A passkey is bound to the host name it was registered on. A passkey registered on `notes.example.com` cannot be used through an IP address or another name.
- Browsers allow passkeys only on https addresses and `localhost`.
- The server stores only public keys and checks a signature over a one-time challenge (valid for 5 minutes) at each login. Requests whose origin differs from the accepted host are rejected. So is a signature counter that goes backwards, which may mean a cloned authenticator. Repeated failures slow responses down, as with passwords.

## Next steps

- [Deploy with Docker](deploy-with-docker.md): updating and remote access.
- [Connect agents](connect-agents.md)
