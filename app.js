// === DOM Elements ===
const searchForm = document.getElementById('search-form');
const queryInput = document.getElementById('query');
const maxPriceInput = document.getElementById('max-price');
const sportSelect = document.getElementById('sport');
const searchBtn = document.getElementById('search-btn');
const resultsGrid = document.getElementById('results-grid');
const resultsHeader = document.getElementById('results-header');
const resultsCount = document.getElementById('results-count');
const resultsQuery = document.getElementById('results-query');
const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error');
const noResultsEl = document.getElementById('no-results');

// === Search ===
searchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  runSearch();
});

// Quick search buttons fill in the form and search
document.querySelectorAll('.quick-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    queryInput.value = btn.dataset.query;
    sportSelect.value = btn.dataset.sport || '';
    runSearch();
  });
});

async function runSearch() {
  const q = queryInput.value.trim();
  if (!q) return;

  // Show loading, hide everything else
  showLoading(true);
  hideError();
  resultsGrid.innerHTML = '';
  resultsHeader.classList.add('hidden');
  noResultsEl.classList.add('hidden');
  searchBtn.disabled = true;

  try {
    // Build query string
    const params = new URLSearchParams({ q });
    const maxPrice = maxPriceInput.value;
    const sport = sportSelect.value;
    if (maxPrice) params.set('maxPrice', maxPrice);
    if (sport) params.set('sport', sport);

    const res = await fetch(`/api/search?${params}`);
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Search failed');
    }

    if (data.items.length === 0) {
      noResultsEl.classList.remove('hidden');
    } else {
      renderResults(data.items, data.total, q);
    }
  } catch (err) {
    showError(err.message);
  } finally {
    showLoading(false);
    searchBtn.disabled = false;
  }
}

// === Render Results ===
function renderResults(items, total, query) {
  resultsCount.textContent = `${total} listing${total !== 1 ? 's' : ''} found`;
  resultsQuery.textContent = `for "${query}"`;
  resultsHeader.classList.remove('hidden');

  resultsGrid.innerHTML = items.map(item => `
    <div class="card">
      <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener">
        <div class="card-img-wrap">
          <img
            class="card-img"
            src="${escapeHtml(item.image || '')}"
            alt="${escapeHtml(item.title)}"
            loading="lazy"
            onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%2250%%22 x=%2250%%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 font-size=%2212%22 fill=%22%23475569%22>No Image</text></svg>'"
          >
        </div>
        <div class="card-body">
          <div class="card-title">${escapeHtml(item.title)}</div>
          <div class="card-price">$${formatPrice(item.price)}</div>
          <div class="card-footer">
            <span class="card-condition">${escapeHtml(item.condition || 'N/A')}</span>
            <span class="card-seller">
              ${item.sellerScore ? `<span class="seller-score">${item.sellerScore}%</span>` : ''}
            </span>
          </div>
        </div>
        <span class="card-view-btn">View on eBay →</span>
      </a>
    </div>
  `).join('');
}

// === Helpers ===
function formatPrice(value) {
  if (!value) return '?.??';
  const num = parseFloat(value);
  return num.toFixed(2);
}

// Prevent XSS by escaping HTML characters in eBay data
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showLoading(show) {
  loadingEl.classList.toggle('hidden', !show);
}

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.classList.remove('hidden');
}

function hideError() {
  errorEl.classList.add('hidden');
}
