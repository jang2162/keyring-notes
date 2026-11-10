# Publish marketplace packages

This guide builds a marketplace repository of widgets, themes and languages that Keyring Notes can download.

It is for people who make packages or run their own repository.

> [!NOTE]
> The app cannot install or use packages yet. Installing from the app, themes, languages and widgets arrive in later releases. You can already build and check repositories with the commands below.

## How a repository is laid out

A repository is a folder of static files. You can serve it from any web server or static hosting service.

```text
<repository>/index.json
<repository>/packages/<scope>/<name>/<version>/<files>
```

- A package id is `@<scope>/<name>`. Both parts use lowercase letters, digits and `-`, and start with a letter or digit. The folder name drops the `@`: the files of `@me/clock` 1.0.0 are in `packages/me/clock/1.0.0/`.
- The scope `@keyring` is reserved for the official repository. The app ignores `@keyring/…` packages in any other repository.
- Each file is listed in `index.json` with its SHA-256 checksum. The app refuses a file whose checksum does not match.

## Package files

Every package has a manifest named `keyring-package.json`. The other files depend on the type.

| Type | Required files | Optional files |
| --- | --- | --- |
| `widget` | `frame.js` | `frame.css`, `messages/<language>.json` |
| `theme` | none | none |
| `language` | `messages.json` | none |

No other file names are allowed, including hidden files such as `.DS_Store`. Symbolic links are refused. Two names that differ only in case (`messages/ko.json` and `messages/KO.json`) are refused, because they are the same file on macOS and Windows. Widgets carry images and fonts inside `frame.js` or `frame.css` (for example as `data:` URLs).

### The manifest

```json
{
  "id": "@me/clock",
  "version": "1.0.0",
  "type": "widget",
  "name": { "en": "Clock", "ko": "시계" },
  "description": { "en": "A clock for your notes" },
  "author": "Me",
  "license": "MIT",
  "engines": { "keyring": ">=0.13.0" },
  "widget": { "stateVersion": 1, "display": "block", "defaultState": {} }
}
```

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | The package id. It must match the folder |
| `version` | string | The package version (see [Versions and ranges](#versions-and-ranges)). It must match the folder |
| `type` | string | `widget`, `theme` or `language` |
| `name` | object | Language tag → name. At least one entry |
| `description` | object | Language tag → description. At least one entry |
| `author` | string | The author |
| `license` | string | The license, for example an SPDX id |
| `engines.keyring` | string | The app versions this package works with, as a range |
| `widget` | object | Widgets only. See below |
| `colors` | object | Themes only. See below |

The `widget` object:

| Field | Type | Description |
| --- | --- | --- |
| `stateVersion` | integer ≥ 1 | The version of the state the widget stores in notes. It is separate from the package version |
| `display` | string | `block` or `inline` |
| `defaultState` | any JSON value | The state of a new widget |
| `dataFile` | object | Optional. A data file the widget keeps next to the note: `ext` (lowercase letters and digits), `initial` (non-empty text), `name` (optional, language tag → name) |
| `isolation` | string | Optional. Always `frame`: downloaded widgets always run in an isolated frame |

The `colors` object of a theme has `light`, `dark` or both. Each maps a color token to a color value.

```json
"colors": {
  "light": { "--bg": "#fdfaf3", "--accent": "#b4532a" },
  "dark": { "--bg": "#1d1b18", "--accent": "oklch(0.72 0.12 45)" }
}
```

- Token names look like `--bg`: two dashes, then lowercase letters, digits and `-`. Size, font and spacing tokens (`--fs-*`, `--font-*`, `--radius-*`, `--*-h`, `--*-w`) are refused. Themes change colors only. The list of tokens the app reads is published with theme support.
- Values are `#rgb`, `#rrggbb`, `#rrggbbaa`, or `rgb()`, `rgba()`, `hsl()`, `hsla()`, `oklch()`, `oklab()` with numbers, `%`, `deg`, spaces, `,` and `/` inside. Anything else is refused, including names such as `red`, `var(…)`, `url(…)` and values with `;`, `{`, `}` or `!`.

A `language` package's `messages.json` uses the same format as a language pack file (`meta` and `messages`). Missing keys are allowed and fall back to the base language.

### A minimal widget

`frame.js` runs inside an isolated frame. It calls `keyringWidgetRegister` once with a render function. The render function receives the element to draw in, the context and the API, and returns a cleanup function.

```js
self.keyringWidgetRegister((el, ctx, api) => {
  let state = ctx.state;
  const button = document.createElement("button");
  const draw = () => (button.textContent = api.t("clicks", { count: state.count ?? 0 }));
  button.addEventListener("click", () => api.setState({ count: (state.count ?? 0) + 1 }));
  api.onUpdate((next) => {
    state = next.state;
    draw();
  });
  el.append(button);
  draw();
  return () => button.remove();
});
```

`messages/en.json` for this widget:

```json
{ "clicks": "Clicked {count} times" }
```

| Context field | Description |
| --- | --- |
| `state` | The state to show (the draft while editing) |
| `editing`, `editable`, `readOnly` | Whether the widget is being edited, may be edited, or is shown read-only (for example in history) |
| `display` | `block` or `inline` |
| `lang` | The interface language |
| `theme` | The app's color token values |

| API | Description |
| --- | --- |
| `setState(patch)` | Merge `patch` into the state. Outside edit mode the block is written right away |
| `requestEdit()`, `exitEdit(apply)` | Enter edit mode, and leave it (`true` applies, `false` discards) |
| `t(key, vars)` | Text from `messages/<language>.json` |
| `onUpdate(callback)` | Called when the state, theme or language changes |
| `file.read()`, `file.write(bytes, baseHash)` | The data file, when the manifest has `dataFile` |
| `toggleFullscreen()` | Block widgets only |

## The index file

`index.json` lists every package and version in the repository.

```json
{
  "format": 1,
  "name": "My widgets",
  "packages": {
    "@me/clock": {
      "type": "widget",
      "versions": {
        "1.0.0": {
          "engines": { "keyring": ">=0.13.0" },
          "files": [
            { "path": "frame.js", "sha256": "…", "size": 20480 },
            { "path": "keyring-package.json", "sha256": "…", "size": 812 }
          ]
        }
      }
    }
  }
}
```

- `format` is `1`.
- `files` lists every file of the version, including `keyring-package.json`. `sha256` is 64 lowercase hexadecimal digits. `size` is in bytes.
- The app skips a version that breaks these rules and keeps the rest of the repository.

### Limits

| Limit | Value |
| --- | --- |
| One file | 8 MiB |
| One package version (all files) | 16 MiB |
| `index.json` | 2 MiB |
| One download, redirects included | 30 seconds (`index.json`: 15 seconds) |
| Redirects | 5 |

## Versions and ranges

Versions are `MAJOR.MINOR.PATCH`, optionally followed by `-` and a pre-release such as `1.2.0-beta.1`. Numbers have no leading zeros. Pre-releases use lowercase letters, digits and `-` only, because `1.2.0-Beta` and `1.2.0-beta` would be the same folder on macOS and Windows. Build metadata (`+…`) is not allowed, because the version is part of the file path.

`engines.keyring` is a range:

| Range | Matches |
| --- | --- |
| `*` | Any version |
| `1.2.0` or `=1.2.0` | Exactly 1.2.0 |
| `>1.2.0`, `>=1.2.0`, `<2.0.0`, `<=2.0.0` | Comparisons |
| `^1.2.0` | `>=1.2.0 <2.0.0` (`^0.2.0` is `>=0.2.0 <0.3.0`, `^0.0.3` is `>=0.0.3 <0.0.4`) |
| `~1.2.0` | `>=1.2.0 <1.3.0` |
| `>=0.13.0 <1.0.0` | Both (separate with a space) |
| `^1.0.0 \|\| ^2.0.0` | Either |

Pre-releases are compared in semver order with every range. Unlike npm, `>=1.0.0` also matches `2.0.0-beta`. When the app picks the newest version, it skips pre-releases. You can still install a pre-release by naming its version.

## Check a package and build the index

From a source checkout, run the commands with `pnpm keyring`. Relative paths are read from the folder you run the command in.

```bash
pnpm keyring pkg check my-repo/packages/me/clock/1.0.0
pnpm keyring pkg index my-repo --name "My widgets"
```

- `pkg check <folder>` checks the manifest, the required and allowed files, theme colors and language keys. It exits with code `1` on an error and prints warnings, such as missing language keys, without failing.
- `pkg index <folder>` checks every package under `packages/`, measures each file and writes `index.json`. It keeps the `name` of an existing `index.json`, then uses `--name`, then the folder name. Running it again on unchanged files leaves `index.json` untouched.

With Docker, run the same commands in the container. The folder must be inside the data volume (`/data`) or another volume mounted into the container.

```bash
docker compose exec keyring keyring pkg index /data/my-repo
```

You can also write `index.json` yourself or with another tool. Follow the format above exactly.

## Host the repository

Upload the whole folder to any host that serves static files as they are:

- Serve it over `https:`. The app downloads plain `http:` repositories and repositories on private networks only when the server operator or the device allows it.
- Do not compress responses. The app asks for uncompressed files and refuses compressed ones.
- Serve the files byte for byte. A changed file no longer matches its checksum.

After you publish a new version, run `pkg index` again and upload `index.json` with the new files. To run a server that rebuilds `index.json` by itself, see [Run your own marketplace](run-a-marketplace.md).

## Next steps

- [Use widgets](use-widgets.md)
- [Reference](../reference.md#command-line-interface)
