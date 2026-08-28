# Deployment: publishing to the VS Code Marketplace and Antigravity

Two artifacts ship: the `claude-codex-antigravity-notifier` npm package (CLI, for editor-less use — installs a `notifier` command) and the `vscode-extension` VSIX (same package installs into both VS Code and Antigravity, since Antigravity loads unmodified VS Code extensions — see [ARCHITECTURE.md](ARCHITECTURE.md#editor-integration-layer)).

**Status**: `publisher` is set to `kamalpulaparthi` in `vscode-extension/package.json`, the repo has a `LICENSE` (MIT), a `README.md`, and a `repository` field in both `package.json`s. Packaging is self-contained (`vscode:prepublish` vendors `bin/`+`lib/` into the extension folder so the VSIX doesn't depend on anything outside it). The root `package.json` name is `claude-codex-antigravity-notifier` (confirmed available on the npm registry — plain `notifier` is already taken by an unrelated package).

**Antigravity specifically installs from Open VSX**, not the VS Code Marketplace — it's a VS Code fork, and forks can't legally use Microsoft's Marketplace, so they use Open VSX instead. That means **§0.3 and the `ovsx publish` line in §4 are the only steps required to ship an Antigravity update.** The VS Code Marketplace / Azure DevOps PAT path (§0.1–0.2) is only needed if you also want the listing on `marketplace.visualstudio.com` for plain VS Code users.

A PAT/token is a secret and must never be typed into an agent chat session — if one is ever pasted here by mistake, treat it as compromised and revoke/regenerate it immediately. Treat §0 and the `-p <TOKEN>` commands in §4 as yours to run directly in your own terminal.

## 0. One-time account setup

1. **Open VSX (for Antigravity)** — this is the one that matters for Antigravity:
   - Go to **https://open-vsx.org** and sign in with **GitHub**.
   - Click your avatar (top right) → **Settings** → **Access Tokens** → **Generate New Token**. Name it something identifiable (e.g. "notifier-publish") and copy it immediately — it's shown once.
   - Token format looks like `ovsxat_xxxxxxxx-xxxx-...` (not to be confused with an Azure DevOps PAT below — the two are issued by unrelated systems and are **not interchangeable**).
2. **VS Code Marketplace** (optional, only if also publishing there): create a publisher at https://marketplace.visualstudio.com/manage (publisher id `kamalpulaparthi` is already set in `vscode-extension/package.json`).
3. **Azure DevOps PAT** (optional, pairs with #2): generate a Personal Access Token (scope: *Marketplace → Manage*) at https://dev.azure.com — this is what `vsce publish` authenticates with, and is a **different token from Open VSX's**.
4. **npm** (optional, for the CLI-only package): `npm login` with an account that can publish `claude-codex-antigravity-notifier`.

**Safer credential handling**: run `vsce login kamalpulaparthi` and `npm login` yourself in your own terminal (outside any agent session) before asking an assistant to run the actual publish commands — both store the resulting credential locally (OS keychain / `~/.npmrc`), so the CLI reads it back without ever needing the raw token typed into chat again. `ovsx publish`/`ovsx create-namespace` don't have a login step — their `-p <token>` flag is best run by you directly in your terminal, never handed to an assistant to paste in.

## 1. Version bump

Bump the version **in both** `package.json` (CLI) and `vscode-extension/package.json` (extension) together — they're released as a pair.

**Open VSX (and the VS Code Marketplace) both reject re-publishing an already-used version number** — even if a prior publish attempt errored or the extension shows as "not active" (see §6 troubleshooting). If you're not sure whether a version was already pushed, bump to the next patch rather than retrying the same one; the platforms have no "overwrite" option.

## 2. Build the VSIX

```bash
cd vscode-extension
npx @vscode/vsce package      # runs vscode:prepublish (vendors bin/+lib/+resources/) then produces notifier-<version>.vsix
```

**Always invoke it as `@vscode/vsce`, never bare `vsce`.** The unscoped `vsce` package on npm is the old, deprecated, unmaintained one — if it's ever installed globally, a bare `vsce package`/`vsce publish` silently resolves to it instead of the current tool (you'll see `npm warn deprecated vsce@2.15.0` in the output as the tell). Prefixing with `npx @vscode/vsce` sidesteps this entirely without needing a global install.

Before packaging, confirm `vscode-extension/resources/icon.png` actually exists — `package.json`'s `"icon"` field points at it, but nothing fails loudly if the file is missing except a broken icon in the published listing. To change the icon, replace that file (any square PNG; `vsce` will warn if it's larger than ~200KB, so 128×128 is a safe default: `sips -Z 128 source.png --out resources/icon.png`).

## 3. Verify before publishing (hard gate — do not skip)

Already done for this build via CLI-level tests + a mocked `vscode` API (see the test pass in this conversation) since no `code`/`antigravity` CLI was available in the sandbox that built it. Before you actually publish, do the one check that requires a real editor:

- Install `vscode-extension/notifier-<version>.vsix` in **VS Code**: Extensions view → `···` → *Install from VSIX…*, or from a terminal: `"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" --install-extension notifier-<version>.vsix --force` (the `Contents/MacOS/Code` binary does **not** accept CLI flags — use the one under `Contents/Resources/app/bin/code`). Confirm: status bar item appears, `~/.claude/settings.json` / `~/.codex/hooks.json` get the expected hook entries (`notifier doctor` from a terminal confirms this quickly).
- Install the **same** VSIX in **Antigravity** the same way (its own CLI binary, or *Install from VSIX…* in its Extensions view). Confirm identical behavior — this is the whole point of the shared-VSIX architecture, so a failure here blocks the release, not just a nice-to-have check. Note Antigravity keeps its own separate extensions folder (`~/.antigravity-ide/extensions/`, distinct from VS Code's `~/.vscode/extensions/`) and rewrites hook commands in `~/.claude/settings.json`/`~/.codex/hooks.json` to point at *its own* installed copy — whichever editor you last installed/reloaded in "wins" the hook path. That's expected, not a bug.
- Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) in both editors, type `Notifier`, and confirm every contributed command appears and runs — this is also the actual verification path end users will follow, per the "How to run a command" section in `vscode-extension/README.md`.
- Run through the mute/unmute, auto-mute-when-focused, sound preview/choose, volume, and threshold commands in both editors once.

## 4. Publish

Run all of these **from `vscode-extension/`** (the `.vsix` path is relative) — a common mistake is running `ovsx publish` from the repo root, which fails with `ENOENT: no such file or directory, open 'notifier-<version>.vsix'`.

```bash
cd vscode-extension

# Open VSX (Antigravity + other VS Code forks that install from it) — the one that matters for Antigravity
npx ovsx create-namespace kamalpulaparthi -p <OPEN_VSX_TOKEN>   # one-time only; safe to re-run, errors harmlessly with "Namespace already exists" after the first time
npx ovsx publish notifier-<version>.vsix -p <OPEN_VSX_TOKEN>

# VS Code Marketplace (optional — only if also targeting plain VS Code users)
npx @vscode/vsce publish -p <AZURE_DEVOPS_PAT>

# CLI, for terminal/JetBrains/Neovim/editor-less users (optional)
cd ..
npm publish   # publishes claude-codex-antigravity-notifier
```

## 5. Post-publish checklist

- Fresh-install from Open VSX in Antigravity in a clean profile — confirms the published artifact, not just your local build. Either search "Notifier" in the Extensions view (if Antigravity's gallery points at Open VSX by default) or run `antigravity --install-extension kamalpulaparthi.notifier`.
- If also published to the VS Code Marketplace: fresh-install from that listing (not a local VSIX) in a clean VS Code profile too.
- `npx claude-codex-antigravity-notifier doctor` in a clean shell — confirms the npm package installs and the `notifier` command runs standalone (only if npm-published).
- Tag the release in git (`git tag vX.Y.Z && git push --tags`) so the published version is traceable back to a commit.

## 6. Troubleshooting (things that actually came up)

- **`Invalid access token`** — almost always means the wrong token type was used. An Azure DevOps PAT (format looks like a long alphanumeric string ending in something like `...AAAAAAAAAAAAASAZDO3xXw`) will *not* authenticate to Open VSX, and an Open VSX token (`ovsxat_...`) won't authenticate to `vsce publish`. Double-check which registry the command targets and regenerate the matching token if unsure.
- **`Namespace already exists`** on `ovsx create-namespace` — not a real error, it just means that one-time step already succeeded previously. Continue to the `ovsx publish` step.
- **`Extension ... is already published, but currently isn't active and therefore not visible`** — Open VSX processes a freshly published extension asynchronously; it briefly shows as "Deactivated" (usually 5–10 seconds, occasionally longer) before flipping to active on its own. Wait a minute or two and check `https://open-vsx.org/api/<namespace>/<name>` (the JSON API reflects state faster/more reliably than the web UI) instead of immediately retrying the publish — retrying with the *same* version number will always fail once a version exists, active or not. If it stays inactive for several minutes, that matches a known Open VSX platform bug (see their GitHub issues) rather than something fixable client-side; bump the version and publish again rather than fighting the stuck one.
- **Extension page shows blank/missing README right after publishing** — check the raw file directly (`https://open-vsx.org/api/<namespace>/<name>/<version>/file/readme.md`) before assuming the publish is broken; the web UI can lag behind the API by several minutes due to frontend caching even though the underlying data published correctly. Hard-refresh or try an incognito window before re-publishing anything.
- **Never paste a token into an agent chat**, even when asking for help debugging a failed publish — if it happens, revoke/regenerate that token immediately regardless of whether the publish succeeded.
- **`TF400813: The user '<all-zeros-ish GUID>' is not authorized to access this resource`** on `vsce publish` — this specific placeholder-looking GUID (e.g. `aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`) is Azure DevOps' signature for "the PAT itself never authenticated," not a real permissions error on a real user. Check, in order: (1) the publisher id actually exists at https://marketplace.visualstudio.com/manage — creating it is a required one-time step (§0.2), publish fails exactly like this if skipped; (2) the PAT's scope is **Marketplace → Manage** with organization set to **All accessible organizations**, generated at https://dev.azure.com; (3) you're running `@vscode/vsce`, not the deprecated bare `vsce` (see §2).
- **Extension installs / hook config revert on their own between sessions** — if VS Code (or Antigravity) has Settings Sync enabled with extensions included, it periodically pulls your extension list from the cloud and can silently overwrite a CLI-installed `.vsix` back to whatever was last synced (symptom: `~/.vscode/extensions/extensions.json` shows an older version than what you just installed, or a previously-uninstalled extension reappears). Fully quit and reopen the editor (not just "Reload Window") after installing, and if it keeps happening, disable extension sync via Command Palette → **Settings Sync: Configure...** while iterating locally.
- **Flat, wrapper-less keys (`"PreToolUse": [...]`, `"Stop": [...]`) reappear at the document root of `~/.codex/hooks.json`** — as of 2026-08-27 this is the *stale* shape, not the correct one: `codex.js`'s `install()` now always writes the `{ "hooks": { ... } }` wrapper (see [AGENT_INTEGRATIONS.md](AGENT_INTEGRATIONS.md#codex-cli); confirmed against `learn.chatgpt.com/docs/hooks` that Codex requires the same top-level wrapper Claude Code uses — the old flat shape was never recognized as a registration at all, so it silently never fired). If flat keys come back after being cleaned up, it's almost always Settings Sync restoring an old pre-2026-08-27 install (see above) rather than our extension writing it — check what's actually installed in `~/.vscode/extensions/extensions.json` / `~/.antigravity-ide/extensions/` before assuming `codex.js` regressed. `notifier doctor` flags a still-unmigrated file with a WARNING line.
