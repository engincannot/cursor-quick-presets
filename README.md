# Cursor Quick Presets

Easy-access model presets for Cursor — switch models and reasoning levels from the Explorer sidebar.

> **Requires [Cursor IDE](https://cursor.com).** This extension uses Cursor-only APIs and will not switch models in stock VS Code.

![Cursor Quick Presets demo](media/demo.gif)

## Features

- Compact Explorer list with clickable presets
- Add as many presets as you want
- Pick any model from your Cursor catalog
- Pick reasoning / effort / fast variants per preset
- Remove or reconfigure anytime
- Vendor logos (OpenAI, Claude, Grok, Composer, Gemini)

## Quick start

1. Install in **Cursor**
2. Open Explorer (`Cmd+Shift+E` / `Ctrl+Shift+E`)
3. Find **Cursor Quick Presets** under the file tree
4. Click a preset to switch models
5. Hover → **⚙** to change, **✕** to remove
6. Use **Add model** at the bottom of the list for more presets

## Commands

| Command | Description |
| --- | --- |
| `Cursor Quick Presets: Focus` | Focus the Explorer presets |
| `Cursor Quick Presets: Open as Editor` | Open as a resizable editor tab |
| `Cursor Quick Presets: Configure Preset` | Configure or add a preset from the command palette |
| `Cursor Quick Presets: Refresh Model Catalog` | Reload models from Cursor |

## Settings

`cursorQuickPresets.buttons` — variable-length array of presets:

```json
{
  "label": "Sol High",
  "modelId": "gpt-5.6-sol",
  "params": [
    { "id": "context", "value": "272k" },
    { "id": "reasoning", "value": "high" },
    { "id": "fast", "value": "false" }
  ]
}
```

`cursorQuickPresets.showToasts` — show status-bar feedback after switches (default `true`).

## Requirements

- Cursor IDE (recent desktop build)
- The pad reads your local Cursor model catalog and calls Cursor’s model-switch command

## Privacy

Cursor Quick Presets reads Cursor’s local `state.vscdb` only to list available models/variants on your machine. Nothing is sent to a third-party server by this extension.

## License

MIT
