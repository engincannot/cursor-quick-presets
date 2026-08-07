const fs = require('fs');
const os = require('os');
const path = require('path');

/** Max number of hotkey slots (Apply Preset 1–N). */
const MAX_HOTKEY_SLOTS = 9;

/**
 * @param {number} slot 1-based slot number
 * @returns {string}
 */
function applyCommandId(slot) {
  return `cursorQuickPresets.applyPreset.${slot}`;
}

/**
 * @returns {string}
 */
function getKeybindingsPath() {
  const home = os.homedir();
  switch (process.platform) {
    case 'darwin':
      return path.join(
        home,
        'Library',
        'Application Support',
        'Cursor',
        'User',
        'keybindings.json',
      );
    case 'win32':
      return path.join(
        process.env.APPDATA || path.join(home, 'AppData', 'Roaming'),
        'Cursor',
        'User',
        'keybindings.json',
      );
    default:
      return path.join(home, '.config', 'Cursor', 'User', 'keybindings.json');
  }
}

/**
 * Strip // and /* *\/ comments from JSONC (good enough for keybindings.json).
 * @param {string} text
 * @returns {string}
 */
function stripJsonc(text) {
  let out = '';
  let i = 0;
  let inString = false;
  let escape = false;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      i += 1;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '/') {
      i += 2;
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * @returns {{ ok: true, bindings: Array<object> } | { ok: false, error: string }}
 */
function readKeybindingsSafe() {
  const filePath = getKeybindingsPath();
  if (!fs.existsSync(filePath)) {
    return { ok: true, bindings: [] };
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const trimmed = raw.trim();
    if (!trimmed) return { ok: true, bindings: [] };
    const parsed = JSON.parse(stripJsonc(trimmed));
    if (!Array.isArray(parsed)) {
      return { ok: false, error: 'keybindings.json is not a JSON array' };
    }
    return { ok: true, bindings: parsed };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * @returns {Array<{ key?: string, command?: string, args?: unknown, when?: string }>}
 */
function readKeybindings() {
  const result = readKeybindingsSafe();
  return result.ok ? result.bindings : [];
}

/**
 * @param {Array<object>} bindings
 */
function writeKeybindings(bindings) {
  const filePath = getKeybindingsPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const body = `${JSON.stringify(bindings, null, 4)}\n`;
  fs.writeFileSync(filePath, body, 'utf8');
}

/**
 * Normalize a user-entered chord to VS Code keybinding syntax.
 * @param {string} input
 * @returns {string | null}
 */
function normalizeChord(input) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim().toLowerCase().replace(/\s+/g, '');
  if (!trimmed) return null;

  const parts = trimmed.split('+').filter(Boolean);
  if (parts.length === 0) return null;

  const mods = new Set();
  let key = null;
  for (const part of parts) {
    if (part === 'cmd' || part === 'command' || part === 'meta') {
      mods.add('cmd');
    } else if (part === 'ctrl' || part === 'control') {
      mods.add('ctrl');
    } else if (part === 'alt' || part === 'option' || part === 'opt') {
      mods.add('alt');
    } else if (part === 'shift') {
      mods.add('shift');
    } else if (part === 'win' || part === 'windows' || part === 'super') {
      mods.add('win');
    } else {
      if (key) return null;
      key = part;
    }
  }
  if (!key) return null;

  // Prefer a modifier combo so Stream Deck / accidental typing is less risky.
  if (mods.size === 0) return null;

  const order = ['ctrl', 'shift', 'alt', 'cmd', 'win'];
  const modList = order.filter((m) => mods.has(m));
  return [...modList, key].join('+');
}

/**
 * Pretty-print a chord for the presets UI (macOS-style: "^ ⇧ 1").
 * @param {string} chord
 * @returns {string}
 */
function formatChordLabel(chord) {
  if (!chord) return '';
  const isMac = process.platform === 'darwin';
  return chord
    .split('+')
    .map((part) => {
      switch (part) {
        case 'cmd':
          return isMac ? '⌘' : 'Win';
        case 'ctrl':
          return isMac ? '^' : 'Ctrl';
        case 'alt':
          return isMac ? '⌥' : 'Alt';
        case 'shift':
          return isMac ? '⇧' : 'Shift';
        case 'win':
          return 'Win';
        default:
          return part.length === 1 ? part.toUpperCase() : part;
      }
    })
    .join(isMac ? ' ' : '+');
}

/**
 * Build a VS Code chord from a browser KeyboardEvent-like payload.
 * Uses `code` so Shift+1 stays "1" (not "!").
 * @param {{ code: string, key?: string, ctrlKey?: boolean, metaKey?: boolean, altKey?: boolean, shiftKey?: boolean }} event
 * @returns {string | null}
 */
function chordFromKeyEvent(event) {
  if (!event || typeof event.code !== 'string') return null;
  const mods = new Set();
  if (event.ctrlKey) mods.add('ctrl');
  if (event.metaKey) mods.add('cmd');
  if (event.altKey) mods.add('alt');
  if (event.shiftKey) mods.add('shift');

  let key = null;
  const code = event.code;
  if (/^Digit[0-9]$/.test(code)) {
    key = code.slice(5);
  } else if (/^Numpad[0-9]$/.test(code)) {
    key = `numpad${code.slice(6)}`;
  } else if (/^Key[A-Z]$/.test(code)) {
    key = code.slice(3).toLowerCase();
  } else if (/^F[0-9]{1,2}$/.test(code)) {
    key = code.toLowerCase();
  } else {
    /** @type {Record<string, string>} */
    const specials = {
      Space: 'space',
      Escape: 'escape',
      Tab: 'tab',
      Enter: 'enter',
      Backspace: 'backspace',
      Delete: 'delete',
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
      Home: 'home',
      End: 'end',
      PageUp: 'pageup',
      PageDown: 'pagedown',
      Minus: '-',
      Equal: '=',
      BracketLeft: '[',
      BracketRight: ']',
      Backslash: '\\',
      Semicolon: ';',
      Quote: "'",
      Comma: ',',
      Period: '.',
      Slash: '/',
      Backquote: '`',
    };
    key = specials[code] || null;
  }

  // Ignore modifier-only presses.
  if (
    !key ||
    code === 'ShiftLeft' ||
    code === 'ShiftRight' ||
    code === 'ControlLeft' ||
    code === 'ControlRight' ||
    code === 'AltLeft' ||
    code === 'AltRight' ||
    code === 'MetaLeft' ||
    code === 'MetaRight'
  ) {
    return null;
  }

  if (mods.size === 0) return null;

  const order = ['ctrl', 'shift', 'alt', 'cmd', 'win'];
  const modList = order.filter((m) => mods.has(m));
  return [...modList, key].join('+');
}

/**
 * Map of 0-based preset index → first user keybinding chord for that slot.
 * @returns {Map<number, string>}
 */
function getHotkeysByIndex() {
  const map = new Map();
  const bindings = readKeybindings();
  for (const entry of bindings) {
    if (!entry || typeof entry.command !== 'string' || !entry.key) continue;
    // Skip removals (`-command`) — they disable contributed bindings.
    if (entry.command.startsWith('-')) continue;
    const match = /^cursorQuickPresets\.applyPreset\.(\d+)$/.exec(entry.command);
    if (!match) continue;
    const slot = Number(match[1]);
    if (!Number.isInteger(slot) || slot < 1 || slot > MAX_HOTKEY_SLOTS) continue;
    const index = slot - 1;
    if (!map.has(index)) {
      map.set(index, String(entry.key).toLowerCase());
    }
  }
  return map;
}

/**
 * @param {string} command
 * @returns {boolean}
 */
function isOurApplyCommand(command) {
  if (typeof command !== 'string') return false;
  const cmd = command.startsWith('-') ? command.slice(1) : command;
  return /^cursorQuickPresets\.applyPreset\.\d+$/.test(cmd);
}

/**
 * Index of another preset already using this chord, or -1.
 * @param {string} chord
 * @param {number} excludeIndex
 * @returns {number}
 */
function findDuplicateHotkeyIndex(chord, excludeIndex) {
  const normalized = String(chord || '').toLowerCase();
  if (!normalized) return -1;
  const map = getHotkeysByIndex();
  for (const [index, existing] of map) {
    if (index !== excludeIndex && existing === normalized) return index;
  }
  return -1;
}

/**
 * Replace all Apply Preset 1–N bindings from a chord list (index-aligned).
 * @param {string[]} chordsByIndex empty string = no hotkey
 */
function writeHotkeysByIndex(chordsByIndex) {
  const result = readKeybindingsSafe();
  if (!result.ok) {
    throw new Error(
      `Could not read keybindings.json (${result.error}). Fix that file, then try again.`,
    );
  }
  const bindings = result.bindings.filter((entry) => {
    if (!entry || typeof entry.command !== 'string') return true;
    return !isOurApplyCommand(entry.command);
  });
  const limit = Math.min(chordsByIndex.length, MAX_HOTKEY_SLOTS);
  for (let i = 0; i < limit; i += 1) {
    const chord = chordsByIndex[i];
    if (typeof chord === 'string' && chord) {
      bindings.push({ key: chord, command: applyCommandId(i + 1) });
    }
  }
  writeKeybindings(bindings);
}

/**
 * @param {number} length current preset count (before or after op — caller chooses)
 * @returns {string[]}
 */
function hotkeyList(length) {
  const map = getHotkeysByIndex();
  const arr = [];
  for (let i = 0; i < length; i += 1) {
    arr.push(map.get(i) || '');
  }
  return arr;
}

/**
 * Set or replace the user keybinding for a 0-based preset index.
 * @param {number} index
 * @param {string} chord normalized chord
 * @param {{ allowReplace?: boolean }} [options]
 */
function setHotkey(index, chord, options = {}) {
  const slot = index + 1;
  if (slot < 1 || slot > MAX_HOTKEY_SLOTS) {
    throw new Error(`Hotkeys are only available for the first ${MAX_HOTKEY_SLOTS} presets`);
  }
  const dup = findDuplicateHotkeyIndex(chord, index);
  if (dup >= 0 && !options.allowReplace) {
    const err = new Error(`Hotkey already used by preset ${dup + 1}`);
    // @ts-ignore
    err.code = 'DUPLICATE_HOTKEY';
    // @ts-ignore
    err.conflictIndex = dup;
    throw err;
  }

  const map = getHotkeysByIndex();
  const known = [...map.keys()];
  const maxIndex = Math.max(index, ...(known.length ? known : [index]));
  const chords = hotkeyList(maxIndex + 1);
  if (dup >= 0) chords[dup] = '';
  chords[index] = chord;
  writeHotkeysByIndex(chords);
}

/**
 * Remove user keybindings for a 0-based preset index.
 * @param {number} index
 */
function clearHotkey(index) {
  const slot = index + 1;
  if (slot < 1 || slot > MAX_HOTKEY_SLOTS) return;
  const map = getHotkeysByIndex();
  const known = [...map.keys()];
  const maxIndex = Math.max(index, ...(known.length ? known : [index]));
  const chords = hotkeyList(maxIndex + 1);
  chords[index] = '';
  writeHotkeysByIndex(chords);
}

/**
 * Keep hotkeys attached to presets when list order changes.
 * @param {number} fromIndex
 * @param {number} toIndex
 * @param {number} length preset count
 */
function moveHotkeySlot(fromIndex, toIndex, length) {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= length ||
    toIndex >= length
  ) {
    return;
  }
  const chords = hotkeyList(length);
  const [item] = chords.splice(fromIndex, 1);
  chords.splice(toIndex, 0, item);
  writeHotkeysByIndex(chords);
}

/**
 * Drop a preset’s slot and shift later hotkeys up.
 * @param {number} index
 * @param {number} lengthBeforeRemove
 */
function removeHotkeySlot(index, lengthBeforeRemove) {
  if (index < 0 || index >= lengthBeforeRemove) return;
  const chords = hotkeyList(lengthBeforeRemove);
  chords.splice(index, 1);
  writeHotkeysByIndex(chords);
}

module.exports = {
  MAX_HOTKEY_SLOTS,
  applyCommandId,
  getKeybindingsPath,
  normalizeChord,
  formatChordLabel,
  chordFromKeyEvent,
  getHotkeysByIndex,
  findDuplicateHotkeyIndex,
  setHotkey,
  clearHotkey,
  moveHotkeySlot,
  removeHotkeySlot,
};
