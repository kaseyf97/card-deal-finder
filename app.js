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

// =============================================
// === Watchlist ===
// =============================================
const watchlistGrid    = document.getElementById('watchlist-grid');
const watchlistLoading = document.getElementById('watchlist-loading');
const watchlistCount   = document.getElementById('watchlist-count');
const addWatchBtn      = document.getElementById('add-watch-btn');
const addWatchForm     = document.getElementById('add-watch-form');
const saveWatchBtn     = document.getElementById('save-watch-btn');
const cancelWatchBtn   = document.getElementById('cancel-watch-btn');
const watchNameInput   = document.getElementById('watch-name');
const watchQueryInput  = document.getElementById('watch-query');
const watchSportInput  = document.getElementById('watch-sport');
const watchPriceInput  = document.getElementById('watch-price');

let watchlist = [];

// Load watchlist on page load
loadWatchlist();

async function loadWatchlist() {
  try {
    const res = await fetch('/api/watchlist');
    watchlist = await res.json();
    renderWatchlist();
  } catch (err) {
    watchlistLoading.textContent = 'Could not load watchlist.';
  }
}

function renderWatchlist() {
  watchlistLoading.classList.add('hidden');
  watchlistCount.textContent = watchlist.length;

  if (watchlist.length === 0) {
    watchlistGrid.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">No cards watched yet. Add one above.</p>';
    return;
  }

  const sportLabels = { basketball: '🏀 Basketball', football: '🏈 Football', baseball: '⚾ Baseball', '': 'All Sports' };

  watchlistGrid.innerHTML = watchlist.map(item => `
    <div class="watch-card ${item.enabled ? '' : 'disabled'}" data-id="${escapeHtml(item.id)}">
      <div class="watch-card-top">
        <div class="watch-card-name">${escapeHtml(item.name)}</div>
        <button class="watch-toggle ${item.enabled ? 'on' : ''}" data-id="${escapeHtml(item.id)}" title="${item.enabled ? 'Disable' : 'Enable'}"></button>
      </div>
      <div class="watch-card-meta">
        <span class="watch-sport-badge">${escapeHtml(sportLabels[item.sport] || item.sport)}</span>
        ${item.maxPrice ? `<span class="watch-max-price">≤ $${item.maxPrice}</span>` : '<span style="color:var(--text-muted);font-size:0.75rem;">No price limit</span>'}
      </div>
      <div class="watch-card-query">${escapeHtml(item.query)}</div>
      <div class="watch-card-actions">
        <button class="watch-search-btn" data-query="${escapeHtml(item.query)}" data-sport="${escapeHtml(item.sport)}">Search now →</button>
        <button class="watch-delete-btn" data-id="${escapeHtml(item.id)}" title="Remove">✕</button>
      </div>
    </div>
  `).join('');

  // Toggle enable/disable
  watchlistGrid.querySelectorAll('.watch-toggle').forEach(btn => {
    btn.addEventListener('click', () => toggleWatch(btn.dataset.id));
  });

  // Search now buttons
  watchlistGrid.querySelectorAll('.watch-search-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      queryInput.value = btn.dataset.query;
      sportSelect.value = btn.dataset.sport || '';
      maxPriceInput.value = '';
      // Find this item's maxPrice and prefill it
      const item = watchlist.find(w => w.query === btn.dataset.query);
      if (item?.maxPrice) maxPriceInput.value = item.maxPrice;
      runSearch();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  // Delete buttons
  watchlistGrid.querySelectorAll('.watch-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteWatch(btn.dataset.id));
  });
}

// Show/hide add form
addWatchBtn.addEventListener('click', () => {
  addWatchForm.classList.toggle('hidden');
  if (!addWatchForm.classList.contains('hidden')) watchNameInput.focus();
});

cancelWatchBtn.addEventListener('click', () => {
  addWatchForm.classList.add('hidden');
  clearAddForm();
});

saveWatchBtn.addEventListener('click', addWatch);

async function addWatch() {
  const name  = watchNameInput.value.trim();
  const query = watchQueryInput.value.trim();
  if (!name || !query) {
    watchNameInput.style.borderColor = name ? '' : 'rgba(239,68,68,0.6)';
    watchQueryInput.style.borderColor = query ? '' : 'rgba(239,68,68,0.6)';
    return;
  }

  saveWatchBtn.disabled = true;
  saveWatchBtn.textContent = 'Saving…';

  try {
    const res = await fetch('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        query,
        sport: watchSportInput.value,
        maxPrice: watchPriceInput.value || null
      })
    });

    if (!res.ok) {
      const err = await res.json();
      // If KV isn't set up yet, still show it locally for the session
      if (res.status === 503) {
        const tempItem = { id: `temp-${Date.now()}`, name, query, sport: watchSportInput.value, maxPrice: watchPriceInput.value ? Number(watchPriceInput.value) : null, enabled: true };
        watchlist.push(tempItem);
        renderWatchlist();
        addWatchForm.classList.add('hidden');
        clearAddForm();
        return;
      }
      throw new Error(err.error);
    }

    const newItem = await res.json();
    watchlist.push(newItem);
    renderWatchlist();
    addWatchForm.classList.add('hidden');
    clearAddForm();
  } catch (err) {
    console.error('Add watch error:', err);
  } finally {
    saveWatchBtn.disabled = false;
    saveWatchBtn.textContent = 'Save';
  }
}

async function toggleWatch(id) {
  const item = watchlist.find(w => w.id === id);
  if (!item) return;

  const newEnabled = !item.enabled;
  item.enabled = newEnabled; // Optimistic update
  renderWatchlist();

  try {
    await fetch('/api/watchlist', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, enabled: newEnabled })
    });
  } catch (err) {
    item.enabled = !newEnabled; // Revert on error
    renderWatchlist();
  }
}

async function deleteWatch(id) {
  watchlist = watchlist.filter(w => w.id !== id); // Optimistic update
  renderWatchlist();

  try {
    await fetch(`/api/watchlist?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch (err) {
    console.error('Delete error:', err);
  }
}

function clearAddForm() {
  watchNameInput.value = '';
  watchQueryInput.value = '';
  watchSportInput.value = '';
  watchPriceInput.value = '';
  watchNameInput.style.borderColor = '';
  watchQueryInput.style.borderColor = '';
}
