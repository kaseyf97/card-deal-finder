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

// =============================================
// === Guided Selector ===
// =============================================

// Card sets per sport — each has a display name, publisher, and eBay search term.
// For broad product lines (Prizm, Mosaic, Optic, Select, Chrome) we append "insert"
// so results focus on inserts/SSPs rather than returning thousands of base cards.
const SETS_BY_SPORT = {
  football: [
    { id: 'downtown',  label: 'Downtown',            term: 'Panini Downtown' },
    { id: 'kaboom',    label: 'Kaboom',               term: 'Panini Kaboom' },
    { id: 'uptown',    label: 'Uptown',               term: 'Panini Uptown' },
    { id: 'mosaic',    label: 'Mosaic',               term: 'Panini Mosaic insert' },
    { id: 'optic',     label: 'Optic',                term: 'Donruss Optic insert' },
    { id: 'prizm',     label: 'Prizm',                term: 'Panini Prizm insert' },
    { id: 'select',    label: 'Select',               term: 'Panini Select insert' },
    { id: 'nt',        label: 'National Treasures',   term: 'Panini National Treasures' },
    { id: 'noir',      label: 'Noir',                 term: 'Panini Noir' }
  ],
  basketball: [
    { id: 'downtown',  label: 'Downtown',            term: 'Panini Downtown' },
    { id: 'kaboom',    label: 'Kaboom',               term: 'Panini Kaboom' },
    { id: 'uptown',    label: 'Uptown',               term: 'Panini Uptown' },
    { id: 'colorblast',label: 'Color Blast',          term: 'Panini Color Blast' },
    { id: 'mosaic',    label: 'Mosaic',               term: 'Panini Mosaic insert' },
    { id: 'optic',     label: 'Optic',                term: 'Donruss Optic insert' },
    { id: 'prizm',     label: 'Prizm',                term: 'Panini Prizm insert' },
    { id: 'select',    label: 'Select',               term: 'Panini Select insert' },
    { id: 'nt',        label: 'National Treasures',   term: 'Panini National Treasures' },
    { id: 'noir',      label: 'Noir',                 term: 'Panini Noir' }
  ],
  baseball: [
    { id: 'colorblast',label: 'Color Blast',          term: 'Topps Color Blast' },
    { id: 'chrome',    label: 'Chrome',               term: 'Topps Chrome insert' },
    { id: 'heritage',  label: 'Heritage',             term: 'Topps Heritage insert' },
    { id: 'stadium',   label: 'Stadium Club',         term: 'Topps Stadium Club insert' },
    { id: 'finest',    label: 'Topps Finest',         term: 'Topps Finest insert' },
    { id: 'mosaic',    label: 'Mosaic',               term: 'Panini Mosaic insert' }
  ]
};

// State
let gSport = null, gSet = null, gYear = null;

const guidedSearchBtn = document.getElementById('guided-search-btn');
const sportChipsEl    = document.getElementById('sport-chips');
const setChipsEl      = document.getElementById('set-chips');
const stepSet         = document.getElementById('step-set');
const stepYear        = document.getElementById('step-year');
const yearChipsEl     = document.getElementById('year-chips');

// Activate a step (remove dimmed, add active animation)
function activateStep(el) {
  el.classList.remove('dimmed');
  el.classList.remove('active');
  void el.offsetWidth; // force reflow to restart animation
  el.classList.add('active');
}

// Render chips into a container
function renderChips(container, items, selectedValue, onClick) {
  container.innerHTML = items.map(item => {
    const val   = typeof item === 'string' ? item : item.id;
    const label = typeof item === 'string' ? item : item.label;
    const sel   = val === selectedValue ? 'selected' : '';
    return `<button class="chip ${sel}" data-value="${escapeHtml(val)}">${escapeHtml(label)}</button>`;
  }).join('');
  container.querySelectorAll('.chip').forEach(btn => {
    btn.addEventListener('click', () => onClick(btn.dataset.value));
  });
}

// Sport selected
sportChipsEl.querySelectorAll('.chip').forEach(btn => {
  btn.addEventListener('click', () => {
    gSport = btn.dataset.value;
    gSet = null; gYear = null;

    // Update sport chip selection
    sportChipsEl.querySelectorAll('.chip').forEach(b => b.classList.toggle('selected', b.dataset.value === gSport));

    // Populate + activate set chips
    renderChips(setChipsEl, SETS_BY_SPORT[gSport] || [], null, onSetSelected);
    activateStep(stepSet);

    // Reset downstream
    stepYear.classList.add('dimmed');
    stepYear.classList.remove('active');
    yearChipsEl.querySelectorAll('.chip').forEach(b => b.classList.remove('selected'));

    // Update sport filter dropdown + enable search with broad query
    sportSelect.value = gSport;
    guidedSearchBtn.disabled = false;
  });
});

function onSetSelected(setId) {
  gSet = (gSet === setId) ? null : setId; // toggle
  renderChips(setChipsEl, SETS_BY_SPORT[gSport] || [], gSet, onSetSelected);

  if (gSet) {
    activateStep(stepYear);
  } else {
    stepYear.classList.add('dimmed');
  }
}

// Year chips
yearChipsEl.querySelectorAll('.chip').forEach(btn => {
  btn.addEventListener('click', () => {
    gYear = (gYear === btn.dataset.value) ? null : btn.dataset.value;
    yearChipsEl.querySelectorAll('.chip').forEach(b => b.classList.toggle('selected', b.dataset.value === gYear));
  });
});

// Build query from guided selections and run search
guidedSearchBtn.addEventListener('click', () => {
  if (!gSport) return;
  const parts = [];
  if (gYear) parts.push(gYear);
  if (gSet) {
    const setInfo = (SETS_BY_SPORT[gSport] || []).find(s => s.id === gSet);
    if (setInfo) parts.push(setInfo.term);
  }
  // Only add sport as a keyword if no set was chosen (broad fallback).
  // When a set is selected, the eBay category filter handles sport — adding the sport
  // word to the query reduces results since sellers don't always use it in titles.
  if (!gSet) parts.push(gSport);

  queryInput.value = parts.join(' ');
  sportSelect.value = gSport;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  runSearch();
});

// Tracks current search state for Load More
let searchState = { q: '', maxPrice: '', sport: '', offset: 0, total: 0 };

async function runSearch(append = false) {
  const q = queryInput.value.trim();
  if (!q) return;

  if (!append) {
    searchState = { q, maxPrice: maxPriceInput.value, sport: sportSelect.value, offset: 0, total: 0 };
    resultsGrid.innerHTML = '';
    resultsHeader.classList.add('hidden');
    noResultsEl.classList.add('hidden');
    hideLoadMore();
  }

  showLoading(true);
  hideError();
  searchBtn.disabled = true;

  try {
    const params = new URLSearchParams({ q: searchState.q });
    if (searchState.maxPrice) params.set('maxPrice', searchState.maxPrice);
    if (searchState.sport) params.set('sport', searchState.sport);
    if (searchState.offset) params.set('offset', searchState.offset);

    const res = await fetch(`/api/search?${params}`);
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Search failed');

    searchState.total = data.total || 0;
    searchState.offset = data.nextOffset ?? (searchState.offset + data.items.length);

    if (data.items.length === 0 && !append) {
      noResultsEl.classList.remove('hidden');
    } else {
      if (append) {
        appendResults(data.items);
      } else {
        renderResults(data.items, searchState.total, q);
      }
      fetchAndApplyComps();
      // Show Load More when eBay returned a full page (meaning more pages exist)
      if (data.hasMore) {
        showLoadMore();
      } else {
        hideLoadMore();
      }
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
    <div class="card" data-price="${escapeHtml(item.price || '')}">
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
          <div class="card-price-row">
            <div class="card-price">$${formatPrice(item.price)}</div>
            <div class="comp-badge comp-loading">…</div>
          </div>
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

// Appends more cards to the existing grid (Load More)
function appendResults(items) {
  const html = items.map(item => `
    <div class="card" data-price="${escapeHtml(item.price || '')}">
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
          <div class="card-price-row">
            <div class="card-price">$${formatPrice(item.price)}</div>
            <div class="comp-badge comp-loading">…</div>
          </div>
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
  resultsGrid.insertAdjacentHTML('beforeend', html);
}

// === Load More ===
const loadMoreBtn = document.getElementById('load-more-btn');
loadMoreBtn.addEventListener('click', () => runSearch(true));

function showLoadMore() { loadMoreBtn.classList.remove('hidden'); }
function hideLoadMore() { loadMoreBtn.classList.add('hidden'); }

// === Comp Badges ===
// Calculates average listing price from the current results and badges each card
// showing how it compares (e.g. "18% below avg listing · $142.00")
function fetchAndApplyComps() {
  const cards = Array.from(resultsGrid.querySelectorAll('.card'));
  if (cards.length === 0) return;

  const prices = cards
    .map(c => parseFloat(c.dataset.price))
    .filter(p => !isNaN(p) && p > 0);

  if (prices.length < 3) {
    cards.forEach(c => c.querySelector('.comp-badge')?.remove());
    return;
  }

  const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
  const avgFormatted = `$${avg.toFixed(2)}`;

  cards.forEach(card => {
    const badge = card.querySelector('.comp-badge');
    if (!badge) return;

    const price = parseFloat(card.dataset.price);
    if (isNaN(price)) { badge.remove(); return; }

    const diffPct = Math.round(((price - avg) / avg) * 100);

    if (diffPct <= -5) {
      badge.className = 'comp-badge comp-below';
      badge.textContent = `${Math.abs(diffPct)}% below avg · ${avgFormatted}`;
    } else if (diffPct >= 5) {
      badge.className = 'comp-badge comp-above';
      badge.textContent = `${diffPct}% above avg · ${avgFormatted}`;
    } else {
      badge.className = 'comp-badge comp-near';
      badge.textContent = `Near avg · ${avgFormatted}`;
    }
  });
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
