import { getToken } from './token.js';
import { createClient } from '@vercel/kv';
import Anthropic from '@anthropic-ai/sdk';

// Use Claude Haiku vision to filter out any listings whose image
// shows a box, pack, case, or sealed product instead of an actual card.
// If the API key isn't set or anything fails, returns items unchanged.
async function filterByImage(items) {
  if (!process.env.ANTHROPIC_API_KEY) return items;

  // Only check items that have an image
  const withImage = items.filter(i => i.image);
  if (withImage.length === 0) return items;

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    // Build the message — one image block per item, then a text prompt
    const imageBlocks = withImage.map(item => ({
      type: 'image',
      source: { type: 'url', url: item.image }
    }));

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      messages: [{
        role: 'user',
        content: [
          ...imageBlocks,
          {
            type: 'text',
            text: `These are eBay listing thumbnail images, numbered 0 to ${withImage.length - 1}.
I am looking for individual trading cards only — NOT boxes, packs, cases, sealed products, lots, or breaks.
Return a JSON array of the index numbers that show an actual individual trading card (not sealed/box/pack).
Example: [0,1,3,5]
Return ONLY the JSON array. No explanation.`
          }
        ]
      }]
    });

    // Parse Claude's response — expect something like [0,1,3,5]
    const raw = response.content[0]?.text?.trim() || '[]';
    const match = raw.match(/\[[\d,\s]*\]/);
    if (!match) return items; // Can't parse — return unfiltered

    const keepIndices = new Set(JSON.parse(match[0]));

    // Build set of item IDs to keep
    const keepIds = new Set(
      withImage.filter((_, i) => keepIndices.has(i)).map(item => item.id)
    );

    // Keep items with no image (can't filter them) + items Claude approved
    return items.filter(item => !item.image || keepIds.has(item.id));

  } catch (err) {
    console.error('Image filter error (non-critical):', err.message);
    return items; // Degrade gracefully — return unfiltered
  }
}

// Record price snapshot to KV (fire-and-forget, never blocks the response)
async function recordSnapshot(query, items) {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return;
  if (items.length === 0) return;

  try {
    const kv = createClient({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN
    });

    const prices = items.map(i => parseFloat(i.price)).filter(p => !isNaN(p));
    const snapshot = {
      timestamp: Date.now(),
      lowestPrice: Math.min(...prices),
      avgPrice: prices.reduce((a, b) => a + b, 0) / prices.length,
      count: items.length
    };

    // Keep last 30 snapshots per search query
    const key = `prices:${query.toLowerCase().replace(/\s+/g, '-').slice(0, 80)}`;
    const existing = await kv.get(key) || [];
    existing.push(snapshot);
    if (existing.length > 30) existing.splice(0, existing.length - 30);
    await kv.set(key, existing);
  } catch (err) {
    console.error('Snapshot error (non-critical):', err.message);
  }
}

// eBay category IDs for filtering by sport
const SPORT_CATEGORIES = {
  basketball: '214',   // Basketball Cards
  football: '215',     // Football Cards
  baseball: '213'      // Baseball Cards
};

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { q, maxPrice, sport } = req.query;

  if (!q || q.trim().length === 0) {
    return res.status(400).json({ error: 'Search query (q) is required' });
  }

  try {
    const token = await getToken();

    // Build filter string
    const filters = ['buyingOptions:{FIXED_PRICE}', 'priceCurrency:USD'];
    if (maxPrice) {
      filters.push(`price:[..${maxPrice}]`);
    }

    // Append exclusions to weed out sealed products, lots, base cards, chances, customs
    const exclusions = '-lot -bundle -reprint -custom -fake -proxy -damaged -"base set" -"base card" -common -box -"hobby box" -"blaster box" -"hanger box" -"fat pack" -"retail box" -"case break" -"group break" -break -pack -sealed -case -"jumbo box" -chance -"random chance" -mystery -"block chaser" -chaser -slot -"random slot"';
    const fullQuery = `${q.trim()} ${exclusions}`;

    // Build query params
    const params = new URLSearchParams({
      q: fullQuery,
      filter: filters.join(','),
      sort: 'price',
      limit: '40'
    });

    // Filter by sport category if specified
    if (sport && SPORT_CATEGORIES[sport]) {
      params.set('category_ids', SPORT_CATEGORIES[sport]);
    }

    const apiRes = await fetch(
      `https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
        }
      }
    );

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      console.error('eBay search error:', apiRes.status, errText);
      return res.status(502).json({ error: 'eBay search failed' });
    }

    const data = await apiRes.json();

    // Clean up the response — only send what the frontend needs
    const items = (data.itemSummaries || []).map(item => ({
      id: item.itemId,
      title: item.title,
      price: item.price?.value,
      currency: item.price?.currency,
      image: item.thumbnailImages?.[0]?.imageUrl || item.image?.imageUrl,
      url: item.itemWebUrl,
      condition: item.condition,
      seller: item.seller?.username,
      sellerScore: item.seller?.feedbackPercentage,
      location: item.itemLocation?.country
    }));

    // Use Claude vision to remove any remaining box/pack/sealed listings
    const filteredItems = await filterByImage(items);

    // Record price snapshot in background (don't await — don't slow down response)
    recordSnapshot(q.trim(), filteredItems);

    return res.status(200).json({
      total: data.total || 0,
      items: filteredItems
    });

  } catch (err) {
    console.error('Search error:', err);
    return res.status(500).json({ error: 'Something went wrong' });
  }
}
