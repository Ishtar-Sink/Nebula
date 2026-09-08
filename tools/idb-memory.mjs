/**
 * A minimal in-memory IndexedDB, enough to exercise apps/web/src/offline/store.ts in Node.
 *
 * It implements only what the store actually calls — open/upgrade, transactions over one or
 * more stores, get/getAll/put/delete/clear and a cursor for the v1→v2 migration. It is a test
 * double, not a spec implementation.
 */

class Req {
  constructor() { this.result = undefined; this.error = null; this.onsuccess = null; this.onerror = null; }
  succeed(value) {
    this.result = value;
    queueMicrotask(() => this.onsuccess?.({ target: this }));
  }
}

class ObjectStore {
  constructor(name, data, tx) { this.name = name; this.data = data; this.tx = tx; }

  #run(fn) {
    const req = new Req();
    this.tx.pending++;
    queueMicrotask(() => {
      req.succeed(fn());
      this.tx.settle();
    });
    return req;
  }

  get(key) { return this.#run(() => structuredClone(this.data.get(key))); }
  getAll() { return this.#run(() => [...this.data.values()].map((v) => structuredClone(v))); }
  put(value) { return this.#run(() => { this.data.set(value.id, structuredClone(value)); return value.id; }); }
  delete(key) { return this.#run(() => { this.data.delete(key); return undefined; }); }
  clear() { return this.#run(() => { this.data.clear(); return undefined; }); }

  openCursor() {
    const req = new Req();
    const keys = [...this.data.keys()];
    let i = 0;
    const step = () => {
      if (i >= keys.length) { req.succeed(null); return; }
      const key = keys[i++];
      const cursor = {
        value: structuredClone(this.data.get(key)),
        update: (next) => { this.data.set(key, structuredClone(next)); },
        continue: () => queueMicrotask(step),
      };
      req.succeed(cursor);
    };
    queueMicrotask(step);
    return req;
  }
}

class Transaction {
  constructor(db, names) {
    this.db = db;
    this.names = names;
    this.pending = 0;
    this.oncomplete = null;
    this.onerror = null;
    this.error = null;
    this.done = false;
    // A transaction with no work still has to complete, so check once the caller returns.
    queueMicrotask(() => this.settle());
  }
  objectStore(name) {
    if (!this.names.includes(name)) throw new Error(`store fora da transação: ${name}`);
    return new ObjectStore(name, this.db.stores.get(name), this);
  }
  settle() {
    if (this.pending > 0) { this.pending--; }
    if (this.pending === 0 && !this.done) {
      this.done = true;
      queueMicrotask(() => this.oncomplete?.());
    }
  }
}

class DB {
  constructor(name) { this.name = name; this.stores = new Map(); this.version = 0; }
  get objectStoreNames() {
    const names = [...this.stores.keys()];
    return { contains: (n) => names.includes(n) };
  }
  createObjectStore(name) { this.stores.set(name, new Map()); return new ObjectStore(name, this.stores.get(name), { pending: 0, settle() {} }); }
  transaction(names, _mode) { return new Transaction(this, Array.isArray(names) ? names : [names]); }
}

const databases = new Map();

export function installMemoryIndexedDB() {
  globalThis.indexedDB = {
    open(name, version) {
      const req = new Req();
      const db = databases.get(name) ?? new DB(name);
      databases.set(name, db);
      const oldVersion = db.version;

      queueMicrotask(() => {
        if (version > oldVersion) {
          db.version = version;
          req.result = db;
          // The upgrade transaction can touch every store, existing or just created.
          const tx = new Transaction(db, []);
          req.transaction = {
            objectStore: (n) => {
              if (!db.stores.has(n)) db.stores.set(n, new Map());
              return new ObjectStore(n, db.stores.get(n), tx);
            },
          };
          req.onupgradeneeded?.({ oldVersion, target: req });
        }
        // Give the migration's cursor walk a few turns before handing the db over.
        setTimeout(() => req.succeed(db), 5);
      });

      return req;
    },
  };
}

/** Drops everything, so each test run starts from a clean browser. */
export function resetMemoryIndexedDB() {
  databases.clear();
}

/** Seeds a v1-shaped database, to exercise the migration path. */
export function seedLegacyDatabase(name, rows) {
  const db = new DB(name);
  db.version = 1;
  db.stores.set('tracks', new Map(rows.map((r) => [r.id, r])));
  databases.set(name, db);
}
