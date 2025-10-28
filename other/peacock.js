import Datastore from '@seald-io/nedb';
import express from 'express';
import path from 'node:path';
import qs from 'qs';
import { access, mkdir, readdir } from 'fs/promises';

let app = express();
app.set('query parser', str => qs.parse(str));
app.use(express.json());

let dbDir = path.join(process.cwd(), 'data', 'db');
let datastores = new Map();
let pendingLoads = new Map();

app.get('/_collections', async (req, res) => {
  try {
    let files = await readdir(dbDir);
    let names = [];
    for (let file of files) {
      if (file.endsWith('.json')) {
        names.push(file.replace(/\.json$/, ''));
      }
    }
    res.json(names);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      res.json([]);
      return;
    }
    console.error(error);
    res.status(500).json({ error: `Internal Server Error` });
  }
});

app.get('/:collection', async (req, res) => {
  try {
    let collection = req.params.collection;
    let datastore = await getDatastore(collection, { createIfMissing: false });
    if (!datastore) {
      res.json([]);
      return;
    }
    let query = buildQuery(req.query);
    let docs = await findDocuments(datastore, query);
    res.json(docs);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: `Internal Server Error` });
  }
});

app.get('/:collection/:_id', async (req, res) => {
  try {
    let collection = req.params.collection;
    let id = req.params._id;
    let datastore = await getDatastore(collection, { createIfMissing: false });
    if (!datastore) {
      res.status(404).json({ error: `Not Found` });
      return;
    }
    let query = buildQuery(req.query);
    if (query._id !== undefined && query._id !== id) {
      res.status(400).json({ error: `Query _id must match route parameter` });
      return;
    }
    query._id = id;
    let doc = await findDocument(datastore, query);
    if (!doc) {
      res.status(404).json({ error: `Not Found` });
      return;
    }
    res.json(doc);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: `Internal Server Error` });
  }
});

app.post('/:collection', async (req, res) => {
  try {
    let collection = req.params.collection;
    let payload = req.body;
    if (payload === undefined || payload === null) {
      res.status(400).json({ error: `Request body is required` });
      return;
    }
    if (typeof payload !== 'object') {
      res.status(400).json({ error: `Request body must be an object or array` });
      return;
    }
    let datastore = await getDatastore(collection, { createIfMissing: true });
    let inserted = await insertDocuments(datastore, payload);
    res.status(201).json(inserted);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: `Internal Server Error` });
  }
});

app.put('/:collection/:_id', async (req, res) => {
  try {
    let collection = req.params.collection;
    let id = req.params._id;
    let payload = req.body;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      res.status(400).json({ error: `Request body must be an object` });
      return;
    }
    if (payload._id && payload._id !== id) {
      res.status(400).json({ error: `_id in body must match route parameter` });
      return;
    }
    let datastore = await getDatastore(collection, { createIfMissing: true });
    let query = buildQuery(req.query);
    if (query._id !== undefined && query._id !== id) {
      res.status(400).json({ error: `Query _id must match route parameter` });
      return;
    }
    query._id = id;
    let usesOperators = hasOperatorKeys(payload);
    let update = usesOperators ? payload : Object.assign({}, payload, { _id: id });
    let result = await updateDocument(datastore, query, update, { upsert: false });
    if (!result.numAffected) {
      res.status(404).json({ error: `Not Found` });
      return;
    }
    res.json(result.affectedDocument);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: `Internal Server Error` });
  }
});

app.delete('/:collection/:_id', async (req, res) => {
  try {
    let collection = req.params.collection;
    let id = req.params._id;
    let datastore = await getDatastore(collection, { createIfMissing: false });
    if (!datastore) {
      res.status(404).json({ error: `Not Found` });
      return;
    }
    let query = buildQuery(req.query);
    if (query._id !== undefined && query._id !== id) {
      res.status(400).json({ error: `Query _id must match route parameter` });
      return;
    }
    query._id = id;
    let removed = await removeDocuments(datastore, query, { multi: false });
    if (!removed) {
      res.status(404).json({ error: `Not Found` });
      return;
    }
    res.json({ deleted: removed });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: `Internal Server Error` });
  }
});

app.delete('/:collection', async (req, res) => {
  try {
    let collection = req.params.collection;
    let datastore = await getDatastore(collection, { createIfMissing: false });
    if (!datastore) {
      res.json({ deleted: 0 });
      return;
    }
    let query = buildQuery(req.query);
    let removed = await removeDocuments(datastore, query, { multi: true });
    res.json({ deleted: removed });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: `Internal Server Error` });
  }
});

function buildQuery(params) {
  let query = {};
  if (!params) {
    return query;
  }
  let entries = Object.entries(params);
  for (let index = 0; index < entries.length; index += 1) {
    let entry = entries[index];
    let key = entry[0];
    let value = entry[1];
    query[key] = value;
  }
  return query;
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
  if (!collection) {
    throw new Error('Collection name is required');
  }
  if (datastores.has(collection)) {
    return datastores.get(collection);
  }
  if (pendingLoads.has(collection)) {
    return pendingLoads.get(collection);
  }
  let filename = path.join(dbDir, `${collection}.json`);
  if (!createIfMissing) {
    let exists = await fileExists(filename);
    if (!exists) {
      return null;
    }
  } else {
    await mkdir(dbDir, { recursive: true });
  }
  if (datastores.has(collection)) {
    return datastores.get(collection);
  }
  if (pendingLoads.has(collection)) {
    return pendingLoads.get(collection);
  }
  let loader = (async () => {
    let datastore = new Datastore({ filename, autoload: false });
    await new Promise((resolve, reject) => {
      datastore.loadDatabase(err => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
    datastores.set(collection, datastore);
    return datastore;
  })();
  pendingLoads.set(collection, loader);
  try {
    let datastore = await loader;
    return datastore;
  } finally {
    pendingLoads.delete(collection);
  }
}

async function fileExists(filename) {
  try {
    await access(filename);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
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

let port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
