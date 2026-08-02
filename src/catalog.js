const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

/**
 * Resolve Cursor's state.vscdb path across platforms.
 */
function getStateDbPath() {
  const home = os.homedir();
  const candidates = [];

  if (process.platform === 'darwin') {
    candidates.push(
      path.join(
        home,
        'Library/Application Support/Cursor/User/globalStorage/state.vscdb',
      ),
    );
  } else if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData/Roaming');
    candidates.push(
      path.join(appData, 'Cursor/User/globalStorage/state.vscdb'),
    );
  } else {
    candidates.push(
      path.join(home, '.config/Cursor/User/globalStorage/state.vscdb'),
    );
  }

  return candidates.find((p) => fs.existsSync(p)) || null;
}

function readApplicationUserJson(dbPath) {
  // Prefer Node's built-in sqlite when available (Node 22.5+).
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const row = db
        .prepare(
          `SELECT value FROM ItemTable
           WHERE key LIKE '%applicationUser%'
           LIMIT 1`,
        )
        .get();
      if (row?.value) {
        return JSON.parse(row.value);
      }
    } finally {
      db.close();
    }
  } catch {
    // fall through
  }

  // Fallback: system sqlite3 CLI
  try {
    const raw = execFileSync(
      'sqlite3',
      [
        dbPath,
        `SELECT value FROM ItemTable WHERE key LIKE '%applicationUser%' LIMIT 1;`,
      ],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    return JSON.parse(raw);
  } catch {
    // fall through
  }

  // Fallback: python3 + sqlite3 stdlib
  try {
    const script = `
import json, sqlite3, sys
con = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
cur = con.cursor()
cur.execute("SELECT value FROM ItemTable WHERE key LIKE '%applicationUser%' LIMIT 1")
row = cur.fetchone()
con.close()
if not row:
    raise SystemExit(1)
print(row[0])
`;
    const raw = execFileSync('python3', ['-c', script, dbPath], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function stripHtml(text) {
  return String(text || '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function summarizeParams(params) {
  if (!Array.isArray(params) || params.length === 0) {
    return '';
  }
  const interesting = params.filter((p) => {
    if (!p?.id) return false;
    if (p.id === 'context') return false;
    if (p.id === 'fast' && p.value === 'false') return false;
    if (p.id === 'thinking' && p.value === 'false') return false;
    return true;
  });
  return interesting.map((p) => `${p.id}=${p.value}`).join(', ');
}

/** Short human labels for narrow sidebar rows. */
function shortParamLabel(params) {
  if (!Array.isArray(params) || params.length === 0) {
    return '';
  }
  const byId = Object.fromEntries(
    params.filter((p) => p?.id).map((p) => [p.id, String(p.value)]),
  );
  const parts = [];
  const effort = byId.reasoning || byId.effort;
  if (effort) {
    const map = {
      none: 'None',
      low: 'Low',
      medium: 'Med',
      high: 'High',
      xhigh: 'XHigh',
      max: 'Max',
    };
    parts.push(map[effort] || effort);
  }
  if (byId.thinking === 'true') parts.push('Think');
  if (byId.fast === 'true') parts.push('Fast');
  return parts.join(' · ');
}

/**
 * Load Cursor's live model catalog (names, params, variants).
 */
function loadCatalog() {
  const dbPath = getStateDbPath();
  if (!dbPath) {
    return { models: [], error: 'Could not find Cursor state database' };
  }

  const data = readApplicationUserJson(dbPath);
  if (!data) {
    return {
      models: [],
      error: 'Could not read Cursor model catalog from state database',
    };
  }

  const rawModels = data.availableDefaultModels2 || [];
  const models = rawModels
    .filter((m) => m?.name && m.name !== 'default')
    .map((m) => {
      const variants = (m.variants || []).map((v) => ({
        label: stripHtml(v.displayNameOutsidePicker || v.displayName || m.name),
        legacySlug: v.legacySlug || '',
        params: Array.isArray(v.parameterValues) ? v.parameterValues : [],
        summary: summarizeParams(v.parameterValues),
      }));

      const parameterDefinitions = (m.parameterDefinitions || []).map((d) => {
        const enumValues =
          d.parameterType?.enumParameter?.values?.map((x) => ({
            value: x.value,
            displayName: x.displayName || x.value,
          })) || [];
        const boolValues =
          d.parameterType?.booleanParameter?.values?.map((x) => ({
            value: x.value,
            displayName: x.displayName || x.value,
          })) || [];
        return {
          id: d.id,
          name: d.name || d.id,
          values: enumValues.length > 0 ? enumValues : boolValues,
        };
      });

      return {
        id: m.name,
        displayName: m.clientDisplayName || m.inputboxShortModelName || m.name,
        serverModelName: m.serverModelName || m.name,
        vendorName: m.vendorName || m.vendor?.displayName || '',
        parameterDefinitions,
        variants,
      };
    });

  return { models, error: null, source: dbPath };
}

module.exports = {
  loadCatalog,
  summarizeParams,
  shortParamLabel,
  stripHtml,
};
