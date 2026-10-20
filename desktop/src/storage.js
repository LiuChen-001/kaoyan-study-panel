import { invoke, isTauri } from '@tauri-apps/api/core';
const KEY = 'kaoyan-panel-v1';
export async function loadState() {
  const raw = isTauri() ? await invoke('load_state') : localStorage.getItem(KEY);
  return raw ? JSON.parse(raw) : null;
}
export async function loadMigrationHistory() {
  const records = isTauri() ? await invoke('load_migration_history') : Object.keys(localStorage)
    .filter(key => key.startsWith('kaoyan-panel-before-')).map(key => localStorage.getItem(key));
  return records.flatMap(raw => { try { return [JSON.parse(raw)]; } catch { return []; } });
}
export async function saveState(state) {
  const content = JSON.stringify(state);
  if (isTauri()) await invoke('save_state', { content });
  else {
    const old = localStorage.getItem(KEY);
    let oldVersion;
    try { oldVersion = JSON.parse(old)?.version; } catch { /* Explicit backup recovery may replace an unreadable record. */ }
    const backupKey = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].includes(oldVersion) ? `kaoyan-panel-before-rich-text-v${oldVersion}` : null;
    if (backupKey && state.version === 12 && !localStorage.getItem(backupKey)) localStorage.setItem(backupKey, old);
    localStorage.setItem(KEY, content);
  }
}
