import { createClient } from '@vercel/kv';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const WATCHLIST_KEY = 'watchlist';

// Try to connect to KV — if env vars aren't set, fall back to local JSON
function getKV() {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return null;
  return createClient({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN
  });
}

// Load the default watchlist from the JSON file (used as fallback)
function loadDefaults() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const filePath = join(__dirname, '..', 'data', 'default-watchlist.json');
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}

async function getWatchlist(kv) {
  if (!kv) return loadDefaults();
  const stored = await kv.get(WATCHLIST_KEY);
  // First time: seed KV with defaults
  if (!stored) {
    const defaults = loadDefaults();
    await kv.set(WATCHLIST_KEY, defaults);
    return defaults;
  }
  return stored;
}

export default async function handler(req, res) {
  const kv = getKV();

  // GET — return all watchlist items
  if (req.method === 'GET') {
    const list = await getWatchlist(kv);
    return res.status(200).json(list);
  }

  // All write operations require KV to be set up
  if (!kv) {
    return res.status(503).json({
      error: 'Watchlist storage not configured. Set up Vercel KV to enable saves.'
    });
  }

  // POST — add a new item
  if (req.method === 'POST') {
    const { name, query, sport, maxPrice } = req.body;
    if (!name || !query) return res.status(400).json({ error: 'name and query are required' });

    const list = await getWatchlist(kv);
    const newItem = {
      id: `custom-${Date.now()}`,
      name: String(name).slice(0, 100),
      query: String(query).slice(0, 200),
      sport: sport || '',
      maxPrice: maxPrice ? Number(maxPrice) : null,
      enabled: true
    };
    list.push(newItem);
    await kv.set(WATCHLIST_KEY, list);
    return res.status(201).json(newItem);
  }

  // PUT — update an existing item (toggle enabled, change maxPrice)
  if (req.method === 'PUT') {
    const { id, enabled, maxPrice, name } = req.body;
    if (!id) return res.status(400).json({ error: 'id is required' });

    const list = await getWatchlist(kv);
    const idx = list.findIndex(item => item.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Item not found' });

    if (enabled !== undefined) list[idx].enabled = Boolean(enabled);
    if (maxPrice !== undefined) list[idx].maxPrice = maxPrice ? Number(maxPrice) : null;
    if (name !== undefined) list[idx].name = String(name).slice(0, 100);

    await kv.set(WATCHLIST_KEY, list);
    return res.status(200).json(list[idx]);
  }

  // DELETE — remove an item
  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id is required' });

    const list = await getWatchlist(kv);
    const filtered = list.filter(item => item.id !== id);
    await kv.set(WATCHLIST_KEY, filtered);
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
