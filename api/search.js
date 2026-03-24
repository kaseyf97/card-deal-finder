import { getToken } from './token.js';

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

    // Build query params
    const params = new URLSearchParams({
      q: q.trim(),
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

    return res.status(200).json({
      total: data.total || 0,
      items
    });

  } catch (err) {
    console.error('Search error:', err);
    return res.status(500).json({ error: 'Something went wrong' });
  }
}
