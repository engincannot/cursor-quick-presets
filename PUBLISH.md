# Publishing Cursor Quick Presets

## Name

- **Display name:** Cursor Quick Presets  
- **Package id:** `cursor-quick-presets`  
- **Full marketplace id:** `EnginCannot.cursor-quick-presets`
- **GitHub:** https://github.com/engincannot/cursor-quick-presets

## Before you publish

1. Publisher is set in `package.json` (`EnginCannot`)
2. Repository / bugs / homepage URLs point at `engincannot/cursor-quick-presets`
3. Bump `version` in `package.json` and add a `CHANGELOG.md` entry
4. Commit and push to GitHub as **engincannot**

## Package locally

```bash
cd /Users/engin/Documents/dev/cursor-quick-presets
npm install
npx vsce package --no-dependencies
```

This creates `cursor-quick-presets-<version>.vsix` (currently `0.1.5`).

Install for a smoke test in Cursor:

```bash
cursor --install-extension ./cursor-quick-presets-0.1.5.vsix --force
```

(Or use **Extensions: Install from VSIX…**)

Reload the window after install. Avoid keeping an older side-by-side copy under `~/.cursor/extensions` — duplicate installs can fail with `cursorQuickPresets.view is already registered`.

## Publish to GitHub

```bash
git add -A
git commit -m "Release 0.1.5: updated demo GIF"
git push origin main
gh release create v0.1.5 ./cursor-quick-presets-0.1.5.vsix --title "v0.1.5" --notes-file CHANGELOG.md
```

Use the **engincannot** GitHub account (`gh auth switch -u engincannot` if needed).

## Publish to VS Code Marketplace

```bash
npx vsce login EnginCannot
npx vsce publish --no-dependencies
```

Get a Personal Access Token from Azure DevOps with **Marketplace → Manage** scope:
https://code.visualstudio.com/api/working-with-extensions/publishing-extension

## Important marketplace note

This extension **only works in Cursor**. Say that clearly in the Marketplace description (already in `package.json` / README).

If Marketplace review pushes back on VS Code incompatibility, also publish to [Open VSX](https://open-vsx.org/) (`ovsx publish`), which many Cursor users can install from.

```bash
npx --yes ovsx publish cursor-quick-presets-0.1.5.vsix -p YOUR_OPEN_VSX_TOKEN
```

## Version bumps

1. Update `version` in `package.json`
2. Add an entry to `CHANGELOG.md`
3. Push GitHub + `npx vsce publish --no-dependencies`
