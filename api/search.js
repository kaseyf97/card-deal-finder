import { getToken } from './token.js';
import Anthropic from '@anthropic-ai/sdk';

// Use Claude Haiku vision to filter out listings whose image shows a box,
// pack, case, or sealed product. Processes in batches of 20 so Claude stays
// accurate — sending 100+ images at once hurts accuracy significantly.
async function filterByImage(items) {
  if (!process.env.ANTHROPIC_API_KEY) return items;

  const withImage = items.filter(i => i.image);
  const noImage   = items.filter(i => !i.image);
  if (withImage.length === 0) return items;

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const BATCH_SIZE = 20;
  const keepIds = new Set();

  // Split into batches of 20 and run Claude on each
  for (let i = 0; i < withImage.length; i += BATCH_SIZE) {
    const batch = withImage.slice(i, i + BATCH_SIZE);

    try {
      const imageBlocks = batch.map(item => ({
        type: 'image',
        source: { type: 'url', url: item.image }
      }));

      const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 128,
        messages: [{
          role: 'user',
          content: [
            ...imageBlocks,
            {
              type: 'text',
              text: `eBay listing thumbnails, numbered 0 to ${batch.length - 1}.
Keep ONLY individual trading cards. Reject: boxes, packs, cases, sealed products, lots, breaks, oversized cards, stickers.
Return a JSON array of index numbers to KEEP. Example: [0,2,4]
JSON only, no explanation.`
            }
          ]
        }]
      });

      const raw = response.content[0]?.text?.trim() || '[]';
      const match = raw.match(/\[[\d,\s]*\]/);
      if (!match) {
        // Can't parse this batch — keep all items in it
        batch.forEach(item => keepIds.add(item.id));
        continue;
      }

      const kept = new Set(JSON.parse(match[0]));

      // If Claude kept < 10% of the batch, images likely inaccessible — keep all
      if (kept.size < batch.length * 0.1) {
        batch.forEach(item => keepIds.add(item.id));
      } else {
        batch.filter((_, idx) => kept.has(idx)).forEach(item => keepIds.add(item.id));
      }

    } catch (err) {
      console.error(`Image filter batch ${i} error:`, err.message);
      // On error, keep the whole batch rather than silently dropping items
      batch.forEach(item => keepIds.add(item.id));
    }
  }

  // Items with no image pass through automatically
  const filtered = [...noImage, ...withImage.filter(item => keepIds.has(item.id))];

  // Final safety: if we somehow ended up with nothing, return original
  return filtered.length > 0 ? filtered : items;
}

// Keywords that — if found anywhere in a listing title — mean it's NOT an individual card.
// This runs server-side after eBay returns results, catching anything the search query missed.
const BLOCKED_TITLE_WORDS = [
  // Sealed products
  'hobby box', 'blaster box', 'blaster', 'hanger box', 'hanger', 'fat pack',
  'retail box', 'wax pack', 'jumbo box', 'jumbo pack', 'jumbo card', 'jumbo pack',
  'sealed box', 'sealed pack', 'sealed case', 'sealed wax',
  'oversize', 'oversized', 'oversized card', 'jumbo size',
  // Breaks & gambling listings
  'case break', 'group break', 'random break', 'live break', 'block chaser',
  'chaser pack', 'random slot', 'mystery box', 'mystery pack',
  // Lots & bundles
  'lot of', ' lot ', 'bundle', 'complete set', 'base set',
  // Fakes & reprints
  'reprint', 'custom card', 'fake', 'proxy'
];

// Words that must match as whole words only (to avoid blocking "breakthrough", "sandbox", etc.)
const BLOCKED_WHOLE_WORDS = ['break', 'breaks', 'box', 'boxes', 'sealed', 'jumbo', 'oversize', 'oversized'];

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
