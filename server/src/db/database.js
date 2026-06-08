import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', '..', 'data');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function getFilePath(collection) {
  return path.join(DATA_DIR, `${collection}.json`);
}

function readCollection(collection) {
  const filePath = getFilePath(collection);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

function writeCollection(collection, data) {
  const filePath = getFilePath(collection);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ===== CRUD Operations =====

export function getAll(collection) {
  return readCollection(collection);
}

export function getById(collection, id) {
  const data = readCollection(collection);
  return data.find(item => item.id === id) || null;
}

export function query(collection, filterFn) {
  const data = readCollection(collection);
  return data.filter(filterFn);
}

export function insert(collection, item) {
  const data = readCollection(collection);
  const maxId = data.reduce((max, d) => Math.max(max, d.id || 0), 0);
  const newItem = { id: maxId + 1, ...item };
  data.push(newItem);
  writeCollection(collection, data);
  return newItem;
}

export function update(collection, id, updates) {
  const data = readCollection(collection);
  const index = data.findIndex(item => item.id === id);
  if (index === -1) return null;
  data[index] = { ...data[index], ...updates };
  writeCollection(collection, data);
  return data[index];
}

export function upsertByField(collection, field, value, item) {
  const data = readCollection(collection);
  const index = data.findIndex(d => d[field] === value);
  if (index === -1) {
    const maxId = data.reduce((max, d) => Math.max(max, d.id || 0), 0);
    const newItem = { id: maxId + 1, ...item };
    data.push(newItem);
    writeCollection(collection, data);
    return newItem;
  }
  data[index] = { ...data[index], ...item };
  writeCollection(collection, data);
  return data[index];
}

export function remove(collection, id) {
  const data = readCollection(collection);
  const filtered = data.filter(item => item.id !== id);
  writeCollection(collection, filtered);
  return filtered.length < data.length;
}

export function clearCollection(collection) {
  writeCollection(collection, []);
}

export default { getAll, getById, query, insert, update, upsertByField, remove, clearCollection };
