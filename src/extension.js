const vscode = require('vscode');
const { isCursorAvailable } = require('./switchModel');
const { QuickPresetsViewProvider } = require('./presetsViewProvider');
const { MAX_HOTKEY_SLOTS, applyCommandId } = require('./keybindings');

/** @type {QuickPresetsViewProvider | undefined} */
let provider;

async function showInExplorer() {
  // Re-open Explorer + the presets view if the user closed either.
  try {
    await vscode.commands.executeCommand('workbench.view.explorer');
  } catch {
    // ignore — view focus below may still work
  }
  try {
    await vscode.commands.executeCommand('cursorQuickPresets.view.focus');
  } catch (error) {
    vscode.window.showWarningMessage(
      `Cursor Quick Presets: could not open Explorer view (${
        error instanceof Error ? error.message : String(error)
      }).`,
    );
  }
}

function activate(context) {
  provider = new QuickPresetsViewProvider(context);

  // Soft warning once if installed outside Cursor.
  isCursorAvailable().then((ok) => {
    if (!ok) {
      vscode.window.showWarningMessage(
        'Cursor Quick Presets is designed for Cursor IDE and cannot switch models here.',
      );
    }
  });

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('cursorQuickPresets.view', provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('cursorQuickPresets.focus', showInExplorer),
  );

  // Back-compat: old "Open as Editor" command id now opens Explorer instead.
  context.subscriptions.push(
    vscode.commands.registerCommand('cursorQuickPresets.openEditor', showInExplorer),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'cursorQuickPresets.configureButton',
      async () => {
        if (!provider) return;
        const buttons = provider.getButtons();
        const picks = [
          ...buttons.map((b, index) => ({
            label: b.label,
            description: `Preset ${index + 1}`,
            index,
            add: false,
          })),
          {
            label: 'Add model…',
            description: 'Create a new preset',
            index: -1,
            add: true,
          },
        ];
        const chosen = await vscode.window.showQuickPick(picks, {
          title: 'Configure which preset?',
        });
        if (!chosen) return;
        if (chosen.add) {
          await provider.addButton();
          return;
        }
        await provider.configureButton(chosen.index);
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('cursorQuickPresets.refreshCatalog', () => {
      if (!provider) return;
      provider.refreshCatalog(true);
      provider.postState();
    }),
  );

  // Stream Deck / keybindings.json: apply by 0-based index or { index } / { slot }.
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'cursorQuickPresets.applyPreset',
      async (arg) => {
        if (!provider) return;
        let index = -1;
        if (typeof arg === 'number' && Number.isInteger(arg)) {
          index = arg;
        } else if (arg && typeof arg === 'object') {
          if (typeof arg.index === 'number') index = arg.index;
          else if (typeof arg.slot === 'number') index = arg.slot - 1;
        }
        if (!Number.isInteger(index) || index < 0) {
          vscode.window.showWarningMessage(
            'Cursor Quick Presets: applyPreset needs a 0-based index (or { index } / { slot }).',
          );
          return;
        }
        await provider.press(index);
      },
    ),
  );

  for (let slot = 1; slot <= MAX_HOTKEY_SLOTS; slot += 1) {
    const index = slot - 1;
    context.subscriptions.push(
      vscode.commands.registerCommand(applyCommandId(slot), async () => {
        if (!provider) return;
        await provider.press(index);
      }),
    );
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('cursorQuickPresets') && provider) {
        provider.postState();
      }
    }),
  );
}

function deactivate() {
  provider = undefined;
}

module.exports = { activate, deactivate };
