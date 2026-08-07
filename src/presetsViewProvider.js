const path = require('path');
const vscode = require('vscode');
const { loadCatalog, shortParamLabel } = require('./catalog');
const { LOGO_COLOR, resolveLogoKey } = require('./logos');
const { switchToModel } = require('./switchModel');
const {
  MAX_HOTKEY_SLOTS,
  getKeybindingsPath,
  formatChordLabel,
  chordFromKeyEvent,
  getHotkeysByIndex,
  findDuplicateHotkeyIndex,
  setHotkey,
  clearHotkey,
  moveHotkeySlot,
  removeHotkeySlot,
} = require('./keybindings');

const CONFIG_SECTION = 'cursorQuickPresets';
// Legacy settings id from the previous extension name (migration only).
const LEGACY_CONFIG_SECTION = 'cursorModelPad';
function defaultButtons() {
  return [
    {
      label: 'Sol High',
      modelId: 'gpt-5.6-sol',
      params: [
        { id: 'context', value: '272k' },
        { id: 'reasoning', value: 'high' },
        { id: 'fast', value: 'false' },
      ],
    },
    {
      label: 'Opus High',
      modelId: 'claude-opus-5',
      params: [
        { id: 'thinking', value: 'true' },
        { id: 'context', value: '300k' },
        { id: 'effort', value: 'high' },
        { id: 'fast', value: 'false' },
      ],
    },
    {
      label: 'Grok High Fast',
      modelId: 'grok-4.5',
      params: [
        { id: 'effort', value: 'high' },
        { id: 'fast', value: 'true' },
      ],
    },
    {
      label: 'Composer',
      modelId: 'composer-2.5',
      params: [{ id: 'fast', value: 'false' }],
    },
  ];
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizeButtons(raw) {
  const source = Array.isArray(raw) ? raw : defaultButtons();
  const buttons = [];
  for (const item of source) {
    if (
      item &&
      typeof item === 'object' &&
      typeof item.modelId === 'string' &&
      typeof item.label === 'string'
    ) {
      buttons.push({
        label: item.label,
        modelId: item.modelId,
        params: Array.isArray(item.params) ? item.params : [],
      });
    }
  }
  // Empty / missing settings → ship defaults once.
  if (buttons.length === 0 && (!Array.isArray(raw) || raw.length === 0)) {
    return defaultButtons();
  }
  return buttons;
}

class QuickPresetsViewProvider {
  constructor(context) {
    this.context = context;
    /** @type {Set<vscode.Webview>} */
    this.webviews = new Set();
    this.catalog = { models: [], error: null };

    try {
      const keybindingsWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(
          vscode.Uri.file(path.dirname(getKeybindingsPath())),
          'keybindings.json',
        ),
      );
      const refreshHotkeys = () => this.postState();
      keybindingsWatcher.onDidChange(refreshHotkeys);
      keybindingsWatcher.onDidCreate(refreshHotkeys);
      keybindingsWatcher.onDidDelete(refreshHotkeys);
      context.subscriptions.push(keybindingsWatcher);
    } catch {
      // Hotkey labels refresh on configure / next state push if watch fails.
    }
  }

  resolveWebviewView(webviewView) {
    this.attachWebview(webviewView.webview);
    webviewView.onDidDispose(() => {
      this.webviews.delete(webviewView.webview);
    });
  }

  attachWebview(webview) {
    webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };
    webview.html = this.getHtml(webview);
    this.webviews.add(webview);

    webview.onDidReceiveMessage(async (message) => {
      switch (message?.type) {
        case 'ready':
          this.refreshCatalog(false);
          this.postState();
          break;
        case 'press':
          await this.press(message.index);
          break;
        case 'configure':
          await this.configureButton(message.index);
          break;
        case 'clear':
          await this.clearButton(message.index);
          break;
        case 'add':
          await this.addButton();
          break;
        case 'refresh':
          this.refreshCatalog(true);
          this.postState();
          break;
        case 'move':
          await this.moveButton(message.fromIndex, message.toIndex);
          break;
        case 'moveUp':
          await this.moveButton(message.index, message.index - 1);
          break;
        case 'moveDown':
          await this.moveButton(message.index, message.index + 1);
          break;
        default:
          break;
      }
    });
  }

  getButtons() {
    const current = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const inspected = current.inspect('buttons');
    const hasNewSetting =
      inspected &&
      (inspected.globalValue !== undefined ||
        inspected.workspaceValue !== undefined);

    if (hasNewSetting) {
      return normalizeButtons(current.get('buttons'));
    }

    const legacySettings = vscode.workspace
      .getConfiguration(LEGACY_CONFIG_SECTION)
      .inspect('buttons');
    if (
      legacySettings &&
      (legacySettings.globalValue !== undefined ||
        legacySettings.workspaceValue !== undefined)
    ) {
      return normalizeButtons(
        vscode.workspace
          .getConfiguration(LEGACY_CONFIG_SECTION)
          .get('buttons'),
      );
    }

    const legacyState = this.context.globalState.get('cursorModelPad.buttons');
    if (Array.isArray(legacyState) && legacyState.some((b) => b != null)) {
      return normalizeButtons(legacyState);
    }

    return normalizeButtons(current.get('buttons'));
  }

  async setButtons(buttons) {
    const normalized = normalizeButtons(buttons);
    await vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .update('buttons', normalized, vscode.ConfigurationTarget.Global);
    this.postState();
  }

  refreshCatalog(showMessage) {
    this.catalog = loadCatalog();
    if (showMessage) {
      if (this.catalog.error) {
        vscode.window.showWarningMessage(`Cursor Quick Presets: ${this.catalog.error}`);
      } else {
        vscode.window.showInformationMessage(
          `Cursor Quick Presets: loaded ${this.catalog.models.length} models from Cursor`,
        );
      }
    }
  }

  logoUriFor(webview, modelId) {
    const catalogModel = (this.catalog.models || []).find(
      (m) => m.id === modelId,
    );
    const key = resolveLogoKey(modelId, catalogModel?.vendorName || '');
    const uri = vscode.Uri.joinPath(
      this.context.extensionUri,
      'media',
      `${key}.svg`,
    );
    return {
      key,
      color: LOGO_COLOR[key] || LOGO_COLOR.generic,
      src: webview.asWebviewUri(uri).toString(),
    };
  }

  buildButtonsPayload(webview) {
    const hotkeys = getHotkeysByIndex();
    return this.getButtons().map((b, index) => {
      const chord = hotkeys.get(index) || '';
      return {
        index,
        empty: false,
        label: b.label,
        detail: shortParamLabel(b.params),
        modelId: b.modelId,
        hotkey: chord,
        hotkeyLabel: chord ? formatChordLabel(chord) : '',
        logo: this.logoUriFor(webview, b.modelId),
      };
    });
  }

  postState() {
    for (const webview of this.webviews) {
      webview.postMessage({
        type: 'state',
        buttons: this.buildButtonsPayload(webview),
        modelCount: this.catalog.models.length,
        catalogError: this.catalog.error,
      });
    }
  }

  async press(index) {
    const buttons = this.getButtons();
    const button = buttons[index];
    if (!button) {
      vscode.window.showWarningMessage(
        `Cursor Quick Presets: no model in slot ${index + 1}`,
      );
      return;
    }

    const showToasts = vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .get('showToasts', true);

    try {
      await switchToModel({
        modelId: button.modelId,
        params: button.params,
        label: button.label,
        showToast: showToasts,
      });
      for (const webview of this.webviews) {
        webview.postMessage({ type: 'flash', index });
      }
    } catch (error) {
      vscode.window.showErrorMessage(
        `Cursor Quick Presets failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async clearButton(index) {
    const buttons = this.getButtons();
    if (index < 0 || index >= buttons.length) return;
    const lengthBefore = buttons.length;
    buttons.splice(index, 1);
    try {
      removeHotkeySlot(index, lengthBefore);
    } catch (error) {
      vscode.window.showWarningMessage(
        `Preset removed, but hotkeys may need fixing: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    await this.setButtons(buttons);
  }

  /**
   * @param {number} fromIndex
   * @param {number} toIndex
   */
  async moveButton(fromIndex, toIndex) {
    const buttons = this.getButtons();
    if (
      !Number.isInteger(fromIndex) ||
      !Number.isInteger(toIndex) ||
      fromIndex === toIndex ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= buttons.length ||
      toIndex >= buttons.length
    ) {
      return;
    }
    const [item] = buttons.splice(fromIndex, 1);
    buttons.splice(toIndex, 0, item);
    try {
      moveHotkeySlot(fromIndex, toIndex, buttons.length);
    } catch (error) {
      vscode.window.showWarningMessage(
        `Order updated, but hotkeys may need fixing: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    await this.setButtons(buttons);
  }

  async pickModelConfig(titlePrefix) {
    if (!this.catalog.models.length) {
      this.refreshCatalog(false);
    }
    if (!this.catalog.models.length) {
      const modelId = await vscode.window.showInputBox({
        title: titlePrefix,
        prompt: 'Model id (e.g. gpt-5.6-sol)',
        placeHolder: 'gpt-5.6-sol',
      });
      if (!modelId) return null;

      const label =
        (await vscode.window.showInputBox({
          title: 'Button label',
          value: modelId,
        })) || modelId;

      return { label, modelId, params: [] };
    }

    const modelPick = await vscode.window.showQuickPick(
      this.catalog.models.map((m) => ({
        label: m.displayName,
        description: m.id,
        detail: m.vendorName || undefined,
        model: m,
      })),
      {
        title: `${titlePrefix}: choose model`,
        placeHolder: 'Search models',
        matchOnDescription: true,
        matchOnDetail: true,
      },
    );
    if (!modelPick) return null;

    const model = modelPick.model;
    let params = [];
    let label = model.displayName;

    if (model.variants.length > 0) {
      const variantPick = await vscode.window.showQuickPick(
        model.variants.map((v) => ({
          label: v.label,
          description: v.summary || v.legacySlug || undefined,
          variant: v,
        })),
        {
          title: `${model.displayName}: choose reasoning / variant`,
          placeHolder: 'Search variants',
          matchOnDescription: true,
        },
      );
      if (!variantPick) return null;
      params = variantPick.variant.params;
      label = variantPick.variant.label;
    }

    const customLabel = await vscode.window.showInputBox({
      title: 'Button label',
      value: label,
      prompt: 'Short name shown in the list',
    });
    if (customLabel === undefined) return null;

    return {
      label: customLabel.trim() || label,
      modelId: model.id,
      params,
    };
  }

  async addButton() {
    const config = await this.pickModelConfig('Add model');
    if (!config) return;
    const buttons = this.getButtons();
    buttons.push(config);
    await this.setButtons(buttons);
  }

  async configureButton(index) {
    const buttons = this.getButtons();
    const current = buttons[index];
    if (!current) {
      await this.addButton();
      return;
    }

    const hotkeys = getHotkeysByIndex();
    const currentHotkey = hotkeys.get(index) || '';
    const hotkeyItems =
      index < MAX_HOTKEY_SLOTS
        ? [
            {
              label: currentHotkey ? 'Change hotkey' : 'Set hotkey',
              description: currentHotkey
                ? formatChordLabel(currentHotkey)
                : 'For Stream Deck / keyboard',
              detail: currentHotkey
                ? `Current: ${formatChordLabel(currentHotkey)}`
                : `Press keys — e.g. ^ ⇧ ${index + 1}`,
              action: 'hotkey',
            },
            ...(currentHotkey
              ? [
                  {
                    label: 'Clear hotkey',
                    description: formatChordLabel(currentHotkey),
                    action: 'clearHotkey',
                  },
                ]
              : []),
          ]
        : [
            {
              label: 'Hotkey unavailable',
              description: `Only the first ${MAX_HOTKEY_SLOTS} presets support hotkeys`,
              action: 'noop',
            },
          ];

    const action = await vscode.window.showQuickPick(
      [
        {
          label: 'Change model',
          description: current.label,
          action: 'change',
        },
        ...hotkeyItems,
        {
          label: 'Remove preset',
          description: 'Delete this preset',
          action: 'remove',
        },
      ],
      {
        title: current.label,
        placeHolder: 'Choose an action',
      },
    );
    if (!action || action.action === 'noop') return;
    if (action.action === 'remove') {
      await this.clearButton(index);
      return;
    }
    if (action.action === 'clearHotkey') {
      try {
        clearHotkey(index);
        this.postState();
        vscode.window.showInformationMessage(
          `Cleared hotkey for “${current.label}”.`,
        );
      } catch (error) {
        vscode.window.showErrorMessage(
          `Could not clear hotkey: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      return;
    }
    if (action.action === 'hotkey') {
      await this.setButtonHotkey(index, current.label, currentHotkey);
      return;
    }

    const config = await this.pickModelConfig(`Edit ${current.label}`);
    if (!config) return;
    buttons[index] = config;
    await this.setButtons(buttons);
  }

  /**
   * @param {number} index
   * @param {string} label
   * @param {string} currentHotkey
   */
  async setButtonHotkey(index, label, currentHotkey) {
    const chord = await this.captureHotkey(label, currentHotkey, index);
    if (!chord) return;

    const conflictIndex = findDuplicateHotkeyIndex(chord, index);
    let allowReplace = false;
    if (conflictIndex >= 0) {
      const other = this.getButtons()[conflictIndex];
      const otherLabel = other?.label || `Preset ${conflictIndex + 1}`;
      const choice = await vscode.window.showWarningMessage(
        `${formatChordLabel(chord)} is already used by “${otherLabel}”.`,
        'Move to this preset',
        'Cancel',
      );
      if (choice !== 'Move to this preset') return;
      allowReplace = true;
    }

    try {
      setHotkey(index, chord, { allowReplace });
      this.postState();
      vscode.window.showInformationMessage(
        `“${label}” → ${formatChordLabel(chord)}. Map the same chord on your Stream Deck.`,
      );
    } catch (error) {
      vscode.window.showErrorMessage(
        `Could not set hotkey: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Press-to-record hotkey UI (number keys keep their digit with Shift).
   * @param {string} label
   * @param {string} currentHotkey
   * @param {number} index
   * @returns {Promise<string | null>}
   */
  captureHotkey(label, currentHotkey, index) {
    const suggested = `ctrl+shift+${Math.min(index + 1, 9)}`;
    const initialLabel = currentHotkey
      ? formatChordLabel(currentHotkey)
      : formatChordLabel(suggested);

    return new Promise((resolve) => {
      const panel = vscode.window.createWebviewPanel(
        'cursorQuickPresets.hotkey',
        `Hotkey — ${label}`,
        { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
        { enableScripts: true, retainContextWhenHidden: false },
      );

      let settled = false;
      const finish = (chord) => {
        if (settled) return;
        settled = true;
        panel.dispose();
        resolve(chord);
      };

      panel.onDidDispose(() => finish(null));

      panel.webview.onDidReceiveMessage((message) => {
        if (message?.type === 'cancel') {
          finish(null);
          return;
        }
        if (message?.type === 'clear') {
          try {
            clearHotkey(index);
            this.postState();
          } catch (error) {
            vscode.window.showErrorMessage(
              `Could not clear hotkey: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
          finish(null);
          return;
        }
        if (message?.type === 'keydown') {
          const chord = chordFromKeyEvent(message.event || {});
          if (!chord) return;
          finish(chord);
        }
      });

      const nonce = String(Date.now());
      const isMac = process.platform === 'darwin';
      panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    :root {
      color-scheme: dark light;
      --fg: var(--vscode-foreground, #ccc);
      --muted: var(--vscode-descriptionForeground, #888);
      --input-bg: var(--vscode-input-background, #3c3c3c);
      --input-fg: var(--vscode-input-foreground, #ccc);
      --input-border: var(--vscode-input-border, transparent);
      --btn-bg: var(--vscode-button-secondaryBackground, #3a3d41);
      --btn-fg: var(--vscode-button-secondaryForeground, #ccc);
      --accent: var(--vscode-focusBorder, #3794ff);
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      height: 100%;
      background: transparent;
      color: var(--fg);
      font-family: var(--vscode-font-family, system-ui, sans-serif);
      font-size: 13px;
    }
    .wrap {
      display: flex;
      flex-direction: column;
      gap: 14px;
      padding: 20px 22px;
      max-width: 420px;
    }
    .hint { color: var(--muted); font-size: 12px; line-height: 1.4; }
    .row {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .row label {
      flex: 0 0 auto;
      color: var(--muted);
      min-width: 64px;
    }
    .field {
      flex: 1 1 auto;
      min-height: 30px;
      padding: 6px 10px;
      border: 1px solid var(--input-border);
      border-radius: 4px;
      background: var(--input-bg);
      color: var(--input-fg);
      font-size: 13px;
      letter-spacing: ${isMac ? '0.04em' : 'normal'};
      outline: 1px solid var(--accent);
      outline-offset: -1px;
    }
    .field.empty { color: var(--muted); }
    .actions { display: flex; gap: 8px; }
    button {
      border: none;
      border-radius: 4px;
      padding: 5px 12px;
      cursor: pointer;
      background: var(--btn-bg);
      color: var(--btn-fg);
      font-size: 12px;
    }
    button:hover { filter: brightness(1.08); }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="hint">Press the shortcut for “${escapeHtml(label)}”. Number keys stay as 1–9 even with Shift (Stream Deck friendly).</div>
    <div class="row">
      <label for="hotkey">Hotkey:</label>
      <div class="field${currentHotkey ? '' : ' empty'}" id="hotkey" tabindex="0">${escapeHtml(initialLabel)}</div>
    </div>
    <div class="actions">
      <button type="button" id="clear"${currentHotkey ? '' : ' disabled'}>Clear</button>
      <button type="button" id="cancel">Cancel</button>
    </div>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const field = document.getElementById('hotkey');
    field.focus();

    function formatLive(e) {
      const parts = [];
      if (e.ctrlKey) parts.push(${isMac ? "'^'" : "'Ctrl'"});
      if (e.shiftKey) parts.push(${isMac ? "'⇧'" : "'Shift'"});
      if (e.altKey) parts.push(${isMac ? "'⌥'" : "'Alt'"});
      if (e.metaKey) parts.push(${isMac ? "'⌘'" : "'Win'"});
      let key = '';
      if (/^Digit[0-9]$/.test(e.code)) key = e.code.slice(5);
      else if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
      else if (/^F[0-9]{1,2}$/.test(e.code)) key = e.code;
      if (key) parts.push(key);
      return parts.join(${isMac ? "' '" : "'+'"});
    }

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        vscode.postMessage({ type: 'cancel' });
        return;
      }
      // Modifier-only: show live preview, don't commit.
      if (
        e.code === 'ShiftLeft' || e.code === 'ShiftRight' ||
        e.code === 'ControlLeft' || e.code === 'ControlRight' ||
        e.code === 'AltLeft' || e.code === 'AltRight' ||
        e.code === 'MetaLeft' || e.code === 'MetaRight'
      ) {
        field.textContent = formatLive(e) || '…';
        field.classList.remove('empty');
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      field.textContent = formatLive(e);
      field.classList.remove('empty');
      vscode.postMessage({
        type: 'keydown',
        event: {
          code: e.code,
          key: e.key,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          altKey: e.altKey,
          shiftKey: e.shiftKey,
        },
      });
    }, true);

    document.getElementById('cancel').addEventListener('click', () => {
      vscode.postMessage({ type: 'cancel' });
    });
    document.getElementById('clear').addEventListener('click', () => {
      vscode.postMessage({ type: 'clear' });
    });
  </script>
</body>
</html>`;
    });
  }

  getHtml(webview) {
    const nonce = String(Date.now());
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    :root {
      color-scheme: dark light;
      --bg: transparent;
      --fg: var(--vscode-sideBar-foreground, var(--vscode-foreground, #ccc));
      --muted: var(--vscode-descriptionForeground, #888);
      --hover: var(--vscode-list-hoverBackground, rgba(255,255,255,0.06));
      --active: var(--vscode-list-activeSelectionBackground, rgba(255,255,255,0.1));
      --accent: var(--vscode-focusBorder, #3794ff);
      --badge-bg: var(--vscode-badge-background, #4d4d4d);
      --badge-fg: var(--vscode-badge-foreground, #fff);
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      background: var(--bg);
      color: var(--fg);
      font-family: var(--vscode-font-family, system-ui, sans-serif);
      font-size: 12px;
    }
    .wrap {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 4px 0 8px;
      min-height: 0;
    }
    .toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      padding: 2px 8px 6px;
    }
    .toolbar .meta {
      color: var(--muted);
      font-size: 11px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .toolbar button {
      border: none;
      background: transparent;
      color: var(--muted);
      border-radius: 4px;
      padding: 2px 6px;
      cursor: pointer;
      font-size: 11px;
    }
    .toolbar button:hover {
      color: var(--fg);
      background: var(--hover);
    }
    .list {
      display: flex;
      flex-direction: column;
      gap: 1px;
      min-height: 0;
    }
    .slot {
      display: flex;
      align-items: center;
      gap: 6px;
      width: 100%;
      height: 28px;
      padding: 0 4px 0 4px;
      border: none;
      border-radius: 4px;
      background: transparent;
      color: inherit;
      cursor: pointer;
      text-align: left;
      user-select: none;
    }
    .slot:hover { background: var(--hover); }
    .slot:active { background: var(--active); }
    .slot.flash { outline: 1px solid var(--accent); outline-offset: -1px; }
    .slot.dragging { opacity: 0.45; }
    .slot.drag-over {
      box-shadow: inset 0 2px 0 0 var(--accent);
    }
    .slot.drag-over-below {
      box-shadow: inset 0 -2px 0 0 var(--accent);
    }
    .grip {
      flex: 0 0 auto;
      width: 12px;
      color: var(--muted);
      font-size: 11px;
      line-height: 1;
      cursor: grab;
      opacity: 0.55;
      text-align: center;
    }
    .slot:hover .grip { opacity: 0.9; }
    .grip:active { cursor: grabbing; }
    .add {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      height: 28px;
      margin-top: 2px;
      padding: 0 6px 0 8px;
      border: none;
      border-radius: 4px;
      background: transparent;
      color: var(--muted);
      cursor: pointer;
      text-align: left;
      font-size: 12px;
    }
    .add:hover { background: var(--hover); color: var(--fg); }
    .logo-wrap {
      flex: 0 0 auto;
      width: 16px;
      height: 16px;
      display: grid;
      place-items: center;
      color: var(--fg);
    }
    .logo-mark {
      width: 14px;
      height: 14px;
      background: currentColor;
      -webkit-mask-repeat: no-repeat;
      mask-repeat: no-repeat;
      -webkit-mask-position: center;
      mask-position: center;
      -webkit-mask-size: contain;
      mask-size: contain;
    }
    .plus {
      font-size: 14px;
      line-height: 1;
      color: var(--muted);
    }
    .label {
      flex: 1 1 auto;
      min-width: 0;
      font-size: 12px;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .badge {
      flex: 0 0 auto;
      max-width: 42%;
      padding: 1px 6px;
      border-radius: 8px;
      background: var(--badge-bg);
      color: var(--badge-fg);
      font-size: 10px;
      line-height: 16px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .badge:empty { display: none; }
    .hotkey {
      flex: 0 0 auto;
      color: var(--muted);
      font-size: 10px;
      font-variant-numeric: tabular-nums;
      letter-spacing: 0.02em;
      white-space: nowrap;
      opacity: 0.85;
    }
    .hotkey:empty { display: none; }
    .actions {
      display: flex;
      align-items: center;
      gap: 1px;
      flex: 0 0 auto;
      opacity: 0;
    }
    .slot:hover .actions,
    .slot:focus-within .actions { opacity: 1; }
    .icon-btn {
      width: 20px;
      height: 20px;
      border: none;
      border-radius: 4px;
      background: transparent;
      color: var(--muted);
      cursor: pointer;
      font-size: 12px;
      line-height: 20px;
      padding: 0;
    }
    .icon-btn:hover { color: var(--fg); background: var(--hover); }
    .icon-btn.remove:hover { color: #f48771; }
    .icon-btn:disabled,
    .icon-btn[aria-disabled="true"] {
      opacity: 0.25;
      pointer-events: none;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="toolbar">
      <div class="meta" id="meta">Loading…</div>
      <button id="refresh" title="Reload models from Cursor">Refresh</button>
    </div>
    <div class="list" id="list"></div>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const list = document.getElementById('list');
    const meta = document.getElementById('meta');
    let dragFrom = -1;

    document.getElementById('refresh').addEventListener('click', () => {
      vscode.postMessage({ type: 'refresh' });
    });

    function clearDragOver() {
      list.querySelectorAll('.slot').forEach((el) => {
        el.classList.remove('drag-over', 'drag-over-below');
      });
    }

    function render(state) {
      const buttons = state.buttons || [];
      meta.textContent = state.catalogError
        ? 'Catalog unavailable'
        : buttons.length + (buttons.length === 1 ? ' preset' : ' presets');

      list.innerHTML = '';
      for (const btn of buttons) {
        const el = document.createElement('div');
        el.className = 'slot';
        el.setAttribute('role', 'button');
        el.tabIndex = 0;
        el.draggable = true;
        el.dataset.index = String(btn.index);
        el.title =
          btn.label +
          (btn.detail ? ' · ' + btn.detail : '') +
          (btn.hotkeyLabel ? ' · ' + btn.hotkeyLabel : '') +
          ' · drag to reorder';
        el.innerHTML =
          '<div class="grip" title="Drag to reorder" aria-hidden="true">⋮⋮</div>' +
          '<div class="logo-wrap"></div>' +
          '<div class="label"></div>' +
          '<div class="badge"></div>' +
          '<div class="hotkey"></div>' +
          '<div class="actions">' +
            '<span class="icon-btn" title="Move up" data-action="moveUp" aria-label="Move up">↑</span>' +
            '<span class="icon-btn" title="Move down" data-action="moveDown" aria-label="Move down">↓</span>' +
            '<span class="icon-btn remove" title="Remove" data-action="remove">✕</span>' +
            '<span class="icon-btn" title="Configure" data-action="configure">⚙</span>' +
          '</div>';
        el.querySelector('.label').textContent = btn.label;
        el.querySelector('.badge').textContent = btn.detail || '';
        el.querySelector('.hotkey').textContent = btn.hotkeyLabel || '';
        if (btn.index === 0) {
          el.querySelector('[data-action="moveUp"]').setAttribute('aria-disabled', 'true');
        }
        if (btn.index === buttons.length - 1) {
          el.querySelector('[data-action="moveDown"]').setAttribute('aria-disabled', 'true');
        }
        const logoWrap = el.querySelector('.logo-wrap');
        if (btn.logo && btn.logo.src) {
          logoWrap.style.color = btn.logo.color || 'var(--fg)';
          const mark = document.createElement('div');
          mark.className = 'logo-mark';
          mark.style.webkitMaskImage = 'url(' + btn.logo.src + ')';
          mark.style.maskImage = 'url(' + btn.logo.src + ')';
          logoWrap.appendChild(mark);
        } else {
          logoWrap.innerHTML = '<span class="plus">＋</span>';
        }

        el.addEventListener('dragstart', (e) => {
          dragFrom = btn.index;
          el.classList.add('dragging');
          try {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', String(btn.index));
          } catch (_) {}
        });
        el.addEventListener('dragend', () => {
          dragFrom = -1;
          el.classList.remove('dragging');
          clearDragOver();
        });
        el.addEventListener('dragover', (e) => {
          e.preventDefault();
          if (dragFrom < 0 || dragFrom === btn.index) return;
          clearDragOver();
          const rect = el.getBoundingClientRect();
          const mid = rect.top + rect.height / 2;
          el.classList.add(e.clientY < mid ? 'drag-over' : 'drag-over-below');
        });
        el.addEventListener('drop', (e) => {
          e.preventDefault();
          clearDragOver();
          if (dragFrom < 0) return;
          const rect = el.getBoundingClientRect();
          const mid = rect.top + rect.height / 2;
          let toIndex = e.clientY < mid ? btn.index : btn.index + 1;
          if (dragFrom < toIndex) toIndex -= 1;
          toIndex = Math.max(0, Math.min(buttons.length - 1, toIndex));
          if (toIndex === dragFrom) return;
          vscode.postMessage({ type: 'move', fromIndex: dragFrom, toIndex: toIndex });
        });

        el.addEventListener('click', (e) => {
          const actionEl = e.target.closest('[data-action]');
          if (actionEl) {
            if (actionEl.getAttribute('aria-disabled') === 'true') return;
            const action = actionEl.getAttribute('data-action');
            if (action === 'remove') {
              vscode.postMessage({ type: 'clear', index: btn.index });
              return;
            }
            if (action === 'configure') {
              vscode.postMessage({ type: 'configure', index: btn.index });
              return;
            }
            if (action === 'moveUp') {
              vscode.postMessage({ type: 'moveUp', index: btn.index });
              return;
            }
            if (action === 'moveDown') {
              vscode.postMessage({ type: 'moveDown', index: btn.index });
              return;
            }
          }
          vscode.postMessage({ type: 'press', index: btn.index });
        });
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            vscode.postMessage({ type: 'press', index: btn.index });
          }
        });
        el.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          vscode.postMessage({ type: 'configure', index: btn.index });
        });
        list.appendChild(el);
      }

      const add = document.createElement('button');
      add.className = 'add';
      add.type = 'button';
      add.title = 'Add model';
      add.innerHTML =
        '<div class="logo-wrap"><span class="plus">＋</span></div>' +
        '<div class="label">Add model</div>';
      add.addEventListener('click', () => {
        vscode.postMessage({ type: 'add' });
      });
      list.appendChild(add);
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'state') render(msg);
      if (msg.type === 'flash') {
        const slot = list.querySelector('.slot[data-index="' + msg.index + '"]');
        if (!slot) return;
        slot.classList.add('flash');
        setTimeout(() => slot.classList.remove('flash'), 280);
      }
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}

module.exports = {
  QuickPresetsViewProvider,
  normalizeButtons,
  defaultButtons,
};
