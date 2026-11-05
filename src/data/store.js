// IndexedDB wrapper. Chosen over localStorage because the service worker needs to
// read the data for background reminders, and it has no access to localStorage.
// The whole document is written in one transaction, so a save can't half-apply.

import { DEFAULT_SETTINGS, emptyData } from '../core/model.js';

const DB_NAME = 'recall';
const STORE = 'kv';

function open() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run(mode, action) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = action(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function loadData() {
  const data = await run('readonly', (s) => s.get('data'));
  if (!data) return emptyData();
  return { ...data, settings: { ...DEFAULT_SETTINGS, ...data.settings } };
}

export const saveData = (data) => run('readwrite', (s) => s.put(data, 'data'));

// Which reminders have gone out. Kept apart from the data so it isn't in backups.
export const loadSent = async () => (await run('readonly', (s) => s.get('sent'))) ?? {};
export const saveSent = (sent) => run('readwrite', (s) => s.put(sent, 'sent'));
