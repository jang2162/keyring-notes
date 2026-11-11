# Install packages

This guide installs widgets, themes and languages from a marketplace repository and uses them on every device.

Installed packages are recorded in the vault's shared settings, so every device uses the same version of the same files.

## Open the marketplace

Open Settings → **Marketplace**. You can also open the command palette (`Mod+P`) and run **Open marketplace**.

The screen has four parts: **Installed**, **Browse**, **Repositories** and, in the desktop app, **This device**.

Who downloads the packages depends on how you use the app:

| You use | Downloads |
| --- | --- |
| A server (web, mobile or the desktop app on a server) | The server |
| The desktop app with a device vault and server sync | The server, then the app itself if the server cannot reach the repository |
| The desktop app with a device vault and no sync | The app |
| A browser device vault with server sync | The server |
| A browser device vault without sync | Nothing. The screen says so, and packages already on the device keep working |

## Add repositories

The list starts with the official repository, `https://keyring-notes-marketplace.develma.com/`. The order is the priority: when two repositories have the same package, the upper one is used.

1. Type the repository address under **Repositories** and click **Add**, or press Enter.
2. Use **Up** and **Down** to change the order, and **Remove** to take a repository out.

- Addresses must use `https:`. An address that is already in the list, uses another scheme, or contains a user name or password is refused under the box.
- An `http:` address is saved, but only downloads if it is allowed. On a server, the operator sets `KEYRING_MARKET_ALLOW_HTTP`. Private addresses, such as a repository on your home network, need `KEYRING_MARKET_ALLOW_PRIVATE`. In the desktop app, turn on the boxes under **This device**. That choice stays on this device. Otherwise the repository shows the error in its row.
- You can remove the official repository. **Add the official repository again** brings it back.
- Packages from the `@keyring` scope come only from the official repository.

To build your own repository, see [Publish marketplace packages](publish-packages.md). To run a server for it, see the [keyring-notes-marketplace](https://github.com/jang2162/keyring-notes-marketplace) README.

## Browse and install

**Browse** lists the packages of every repository, with name, description, author, license and version. Pick a kind to show only themes, languages or widgets.

1. Click **Install** next to a package.
2. The package moves to **Installed**. Other devices download the same version the next time they read the shared settings.

- **Refresh** asks the repositories again. On a server the list is otherwise kept for 5 minutes, and **Refresh** downloads each repository at most once every 10 seconds.
- **Also in** means another repository has a package with the same id. After you install, the package always comes from the repository it was installed from.
- **No version works with this app** means every version needs a newer app.
- Installing a widget first asks you to confirm a notice. Widgets run isolated from the app, so they cannot reach the app or your notes. They can still communicate with the outside (WebRTC). Click **Install** to go on, or **Cancel** to leave everything as it was. The same notice is shown above **Installed** while a widget is installed. Updates do not ask again.

## Install a widget from a note

A widget block whose widget is not installed shows its source and **Widget … not found**. If the widget id is a marketplace id (`@scope/name`), the message has an **Install** button.

1. Click **Install**. The marketplace opens and shows only that widget.
2. Click **Install** in its row and confirm the notice. The block turns into the widget without reopening the note.

- If no repository in your list has the widget, the marketplace says so and moves the cursor to the repository address box. Add the repository that publishes the widget, and its row appears.
- History view does not show the button.

## How installed widgets behave

- **Remove:** The blocks stay in your notes. Each block shows its source and **Install**.
- **Update:** An open widget switches to the new version after you finish editing it. A data file widget saves its file first when autosave is on. When autosave is off, your unsaved drawing is kept and **Unsaved drawing** stays until you save.
- **Removed while editing:** If the widget is removed, stops working on this app version, or is changed to an older version (the block shows **This widget needs a newer version**) while you are editing it, your changes are kept in memory behind the error block. When the widget works again, editing continues where you left off. Your changes are not saved to the file, so they are lost when you close the app.
- **Starting up:** Right after the app opens, widget blocks show **Preparing the widget…** until the installed packages are checked. Widgets already on the device are drawn offline too.
- **Older app:** On a device whose app version the widget does not support, the block shows **Update the app to see this widget**.
- **Could not download:** The block shows **Couldn't get this widget** and the reason, with **View in marketplace**.

## Update and remove

When a repository has a newer version, the package shows **New version** under **Installed**. Updates never happen on their own.

- Click **Update to 1.1.0** to install it. Every device switches to that version.
- Click **Remove** and confirm to remove a package from every device. If you remove the theme or language you were using, the choice goes back to the default on every device.
- If one device removes a package while another updates it, the update wins and the package stays installed. Remove it again if you want it gone.

## Pick a theme

Open Settings → **General** → **Theme**. The list has **System**, **Light**, **Dark** and the installed themes. The choice follows you across devices unless you turn on **Different on this device only**.

- A theme with both light and dark colors follows the system setting. A theme marked **light only** or **dark only** always draws in that mode.
- If text and background are too close (below 4.5:1), a warning appears under the list. The theme is still used.
- A theme only changes colors. The editor's selection and current-line colors and Mermaid diagrams follow the mode (light or dark), not the theme colors.

### Go back to the default theme

If a theme makes the screen hard to read, there are several ways back:

- Click **Back to the default theme** below the theme list.
- Open the command palette (`Mod+P`) and run **Back to the default theme**. This also works in the desktop app, which has no address bar.
- In a browser, open the app address with `?theme=default` at the end. The downloaded theme is not drawn for that visit. Then change the theme in Settings.
- On a phone (the installed web app or the mobile app), open the same vault in a browser with `?theme=default` and change the theme there. A shared choice reaches every device. You can also delete `ui.theme` from `keyring-settings.md`.

## Pick a language

Open Settings → **Language** → **Display language**. Marketplace languages are marked **(marketplace)**.

- Keys the package does not translate are shown in its base language, then in English. Messages whose `{name}` placeholders differ from the base language are shown in the base language too.
- If this device has an unofficial language pack with the same language id, the pack on this device is used. Its row says **used instead of the marketplace package**.
- If two marketplace packages have the same language, the one installed first is used.
- If your display language is the system language and a marketplace package adds it, the app switches to it.

## When a device cannot use a package

A device that has not downloaded a theme or language yet, cannot reach the repository, or runs an app version the package does not support shows the default theme or the base language. Widgets are described in [How installed widgets behave](#how-installed-widgets-behave). Settings → **General** says that the chosen theme is not on this device. The choice is kept, and the theme comes back when the package arrives.

- An older app that does not know downloaded themes shows the system theme.
- Packages already on a device keep working offline. The theme and language are drawn from the device's copy at start, so they do not flash.
- On a server, the web app reads changes from other devices (a new theme choice, an install, an update or a removal) when you reload the page or save a note. A widget that another device installed or updated appears after you reload.
- If another device updates a widget and this device cannot download the new version (for example, the server cannot reach the repository), the widget blocks show **Couldn't get this widget** and their source until the download works. Your notes do not change. The app tries again when the connection comes back. If the message stays, reopen the app.
- A widget can send data it already has to the outside with WebRTC. The app cannot block this. It only shows the notice when you install.
- A widget can also put data it already has into the address it tries to open. The app stops the widget, but cannot always stop that request.
- When another device installs a widget, this device does not show the notice.
- A Mermaid diagram keeps the mode it was drawn with. After the mode changes, reload the page to redraw it.

## Next steps

- [Customize settings](customize-settings.md)
- [Publish marketplace packages](publish-packages.md)
- [Run your own marketplace](https://github.com/jang2162/keyring-notes-marketplace)
