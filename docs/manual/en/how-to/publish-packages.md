# Publish marketplace packages

This guide builds a marketplace repository of widgets, themes and languages that Keyring Notes can download.

It is for people who make packages or run their own repository.

> [!NOTE]
> To install packages in the app, see [Install packages](install-packages.md).

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
| `dataFile` | object | Optional. A data file the widget keeps next to the note: `ext` (lowercase letters and digits, not `md`), `initial` (non-empty text), `name` (optional, language tag → name) |
| `isolation` | string | Optional. Always `frame`: downloaded widgets always run in an isolated frame |

The `colors` object of a theme has `light`, `dark` or both. Each maps a color token to a color value.

```json
"colors": {
  "light": { "--bg": "#fdfaf3", "--accent": "#b4532a" },
  "dark": { "--bg": "#1d1b18", "--accent": "oklch(0.72 0.12 45)" }
}
```

- Token names look like `--bg`: two dashes, then lowercase letters, digits and `-`. Size, font and spacing tokens (`--fs-*`, `--font-*`, `--radius-*`, `--*-h`, `--*-w`) are refused. Themes change colors only. The app reads only the tokens in the table below. Other tokens are ignored, and `pkg check` warns about them (`unknown_tokens`).
- Values are `#rgb`, `#rrggbb`, `#rrggbbaa`, or `rgb()`, `rgba()`, `hsl()`, `hsla()`, `oklch()`, `oklab()` with numbers, `%`, `deg`, spaces, `,` and `/` inside. Anything else is refused, including names such as `red`, `var(…)`, `url(…)` and values with `;`, `{`, `}` or `!`.
- A token the theme leaves out keeps the default value of that mode.
- If a theme has only `light` or only `dark`, the app always draws it in that mode, whatever the system setting is.

#### Theme tokens

| Token | Used for | Light default | Dark default |
| --- | --- | --- | --- |
| `--bg` | Page background | `#ffffff` | `#17191c` |
| `--bg-soft` | Side panels, code blocks, inputs | `#f6f7f9` | `#1f2226` |
| `--fg` | Body text | `#1f2328` | `#e6e6e6` |
| `--muted` | Secondary text | `#6b7280` | `#9aa0a6` |
| `--border` | Lines and borders | `#e3e6ea` | `#30343a` |
| `--accent` | Links, buttons, selection | `#3b6fd8` | `#7aa2f7` |
| `--hover` | Hovered rows | `rgb(0 0 0 / 0.05)` | `rgb(255 255 255 / 0.06)` |
| `--active` | Selected rows | `rgb(59 111 216 / 0.12)` | `rgb(122 162 247 / 0.16)` |
| `--focus-ring` | Keyboard focus ring | `rgb(59 111 216 / 0.55)` | `rgb(122 162 247 / 0.6)` |
| `--warn-bg` | Warning background | `#fff4e5` | `#3a2a12` |
| `--warn-fg` | Warning text | `#8a4b00` | `#f5c27a` |
| `--info-bg` | Notice background | `#eef4ff` | `#1d2a42` |
| `--danger` | Errors and destructive actions | `#c0392b` | `#ff8a80` |
| `--danger-bg` | Error background | `#fdeceb` | `#3a1c1a` |
| `--notice` | Notification dot (for example a new version) | `#e8590c` | `#ff9f43` |
| `--success` | Success text | `#1d7438` | `#84d39f` |
| `--success-bg` | Success background | `#eaf6ed` | `#16281c` |
| `--series` | Chart series | `#3b6fd8` | `#5b8def` |
| `--cat-1` | Graph topic color 1 | `#2a78d6` | `#3987e5` |
| `--cat-2` | Graph topic color 2 | `#eb6834` | `#d95926` |
| `--cat-3` | Graph topic color 3 | `#1baf7a` | `#199e70` |
| `--cat-other` | Graph: other topics | `#a3a29d` | `#6b6a66` |
| `--grid` | Chart grid | `#eceef1` | `#26292e` |
| `--axis` | Chart axis | `#c9ced6` | `#3a3f46` |
| `--find-match` | Find in note: matches | `rgb(250 204 21 / 0.4)` | `rgb(250 204 21 / 0.22)` |
| `--find-current` | Find in note: current match | `rgb(249 115 22 / 0.45)` | `rgb(249 115 22 / 0.5)` |
| `--tok-keyword` | Code: keywords | `#8250df` | `#ff7b72` |
| `--tok-string` | Code: strings | `#0a3069` | `#a5d6ff` |
| `--tok-string2` | Code: other literals | `#116329` | `#7ee787` |
| `--tok-number` | Code: numbers | `#0550ae` | `#79c0ff` |
| `--tok-comment` | Code: comments | `#6e7781` | `#8b949e` |
| `--tok-def` | Code: definitions | `#6639ba` | `#d2a8ff` |
| `--tok-type` | Code: types | `#953800` | `#ffa657` |
| `--tok-prop` | Code: properties | `#0550ae` | `#79c0ff` |
| `--tok-meta` | Code: meta | `#57606a` | `#8b949e` |
| `--tok-deleted` | Code: deleted | `#82071e` | `#ffa198` |
| `--tok-invalid` | Code: invalid | `#cf222e` | `#ff7b72` |
| `--co-blue` | Callout (blue): title | `#2f63c4` | `#8eb6ff` |
| `--co-blue-bg` | Callout (blue): background | `#eef4ff` | `#1a2436` |
| `--co-teal` | Callout (teal): title | `#0d7377` | `#74d2d5` |
| `--co-teal-bg` | Callout (teal): background | `#e7f5f5` | `#142728` |
| `--co-green` | Callout (green): title | `#1d7438` | `#84d39f` |
| `--co-green-bg` | Callout (green): background | `#eaf6ed` | `#16281c` |
| `--co-yellow` | Callout (yellow): title | `#845c00` | `#efcb6c` |
| `--co-yellow-bg` | Callout (yellow): background | `#fff6d9` | `#2b2512` |
| `--co-orange` | Callout (orange): title | `#9c4700` | `#f4b07c` |
| `--co-orange-bg` | Callout (orange): background | `#fff0e1` | `#31220f` |
| `--co-red` | Callout (red): title | `#b42318` | `#ff9c93` |
| `--co-red-bg` | Callout (red): background | `#fdeceb` | `#331919` |
| `--co-purple` | Callout (purple): title | `#6a3ec0` | `#c6aaff` |
| `--co-purple-bg` | Callout (purple): background | `#f3eefe` | `#241c36` |
| `--co-gray` | Callout (gray): title | `#565d69` | `#b5bbc5` |
| `--co-gray-bg` | Callout (gray): background | `#f3f4f6` | `#22252a` |
| `--mark-bg` | Highlight background (==text==) | `#fff0a0` | `#5c4d00` |
| `--mark-fg` | Highlight text | `#1f2328` | `#fff4c4` |

The editor's selection and current-line colors, shadows and the dark-mode tints inside the editor follow the mode (light or dark), not the tokens.

#### Contrast

The app measures the contrast of body text (`--fg`) on the background (`--bg`) in each mode the theme draws, with the WCAG 2 formula. A missing token counts as the default value of that mode, and a see-through `--bg` is laid over the default background. Below 4.5:1, `pkg check` warns (`contrast: light 3.2`), and the app shows a warning when the theme is installed or chosen. The theme still installs. The ratio is rounded down, so a warning never shows 4.5. If a value passes the format check but the app cannot read it as a color, the warning shows `?` instead of a ratio.

A `language` package's `messages.json` uses the same format as a language pack file (`meta` and `messages`). Missing keys are allowed and fall back to the base language.

- `meta.id` is the language tag that users pick, such as `ja` or `pt-BR`. It cannot be an official language (`en`, `ko`).
- The app uses only keys that exist in the base language, with string values and the same `{name}` placeholders as the base language. Other keys are dropped, and those messages are shown in the base language. `pkg check` lists them as warnings.
- Values are always shown as plain text, even when they look like HTML.
- If a device has an unofficial language pack with the same `meta.id`, that device uses its own pack. If two installed packages have the same `meta.id`, the one installed first is used.

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

### Widget rules

- **The block in a note.** A widget block names the package id and the state version: `{"widget": "@me/clock@1", "state": {…}}`. The number after the last `@` is `stateVersion`, not the package version.
- **Upgrading stored state.** When you change the shape of the state, raise `stateVersion` and pass `migrate` as the second argument: `keyringWidgetRegister(render, { migrate })`. The app calls `migrate(state, from)` inside the frame before it passes a block's state to your widget, when the block's state version is lower than `stateVersion`. The note is written with the new version the next time the widget changes the state. Opening a note alone does not change it. If `migrate` throws, the app shows an error and the block's source text instead of the widget. Without `migrate`, the app passes the old state unchanged.
- **The `file` key is reserved.** The app owns `state.file`, the path of the data file. A `file` key that your widget passes to `setState` or returns from `migrate` is replaced with the block's current value. A widget without `dataFile` loses the key. Do not use `file` as a name in your own state.
- **Data files.** `dataFile.ext` cannot be `md`, because the file would become a note. A new data file is named `<name>-<random>.<ext>` next to the note. `<name>` comes from `dataFile.name`, then the package name.
- **Messages.** Keys use letters, digits, `_`, `.` and `-`, start with a letter, digit or `_`, and are at most 100 characters. A plural form adds `#zero`, `#one`, `#two`, `#few`, `#many` or `#other` (for example `count#one`). Each file can have 1000 keys, and each value 2000 characters. The app drops keys that break these rules, and `pkg check` lists them as warnings (`messages_dropped`). The app always shows widget messages and manifest names as plain text, never as HTML.
- **`frame.js`** is a classic script, not a module. `import` and `export` are not allowed. The limit is 8 MiB, and `pkg check` warns above 1 MiB (`large_frame_js`), because the app sends the code to every frame again.
- **`frame.css`** applies only inside the widget's frame. It cannot change the app. External addresses (`@import`, `url(https://…)`) are blocked. Put images and fonts in `data:` URLs.
- **Check before you publish.** Run `pkg check` on every widget version. `pkg index` does not check the syntax of `frame.js`. A widget with a syntax error is still listed, and after 20 seconds the app shows "Couldn't load the widget" in its place.

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
          "name": { "en": "Clock", "ko": "시계" },
          "description": { "en": "A desk clock" },
          "author": "me",
          "license": "MIT",
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
- `name`, `description`, `author` and `license` are optional copies of the manifest fields. They are for browsing only, so the marketplace can show a whole repository from one download. Once a package is installed, the app shows the manifest (checked against its checksum) instead. `pkg index` copies them for you.

| Display field | Type | Limit |
| --- | --- | --- |
| `name` | object, language tag → text | 20 languages, 100 characters each |
| `description` | object, language tag → text | 20 languages, 500 characters each |
| `author` | string | 100 characters |
| `license` | string | 100 characters |

The app drops a display field that breaks these rules and keeps the version; the package is then shown by its id. `pkg index` does not shorten a field that is too long: it leaves the field out of `index.json` and prints a warning (`display_too_long: description.en`). `pkg check` prints the same warning.

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

- `pkg check <folder>` checks the manifest, the required and allowed files, theme colors, language keys, widget message keys and the syntax of `frame.js`. It does not run `frame.js`. It exits with code `1` on an error and prints warnings, such as missing language keys, unknown theme tokens, low contrast, dropped widget message keys or a large `frame.js`, without failing.
- `pkg index <folder>` checks every package under `packages/`, measures each file, copies the display fields from each manifest and writes `index.json`. It keeps the `name` of an existing `index.json`, then uses `--name`, then the folder name. Running it again on unchanged files leaves `index.json` untouched.

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
