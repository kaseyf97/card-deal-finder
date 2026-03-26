// Uses eBay Finding API (findCompletedItems) to get recent sold data
// for a search query, then returns avg sold price and count.
// One call per search — efficient, no per-card API calls.

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'q is required' });

  const appId = process.env.EBAY_APP_ID;
  if (!appId) return res.status(503).json({ error: 'Not configured' });

  try {
    const params = new URLSearchParams({
      'OPERATION-NAME':        'findCompletedItems',
      'SERVICE-VERSION':       '1.13.0',
      'SECURITY-APPNAME':      appId,
      'RESPONSE-DATA-FORMAT':  'JSON',
      'keywords':              q.trim(),
      'itemFilter(0).name':    'SoldItemsOnly',
      'itemFilter(0).value':   'true',
      'itemFilter(1).name':    'ListingType',
      'itemFilter(1).value':   'FixedPrice',
      'sortOrder':             'StartTimeNewest',
      'paginationInput.entriesPerPage': '20'
    });

    const apiRes = await fetch(
      `https://svcs.ebay.com/services/search/FindingService/v1?${params}`
    );

    if (!apiRes.ok) {
      console.error('Finding API error:', apiRes.status);
      return res.status(200).json({ available: false });
    }

    const data = await apiRes.json();
    const items = data?.findCompletedItemsResponse?.[0]?.searchResult?.[0]?.item || [];

    const prices = items
      .map(i => parseFloat(i.sellingStatus?.[0]?.currentPrice?.[0]?.__value__))
      .filter(p => !isNaN(p) && p > 0);

    if (prices.length < 3) {
      return res.status(200).json({ available: false });
    }

    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;

    return res.status(200).json({
      available: true,
      avgSoldPrice: Math.round(avg * 100) / 100,
      sampleSize: prices.length
    });

  } catch (err) {
    console.error('Comps error:', err.message);
    return res.status(200).json({ available: false });
  }
}
