let isServer = typeof window === 'undefined';
let Datastore;
let pathModule = null;
let fsMkdir = null;
let fsReaddir = null;
let dbDir = null;
let directoryEnsured = false;
let peacock = {};

if (isServer) {
  let pathImport = await import('node:path');
  pathModule = pathImport.default || pathImport;
  let fsImport = await import('fs/promises');
  fsMkdir = fsImport.mkdir;
  fsReaddir = fsImport.readdir;
  let nedbImport = await import('@seald-io/nedb');
  Datastore = nedbImport.default;
  dbDir = pathModule.join(process.cwd(), 'data', 'db');
} else {
  let nedbImport = await import('https://esm.sh/@seald-io/nedb');
  Datastore = nedbImport.default;
}

let datastores = new Map();
let pendingLoads = new Map();
let knownCollections = new Set();
let browserCollectionsKey = 'peacock.collections';

if (!isServer) {
  let storedCollections = readBrowserCollections();
  for (let index = 0; index < storedCollections.length; index += 1) {
    knownCollections.add(storedCollections[index]);
  }
}

peacock.get = async function(collection, ...args) {
  let name = ensureCollectionName(collection);
  if (name === '_collections') {
    return await peacock.list();
  }
  let parsed = parseIdAndQueryArgs(args);
  let datastore = await getDatastore(name, { createIfMissing: false });
  if (!datastore) {
    if (parsed.id !== undefined) {
      throw httpError(404, 'Not Found');
    }
    return [];
  }
  if (parsed.id !== undefined) {
    ensureQueryMatchesId(parsed.query, parsed.id);
    parsed.query._id = parsed.id;
    let doc = await findDocument(datastore, parsed.query);
    if (!doc) {
      throw httpError(404, 'Not Found');
    }
    return doc;
  }
  return await findDocuments(datastore, parsed.query);
};

peacock.post = async function(collection, body) {
  let name = ensureCollectionName(collection);
  if (body === undefined || body === null) {
    throw httpError(400, 'Request body is required');
  }
  if (typeof body !== 'object') {
    throw httpError(400, 'Request body must be an object or array');
  }
  let datastore = await getDatastore(name, { createIfMissing: true });
  let inserted = await insertDocuments(datastore, body);
  return inserted;
};

peacock.put = async function(collection, ...args) {
  let name = ensureCollectionName(collection);
  if (args.length === 0) {
    throw httpError(400, 'ID is required');
  }
  let idCandidate = args[0];
  if (!isIdValue(idCandidate)) {
    throw httpError(400, 'ID is required');
  }
  if (args.length < 2) {
    throw httpError(400, 'Request body is required');
  }
  let id = String(idCandidate);
  let payload = args[1];
  let querySource = args.length > 2 ? args[2] : undefined;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw httpError(400, 'Request body must be an object');
  }
  if (payload._id && String(payload._id) !== id) {
    throw httpError(400, '_id in body must match route parameter');
  }
  let datastore = await getDatastore(name, { createIfMissing: true });
  let query = buildQuery(querySource);
  ensureQueryMatchesId(query, id);
  query._id = id;
  let usesOperators = hasOperatorKeys(payload);
  let update = usesOperators ? payload : Object.assign({}, payload, { _id: id });
  let result = await updateDocument(datastore, query, update, { upsert: false });
  if (!result.numAffected) {
    throw httpError(404, 'Not Found');
  }
  return result.affectedDocument;
};

peacock.delete = async function(collection, ...args) {
  let name = ensureCollectionName(collection);
  let parsed = parseIdAndQueryArgs(args);
  let datastore = await getDatastore(name, { createIfMissing: false });
  if (!datastore) {
    if (parsed.id !== undefined) {
      throw httpError(404, 'Not Found');
    }
    return { deleted: 0 };
  }
  if (parsed.id !== undefined) {
    ensureQueryMatchesId(parsed.query, parsed.id);
    parsed.query._id = parsed.id;
    let removedSingle = await removeDocuments(datastore, parsed.query, { multi: false });
    if (!removedSingle) {
      throw httpError(404, 'Not Found');
    }
    return { deleted: removedSingle };
  }
  let removed = await removeDocuments(datastore, parsed.query, { multi: true });
  return { deleted: removed };
};

peacock.list = async function() {
  let names = new Set();
  for (let value of knownCollections) {
    names.add(value);
  }
  if (isServer) {
    try {
      await ensureDbDir();
      let files = await fsReaddir(dbDir);
      for (let index = 0; index < files.length; index += 1) {
        let file = files[index];
        if (file.endsWith('.json')) {
          names.add(file.replace(/\.json$/i, ''));
        }
      }
    } catch (error) {
      if (!error || error.code !== 'ENOENT') {
        throw error;
      }
    }
  }
  return Array.from(names);
};

function ensureCollectionName(collection) {
  if (collection === undefined || collection === null) {
    throw httpError(400, 'Collection name is required');
  }
  return String(collection);
}

function parseIdAndQueryArgs(args) {
  let id;
  let querySource;
  if (args.length > 0 && isIdValue(args[0])) {
    id = String(args[0]);
    if (args.length > 1) {
      querySource = args[1];
    }
  } else if (args.length > 0) {
    querySource = args[0];
  }
  let query = buildQuery(querySource);
  return { id, query };
}

function isIdValue(value) {
  return typeof value === 'string' || typeof value === 'number';
}

function buildQuery(params) {
  let query = {};
  if (!params || typeof params !== 'object') {
    return query;
  }
  let entries = Object.entries(params);
  for (let index = 0; index < entries.length; index += 1) {
    let entry = entries[index];
    query[entry[0]] = entry[1];
  }
  return query;
}

function ensureQueryMatchesId(query, id) {
  if (!query) {
    return;
  }
  if (query._id !== undefined && String(query._id) !== id) {
    throw httpError(400, 'Query _id must match route parameter');
  }
}

function hasOperatorKeys(payload) {
  let keys = Object.keys(payload);
  for (let index = 0; index < keys.length; index += 1) {
    let key = keys[index];
    if (key.startsWith('$')) {
      return true;
    }
  }
  return false;
}

async function getDatastore(collection, options = {}) {
  let createIfMissing = options.createIfMissing === undefined ? true : options.createIfMissing;
  if (datastores.has(collection)) {
    return datastores.get(collection);
  }
  if (pendingLoads.has(collection)) {
    return await pendingLoads.get(collection);
  }
  let loader = loadDatastoreForCollection(collection, createIfMissing);
  pendingLoads.set(collection, loader);
  try {
    let datastore = await loader;
    return datastore;
  } finally {
    pendingLoads.delete(collection);
  }
}

async function loadDatastoreForCollection(collection, createIfMissing) {
  let filename = isServer ? pathModule.join(dbDir, `${collection}.json`) : `${collection}.json`;
  let datastore = new Datastore({ filename, autoload: false });
  let exists = await datastore.persistence.storage.existsAsync(datastore.filename);
  if (!exists) {
    if (!createIfMissing) {
      return null;
    }
    if (isServer) {
      await ensureDbDir();
    }
  }
  if (isServer) {
    await ensureDbDir();
  }
  await loadDatabase(datastore);
  datastores.set(collection, datastore);
  recordKnownCollection(collection);
  return datastore;
}

function recordKnownCollection(collection) {
  if (!knownCollections.has(collection)) {
    knownCollections.add(collection);
    if (!isServer) {
      persistBrowserCollections();
    }
  } else if (!isServer) {
    persistBrowserCollections();
  }
}

function readBrowserCollections() {
  if (typeof window === 'undefined') {
    return [];
  }
  let storage;
  try {
    storage = window.localStorage;
  } catch (error) {
    return [];
  }
  if (!storage) {
    return [];
  }
  try {
    let raw = storage.getItem(browserCollectionsKey);
    if (!raw) {
      return [];
    }
    let parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    return [];
  } catch (error) {
    return [];
  }
}

function persistBrowserCollections() {
  if (typeof window === 'undefined') {
    return;
  }
  let storage;
  try {
    storage = window.localStorage;
  } catch (error) {
    return;
  }
  if (!storage) {
    return;
  }
  try {
    let list = Array.from(knownCollections);
    storage.setItem(browserCollectionsKey, JSON.stringify(list));
  } catch (error) {
    console.warn('Failed to persist collection list', error);
  }
}

async function ensureDbDir() {
  if (!isServer) {
    return;
  }
  if (directoryEnsured) {
    return;
  }
  await fsMkdir(dbDir, { recursive: true });
  directoryEnsured = true;
}

async function loadDatabase(datastore) {
  await new Promise((resolve, reject) => {
    datastore.loadDatabase(error => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function findDocuments(datastore, query) {
  return new Promise((resolve, reject) => {
    datastore.find(query, (error, docs) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(docs);
    });
  });
}

function findDocument(datastore, query) {
  return new Promise((resolve, reject) => {
    datastore.findOne(query, (error, doc) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(doc);
    });
  });
}

function insertDocuments(datastore, payload) {
  return new Promise((resolve, reject) => {
    datastore.insert(payload, (error, doc) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(doc);
    });
  });
}

function updateDocument(datastore, selector, update, options = {}) {
  let updateOptions = { returnUpdatedDocs: true, multi: false };
  updateOptions = Object.assign(updateOptions, options || {});
  return new Promise((resolve, reject) => {
    datastore.update(selector, update, updateOptions, (error, numAffected, affectedDocument, upsert) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ numAffected, affectedDocument, upsert });
    });
  });
}

function removeDocuments(datastore, selector, options = {}) {
  let removeOptions = { multi: false };
  removeOptions = Object.assign(removeOptions, options || {});
  return new Promise((resolve, reject) => {
    datastore.remove(selector, removeOptions, (error, numRemoved) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(numRemoved);
    });
  });
}

function httpError(status, message) {
  let error = new Error(message);
  error.status = status;
  return error;
}

export default peacock;
