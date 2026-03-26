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
  'box', 'boxes', 'hobby box', 'blaster', 'hanger', 'fat pack', 'retail box',
  'sealed', 'wax pack', 'jumbo box', 'jumbo pack', 'jumbo card',
  'case break', 'group break', 'random break', 'live break', 'break',
  'lot of', ' lot ', 'bundle', 'complete set', 'base set',
  'reprint', 'custom card', 'fake', 'proxy',
  'chance', 'random chance', 'mystery box', 'mystery pack',
  'block chaser', 'chaser pack', 'random slot',
  'jumbo'
];

// Filter items whose titles contain any blocked keyword (case-insensitive)
function filterByTitle(items) {
  return items.filter(item => {
    const title = (item.title || '').toLowerCase();
    return !BLOCKED_TITLE_WORDS.some(word => title.includes(word.toLowerCase()));
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

    // Append exclusions to weed out sealed products, lots, base cards, chances, customs.
    // Use quoted phrases to avoid over-blocking (e.g. don't block "case hit", just "case break")
    const exclusions = '-lot -bundle -reprint -custom -fake -proxy -damaged -"base set" -"base card" -"hobby box" -"blaster box" -"hanger box" -"fat pack" -"retail box" -"case break" -"group break" -"wax pack" -"sealed pack" -"sealed box" -"jumbo box" -jumbo -"jumbo card" -chance -"random chance" -mystery -"block chaser" -chaser -"random slot"';
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

    // First pass: hard title filter — removes anything with blocked keywords in the title
    const titleFiltered = filterByTitle(items);

    // Second pass: Claude vision — removes any remaining listings whose image shows a box/pack
    const filteredItems = await filterByImage(titleFiltered);
    const finalItems = filteredItems.length > 0 ? filteredItems : titleFiltered;

    return res.status(200).json({
      total: data.total || 0,
      items: finalItems
    });

  } catch (err) {
    console.error('Search error:', err);
    return res.status(500).json({ error: 'Something went wrong' });
  }
}
