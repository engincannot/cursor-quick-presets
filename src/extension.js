const vscode = require('vscode');
const { isCursorAvailable } = require('./switchModel');
const { QuickPresetsViewProvider } = require('./padViewProvider');

/** @type {QuickPresetsViewProvider | undefined} */
let provider;

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

  // Default: open as an editor tab (doesn't steal Chat's right sidebar,
  // and doesn't move the Terminal panel group).
  context.subscriptions.push(
    vscode.commands.registerCommand('cursorQuickPresets.openEditor', async () => {
      if (!provider) return;
      provider.openEditorView();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('cursorQuickPresets.focus', async () => {
      // Focus the Explorer section; that's the primary home for the presets.
      try {
        await vscode.commands.executeCommand('workbench.view.explorer');
        await vscode.commands.executeCommand('cursorQuickPresets.view.focus');
      } catch {
        if (!provider) return;
        provider.openEditorView();
      }
    }),
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
