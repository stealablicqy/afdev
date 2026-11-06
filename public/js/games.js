/* Game library — the v1 AF Game Hub catalog plus a fullscreen player.
   The catalog is generated into js/games-catalog.js; this file is presentation
   and playback only. Every entry is an external page rendered in an iframe, so
   nothing here holds game logic. */
(() => {
  'use strict';
  const U = window.AFUtil;
  const source = Array.isArray(window.AF_GAMES) ? window.AF_GAMES : [];

  const games = source.map(entry => ({
    id: entry.id,
    title: entry.name,
    art: entry.img,
    category: entry.cat,
    url: entry.url,
    description: entry.desc,
    type: 'embed'
  }));

  const CATEGORY_LABELS = {
    action: 'Action',
    arcade: 'Arcade',
    adventure: 'Adventure',
    horror: 'Horror',
    simulation: 'Simulation',
    sports: 'Sports',
    music: 'Music',
    puzzle: 'Puzzle',
    other: 'Other'
  };

  const imageFallback = 'assets/falcon.png';
  const byId = new Map(games.map(g => [g.id, g]));
  let activeCleanup = null;

  function cleanup() {
    if (activeCleanup) { activeCleanup(); activeCleanup = null; }
  }

  const favorites = () => AFStore.get('gameFavorites', []);
  const isFav = id => favorites().includes(id);
  function saveFav(id) {
    const list = favorites();
    const next = list.includes(id) ? list.filter(x => x !== id) : [...list, id];
    AFStore.set('gameFavorites', next);
    return next.includes(id);
  }

  function label(cat) {
    return CATEGORY_LABELS[cat] || CATEGORY_LABELS.other;
  }

  function categories() {
    const counts = new Map();
    for (const g of games) counts.set(g.category, (counts.get(g.category) || 0) + 1);
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([cat, count]) => ({ cat, count, label: label(cat) }));
  }

  function card(game) {
    const fav = isFav(game.id);
    return `<article class="library-card">
      <div class="library-art"><img src="${U.esc(game.art || imageFallback)}" alt="" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='${imageFallback}'"><span class="library-tag">${U.esc(label(game.category))}</span></div>
      <div class="library-card-body"><div class="library-card-title"><strong>${U.esc(game.title)}</strong><button class="icon-btn fav-toggle ${fav ? 'is-fav' : ''}" data-action="game-favorite" data-id="${U.esc(game.id)}" aria-label="${fav ? 'Remove from' : 'Add to'} favorites">${fav ? '&#9829;' : '&#9825;'}</button></div>
      <p>${U.esc(game.description)}</p><div class="card-actions"><button class="btn btn-primary btn-sm" data-action="game-launch" data-id="${U.esc(game.id)}">Play &#8599;</button></div></div></article>`;
  }

  function emptyState(message) {
    return `<div class="catalog-empty"><p>${U.esc(message)}</p></div>`;
  }

  function renderCatalog() {
    const fav = favorites();
    const recentIds = AFStore.get('recentGames', []);
    const favoriteGames = games.filter(g => fav.includes(g.id));
    const recentGames = recentIds.map(id => byId.get(id)).filter(Boolean).slice(0, 8);
    const cats = categories();

    return `<div class="page-head"><div><div class="eyebrow">${games.length} GAMES &bull; ONE LIBRARY</div><h1 class="page-title">Games</h1><p class="page-subtitle">Everything from the original AF Game Hub, playable right here in the hub.</p></div><button class="btn btn-primary" data-action="game-random">&#10022; Surprise me</button></div>
      <div class="filter-row"><input class="input" id="gameSearch" type="search" placeholder="Search ${games.length} games&hellip;" aria-label="Search games" autocomplete="off"><div class="filter-chips" id="gameFilters"><button class="chip active" data-filter="All">All</button>${cats.map(c => `<button class="chip" data-filter="${U.esc(c.cat)}">${U.esc(c.label)} <span class="chip-count">${c.count}</span></button>`).join('')}</div></div>
      ${recentGames.length ? `<div class="section-title-row"><div><h2 class="section-title">Jump back in</h2><p class="section-sub">Recently played on this device.</p></div></div><div class="card-grid">${recentGames.map(card).join('')}</div>` : ''}
      ${favoriteGames.length ? `<div class="section-title-row"><div><h2 class="section-title">Your favorites</h2><p class="section-sub">Saved locally, no account needed.</p></div></div><div class="card-grid">${favoriteGames.map(card).join('')}</div>` : ''}
      <div class="section-title-row"><div><h2 class="section-title">All games</h2><p class="section-sub"><span id="gamesVisibleCount">${games.length}</span> of ${games.length} shown</p></div><span class="tiny-label">SELF HOSTED</span></div>
      <div class="card-grid" id="gamesGrid">${games.map(card).join('')}</div>
      <div class="catalog-more"><button class="btn" id="gamesMore" hidden>Load more</button></div>`;
  }

  /* The grid carries 439 cards; mounting all of them at once costs more than it
     is worth on a school Chromebook. Render the filtered set in pages of 60 and
     grow on demand. */
  const PAGE = 60;
  let visible = PAGE;

  function filtered(filter, query) {
    const q = (query || '').trim().toLowerCase();
    return games.filter(g => {
      if (filter && filter !== 'All' && g.category !== filter) return false;
      if (!q) return true;
      return g.title.toLowerCase().includes(q) || g.description.toLowerCase().includes(q);
    });
  }

  function paint() {
    const grid = document.getElementById('gamesGrid');
    if (!grid) return;
    const input = document.getElementById('gameSearch');
    const activeChip = document.querySelector('#gameFilters .chip.active');
    const filter = activeChip ? activeChip.dataset.filter : 'All';
    const list = filtered(filter, input ? input.value : '');
    const slice = list.slice(0, visible);
    grid.innerHTML = slice.length ? slice.map(card).join('') : emptyState('No games match that search.');
    const count = document.getElementById('gamesVisibleCount');
    if (count) count.textContent = list.length;
    const more = document.getElementById('gamesMore');
    if (more) more.hidden = list.length <= visible;
  }

  let paintTimer = null;
  function schedulePaint() {
    if (paintTimer) clearTimeout(paintTimer);
    paintTimer = setTimeout(() => { paintTimer = null; paint(); }, 120);
  }

  function bindCatalog() {
    cleanup();
    visible = PAGE;
    paint();

    const input = document.getElementById('gameSearch');
    if (input) input.addEventListener('input', () => { visible = PAGE; schedulePaint(); });

    const filters = document.getElementById('gameFilters');
    if (filters) {
      filters.addEventListener('click', ev => {
        const chip = ev.target.closest('.chip');
        if (!chip) return;
        filters.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c === chip));
        visible = PAGE;
        paint();
      });
    }

    const more = document.getElementById('gamesMore');
    if (more) more.addEventListener('click', () => { visible += PAGE; paint(); });

    activeCleanup = () => { if (paintTimer) { clearTimeout(paintTimer); paintTimer = null; } };
  }

  function play(id) {
    const game = byId.get(id);
    if (!game) { AF.toast('That game is no longer in the library.', 'error'); return; }
    const recent = AFStore.get('recentGames', []).filter(x => x !== id);
    AFStore.set('recentGames', [id, ...recent].slice(0, 24));
    openPlayer(game);
  }

  function openRandom() {
    if (!games.length) return;
    play(games[Math.floor(Math.random() * games.length)].id);
  }

  /* Fullscreen player. The iframe points at the game's own HTML page; nothing is
     injected into it, so the game keeps its own origin and its own storage. */
  function openPlayer(game) {
    cleanup();
    const host = document.createElement('div');
    host.className = 'game-player';
    host.setAttribute('role', 'dialog');
    host.setAttribute('aria-modal', 'true');
    host.setAttribute('aria-label', game.title);
    host.innerHTML = `<header class="game-player-bar">
        <button class="icon-button" data-player="close" aria-label="Close game">&larr;</button>
        <div class="game-player-meta"><strong>${U.esc(game.title)}</strong><small>${U.esc(label(game.category))}</small></div>
        <div class="game-player-actions">
          <button class="icon-button" data-player="fav" aria-label="Toggle favorite">${isFav(game.id) ? '&#9829;' : '&#9825;'}</button>
          <button class="icon-button" data-player="reload" aria-label="Reload">&#8635;</button>
          <button class="icon-button" data-player="full" aria-label="Fullscreen">&#9974;</button>
        </div>
      </header>
      <div class="game-player-frame"><iframe src="${U.esc(game.url)}" title="${U.esc(game.title)}" allow="fullscreen; autoplay; gamepad; clipboard-write" referrerpolicy="no-referrer" allowfullscreen></iframe></div>`;
    document.body.appendChild(host);
    document.body.classList.add('player-open');

    const frame = host.querySelector('iframe');
    const favBtn = host.querySelector('[data-player="fav"]');

    function close() {
      document.removeEventListener('keydown', onKey);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      host.remove();
      document.body.classList.remove('player-open');
      activeCleanup = null;
    }

    function onKey(ev) {
      if (ev.key === 'Escape') { ev.preventDefault(); close(); }
    }

    host.addEventListener('click', ev => {
      const btn = ev.target.closest('[data-player]');
      if (!btn) return;
      const action = btn.dataset.player;
      if (action === 'close') return close();
      if (action === 'reload') { frame.src = frame.src; return; }
      if (action === 'full') {
        const target = host.querySelector('.game-player-frame');
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        else if (target.requestFullscreen) target.requestFullscreen().catch(() => {});
        return;
      }
      if (action === 'fav') {
        const on = saveFav(game.id);
        favBtn.innerHTML = on ? '&#9829;' : '&#9825;';
        AF.toast(on ? 'Added to favorites.' : 'Removed from favorites.');
      }
    });

    document.addEventListener('keydown', onKey);
    activeCleanup = close;
  }

  window.AFGames = {
    games,
    renderCatalog,
    bindCatalog,
    launch: play,
    launchRandom: openRandom,
    saveFav,
    cleanup,
    get categories() { return categories(); }
  };
})();
