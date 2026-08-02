# Publishing Cursor Quick Presets

## Name

- **Display name:** Cursor Quick Presets  
- **Package id:** `cursor-quick-presets`  
- **Full marketplace id:** `EnginCannot.cursor-quick-presets`

Alternatives if `cursor-quick-presets` is taken: `quick-presets`, `cursor-model-presets`.

## Before you publish

1. Publisher is already set in `package.json` (`EnginCannot`)
2. Optional but recommended: add to `package.json`:

```json
"repository": {
  "type": "git",
  "url": "https://github.com/engincannot/cursor-quick-presets"
},
"bugs": {
  "url": "https://github.com/engincannot/cursor-quick-presets/issues"
},
"homepage": "https://github.com/engincannot/cursor-quick-presets#readme"
```

3. Commit the repo and push

## Package locally

```bash
cd /Users/engin/Documents/dev/cursor-quick-presets
npm install
npx vsce package --no-dependencies
```

This creates `cursor-quick-presets-0.1.2.vsix`.

Install for a smoke test in Cursor:

```bash
cursor --install-extension ./cursor-quick-presets-0.1.2.vsix
```

(Or use **Extensions: Install from VSIX…**)

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
npx ovsx publish cursor-quick-presets-0.1.2.vsix -p YOUR_OPEN_VSX_TOKEN
```

## Version bumps

1. Update `version` in `package.json`
2. Add an entry to `CHANGELOG.md`
3. `npx vsce publish --no-dependencies`
