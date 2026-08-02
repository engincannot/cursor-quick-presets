const vscode = require('vscode');

const SWITCH_COMMAND = 'cursorai.action.switchToModelSlug';

async function isCursorAvailable() {
  const commands = await vscode.commands.getCommands(true);
  return commands.includes(SWITCH_COMMAND);
}

/**
 * Switch the active Cursor composer model via the internal command.
 */
async function switchToModel({ modelId, params = [], label, showToast = true }) {
  if (!modelId) {
    throw new Error('Missing modelId');
  }

  if (!(await isCursorAvailable())) {
    throw new Error(
      'Cursor Quick Presets requires Cursor IDE. The model-switch command is not available in this editor.',
    );
  }

  const normalizedParams = (params || []).map((p) => ({
    id: String(p.id),
    value: String(p.value),
  }));

  await vscode.commands.executeCommand(SWITCH_COMMAND, {
    modelIdWithParams: JSON.stringify({
      modelId,
      params: normalizedParams,
    }),
  });

  if (showToast) {
    const title = label || modelId;
    vscode.window.setStatusBarMessage(`Cursor Quick Presets → ${title}`, 2500);
  }
}

module.exports = { switchToModel, isCursorAvailable };
