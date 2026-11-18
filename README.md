# circlet

A Chromium extension for opening **public** and **sealed** Octra Circle applications.

```
oct://poctra.oct
oct://oct3A5bhpktxb9y2gepQeGxSbkJspq3Pv178Zyi9tkM1oJx
```

## Features

- **Public and sealed Circles** — open Circle apps normally, or unlock sealed Circles with a read passphrase that is processed only on your device.
- **Devnet / Mainnet** — switch networks from the viewer, dashboard, or popup. Public RPC endpoints are tried automatically.
- **Octra Name Service** — open `name.oct` and `app.name.oct` names anywhere an Octra address is accepted.
- **Bookmarks** — save Circles, Octra account addresses, and regular website URLs for later.
- **Address-bar workflow** — type `oct` + Space in Chrome's address bar, then an address, `oct://` URI, or `.oct` name.
- **Fullscreen mode** — let a Circle fill the whole tab. Toggle from the toolbar or press `Ctrl+Shift+F`; press `Esc` to exit.
- **Chain status** — the dashboard shows the active network, epoch, latency, and chain ID.
- **Read-only chain access** — Circle apps can read Octra data. Transactions and wallet actions are never signed by circlet.

## Install

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this folder.
4. Pin **circlet**, then open the dashboard or press `oct` + Space in the address bar.

## Usage

| Input | Result |
| --- | --- |
| `oct3A5bhpktxb9y2gepQeGxSbkJspq3Pv178Zyi9tkM1oJx` | Open the Circle at its root path |
| `poctra.oct` | Resolve the name on the active network, then open |
| `oct://poctra.oct/gallery.html` | Open a specific Circle path |
| `oct://oct…/` | Open the Circle root |
| `oct` + Space, then type | Omnibox suggestions with live resolution |

Chrome does not allow extensions to register a native `oct://` protocol handler or replace the main address bar. The `oct` keyword, popup, dashboard, and link interception cover that gap.

## Networks

| Network | RPC | Explorer |
| --- | --- | --- |
| Mainnet | `https://octra.network/rpc` | `https://octrascan.io` |
| Devnet | `https://devnet.octrascan.io/rpc` | `https://devnet.octrascan.io` |

Add or edit networks in **Settings → Networks**. Built-in networks use HTTPS endpoints. Custom networks can point to your own node.

## Privacy and safety

- Circle apps run in an isolated environment and cannot access the extension, other websites, browser data, or your wallet.
- Circle apps have read-only access to Octra chain data. circlet does not include a wallet or signer.
- Sealed Circle passphrases stay in this browser session and expire automatically.
- Remote assets for public Circles are downloaded and embedded before the Circle opens. Circle apps cannot make their own network connections.
- Bookmarks, recent Circles, and settings are stored locally in your browser profile.
- No telemetry, analytics, or tracking is included.

## Limitations

- Chrome controls the main address bar; `oct://` is not a registered protocol.
- Circle apps must be self-contained and cannot call their own backend services.
- Circle apps that depend on browser-level navigation, iframes, or service workers run in a reduced environment.
- Sealed Circles require the correct read passphrase and cannot load resources from another Circle.

## Feedback

Report bugs or feature requests through the project's issue tracker.
