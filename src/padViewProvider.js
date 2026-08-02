const vscode = require('vscode');
const { loadCatalog, shortParamLabel } = require('./catalog');
const { LOGO_COLOR, resolveLogoKey } = require('./logos');
const { switchToModel } = require('./switchModel');

const CONFIG_SECTION = 'cursorQuickPresets';
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
    /** @type {vscode.WebviewPanel | undefined} */
    this.editorPanel = undefined;
  }

  resolveWebviewView(webviewView) {
    this.attachWebview(webviewView.webview);
    webviewView.onDidDispose(() => {
      this.webviews.delete(webviewView.webview);
    });
  }

  openEditorView() {
    if (this.editorPanel) {
      this.editorPanel.reveal(vscode.ViewColumn.Beside, false);
      return this.editorPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'cursorQuickPresets.editor',
      'Cursor Quick Presets',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.context.extensionUri],
      },
    );

    this.editorPanel = panel;
    this.attachWebview(panel.webview);

    panel.onDidDispose(() => {
      this.webviews.delete(panel.webview);
      this.editorPanel = undefined;
    });

    return panel;
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
    return this.getButtons().map((b, index) => ({
      index,
      empty: false,
      label: b.label,
      detail: shortParamLabel(b.params),
      modelId: b.modelId,
      logo: this.logoUriFor(webview, b.modelId),
    }));
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
    buttons.splice(index, 1);
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
      prompt: 'Short name shown on the pad',
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

    const action = await vscode.window.showQuickPick(
      [
        {
          label: 'Change model',
          description: current.label,
          action: 'change',
        },
        {
          label: 'Remove from pad',
          description: 'Delete this button',
          action: 'remove',
        },
      ],
      {
        title: current.label,
        placeHolder: 'Choose an action',
      },
    );
    if (!action) return;
    if (action.action === 'remove') {
      await this.clearButton(index);
      return;
    }

    const config = await this.pickModelConfig(`Edit ${current.label}`);
    if (!config) return;
    buttons[index] = config;
    await this.setButtons(buttons);
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
      gap: 8px;
      width: 100%;
      height: 28px;
      padding: 0 6px 0 8px;
      border: none;
      border-radius: 4px;
      background: transparent;
      color: inherit;
      cursor: pointer;
      text-align: left;
    }
    .slot:hover { background: var(--hover); }
    .slot:active { background: var(--active); }
    .slot.flash { outline: 1px solid var(--accent); outline-offset: -1px; }
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

    document.getElementById('refresh').addEventListener('click', () => {
      vscode.postMessage({ type: 'refresh' });
    });

    function render(state) {
      const buttons = state.buttons || [];
      meta.textContent = state.catalogError
        ? 'Catalog unavailable'
        : buttons.length + (buttons.length === 1 ? ' preset' : ' presets');

      list.innerHTML = '';
      for (const btn of buttons) {
        const el = document.createElement('button');
        el.className = 'slot';
        el.type = 'button';
        el.title = btn.label + (btn.detail ? ' · ' + btn.detail : '');
        el.innerHTML =
          '<div class="logo-wrap"></div>' +
          '<div class="label"></div>' +
          '<div class="badge"></div>' +
          '<div class="actions">' +
            '<span class="icon-btn remove" title="Remove" data-action="remove">✕</span>' +
            '<span class="icon-btn" title="Configure" data-action="configure">⚙</span>' +
          '</div>';
        el.querySelector('.label').textContent = btn.label;
        el.querySelector('.badge').textContent = btn.detail || '';
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
        el.addEventListener('click', (e) => {
          const actionEl = e.target.closest('[data-action]');
          if (actionEl) {
            const action = actionEl.getAttribute('data-action');
            if (action === 'remove') {
              vscode.postMessage({ type: 'clear', index: btn.index });
              return;
            }
            if (action === 'configure') {
              vscode.postMessage({ type: 'configure', index: btn.index });
              return;
            }
          }
          vscode.postMessage({ type: 'press', index: btn.index });
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
        const slot = list.children[msg.index];
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
