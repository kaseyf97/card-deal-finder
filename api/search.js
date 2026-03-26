import { getToken } from './token.js';
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
    const result = items.filter(item => !item.image || keepIds.has(item.id));

    // If Claude removed more than 80% of results, images likely weren't accessible — return original
    if (result.length < items.length * 0.2) {
      console.warn('Image filter removed too many results — falling back to text-filtered list');
      return items;
    }

    return result;

  } catch (err) {
    console.error('Image filter error (non-critical):', err.message);
    return items; // Degrade gracefully — return unfiltered
  }
}

// Keywords that — if found anywhere in a listing title — mean it's NOT an individual card.
// This runs server-side after eBay returns results, catching anything the search query missed.
const BLOCKED_TITLE_WORDS = [
  // Sealed products
  'hobby box', 'blaster box', 'blaster', 'hanger box', 'hanger', 'fat pack',
  'retail box', 'wax pack', 'jumbo box', 'jumbo pack', 'jumbo card',
  'sealed box', 'sealed pack', 'sealed case', 'sealed wax',
  'oversize', 'oversized',
  // Breaks & gambling listings
  'case break', 'group break', 'random break', 'live break', 'block chaser',
  'chaser pack', 'random slot', 'mystery box', 'mystery pack',
  // Lots & bundles
  'lot of', ' lot ', 'bundle', 'complete set', 'base set',
  // Fakes & reprints
  'reprint', 'custom card', 'fake', 'proxy'
];

// Words that must match as whole words only (to avoid blocking "breakthrough", "sandbox", etc.)
const BLOCKED_WHOLE_WORDS = ['break', 'breaks', 'box', 'boxes', 'sealed'];

// Filter items whose titles contain any blocked keyword (case-insensitive)
function filterByTitle(items) {
  return items.filter(item => {
    const title = (item.title || '').toLowerCase();
    if (BLOCKED_TITLE_WORDS.some(w => title.includes(w))) return false;
    if (BLOCKED_WHOLE_WORDS.some(w => new RegExp(`\\b${w}\\b`).test(title))) return false;
    return true;
  });
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

  const { q, maxPrice, sport, offset } = req.query;

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

    // Minimal exclusions — only the most obvious sealed products.
    // Keep this short so eBay returns maximum raw results; the server-side
    // title filter handles everything else precisely.
    const exclusions = '-"hobby box" -"blaster box" -"case break" -"group break" -reprint -proxy';
    const fullQuery = `${q.trim()} ${exclusions}`;

    // Build query params — limit 200 (eBay max) for more results to filter from
    const params = new URLSearchParams({
      q: fullQuery,
      filter: filters.join(','),
      sort: 'price',
      limit: '200',
      offset: offset || '0'
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

    // First pass: hard title filter — removes anything with blocked keywords in the title
    const titleFiltered = filterByTitle(items);

    // Second pass: Claude vision — removes any remaining listings whose image shows a box/pack
    const filteredItems = await filterByImage(titleFiltered);
    const finalItems = filteredItems.length > 0 ? filteredItems : titleFiltered;

    // nextOffset is based on raw items fetched (before filtering), not filtered count.
    // This is what eBay needs for the next page request.
    // hasMore: true when eBay returned a full page (100), meaning more pages likely exist.
    const currentOffset = parseInt(offset || 0);
    const nextOffset = currentOffset + items.length;
    const hasMore = items.length >= 100;

    return res.status(200).json({
      total: data.total || 0,
      nextOffset,
      hasMore,
      items: finalItems
    });

  } catch (err) {
    console.error('Search error:', err);
    return res.status(500).json({ error: 'Something went wrong' });
  }
}
