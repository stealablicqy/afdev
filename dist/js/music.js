(() => {
  'use strict';
  const U = window.AFUtil;
  const audio = document.getElementById('audioEngine');
  const API = '/api/music';
  let view = 'browse';
  let currentTrack = null;
  let queue = [];
  let queueIndex = -1;
  let visibleTracks = [];
  let currentPlaylistId = '';
  let repeatMode = 'all';
  let shuffleMode = false;
  let requestNo = 0;
  let searchText = '';
  let artistMode = null;
  let lastError = '';
  const trackCache = new Map();
  const LYRICS_API = '/api/lyrics';
  let lyricsOpen = false;
  let lyrics = null;
  let lyricsLoading = false;
  let lyricsTrackId = '';
  let lyricsToken = 0;
  let lyricsWide = false;
  let activeLyricIndex = -1;
  let artistsCache = [];

  const getSaved = () => AFStore.get('musicTracks', []);
  const saveSaved = value => AFStore.set('musicTracks', value);
  const getFavorites = () => AFStore.get('musicFavorites', []);
  const setFavorites = value => AFStore.set('musicFavorites', value);
  const getPlaylists = () => AFStore.get('musicPlaylists', [{id:'afm-liked',name:'Liked Songs',trackIds:[]}]);
  const setPlaylists = value => AFStore.set('musicPlaylists', value);
  const getHistory = () => AFStore.get('musicHistory', []);
  const esc = value => U.esc(value ?? '');

  function normalize(raw) {
    const user = raw.user || raw.user_data || {};
    const art = raw.artwork || raw.cover_art || {};
    const id = String(raw.id ?? raw.track_id ?? '');
    const title = String(raw.title || 'Untitled track').slice(0,180);
    const artist = String(raw.artist || raw.artist_name || user.name || user.handle || 'Unknown artist').slice(0,120);
    const permalink = raw.permalink || raw.url || (raw.slug ? `https://audius.co/${raw.slug}` : 'https://audius.co/');
    const artwork = typeof art === 'string' ? art : (art._480x480 || art._1000x1000 || art._150x150 || raw.artwork_url || '');
    const track = {
      id, title, artist, artistId: String(user.id || raw.user_id || raw.artistId || ''), artistHandle: String(user.handle || raw.artistHandle || ''),
      artwork, duration: Number(raw.duration || 0), genre: String(raw.genre || ''),
      playCount: Number(raw.play_count ?? raw.playCount ?? 0), permalink,
      isStreamable: raw.is_streamable !== false && raw.isStreamable !== false && String(raw.is_streamable ?? raw.isStreamable ?? 'true') !== 'false',
      isStreamGated: raw.is_stream_gated === true || raw.isStreamGated === true,
      parentalWarningType: String(raw.parental_warning_type || raw.parentalWarningType || '').toLowerCase(),
      description: String(raw.description || '').slice(0,1200),
      source: 'Audius'
    };
    return track;
  }
  function remember(track) {
    if (!track?.id) return;
    trackCache.set(track.id, track);
  }
  function allowed(track) {
    if (!track || !track.id || !track.isStreamable || track.isStreamGated) return false;
    if (track.parentalWarningType && !['none','clean',''].includes(track.parentalWarningType)) return false;
    return true;
  }
  async function api(path, options={}) {
    const response = await fetch(`${API}${path}`, {headers:{Accept:'application/json'}, cache:'no-store', ...options});
    const data = await response.json().catch(()=>({}));
    if (!response.ok) throw new Error(data.error || `Music service returned HTTP ${response.status}.`);
    return data;
  }
  function artwork(track, className='') {
    const source = track.artwork ? `<img src="${esc(track.artwork)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span class="afm-art-fallback">♫</span>';
    return `<div class="afm-art ${className}">${source}</div>`;
  }
  function duration(value) { return U.fmtTime(Number(value)||0); }
  function isFavorite(id) { return getFavorites().includes(String(id)); }
  function card(track, index) {
    remember(track);
    return `<article class="afm-track-card ${currentTrack?.id===track.id?'is-playing':''}">
      <button class="afm-card-play" data-action="music-play" data-id="${esc(track.id)}" aria-label="Play ${esc(track.title)}">${artwork(track)}<span class="afm-play-overlay">▶</span></button>
      <div class="afm-card-meta"><button class="afm-track-title" data-action="music-play" data-id="${esc(track.id)}">${esc(track.title)}</button><button class="afm-artist-link" data-action="music-artist" data-id="${esc(track.artistId)}" data-name="${esc(track.artist)}">${esc(track.artist)}</button></div>
      <div class="afm-card-foot"><span>${esc(track.genre || 'Track')}</span><button class="afm-icon-action ${isFavorite(track.id)?'is-active':''}" data-action="music-favorite" data-id="${esc(track.id)}" aria-label="${isFavorite(track.id)?'Remove from':'Add to'} liked songs">${isFavorite(track.id)?'♥':'♡'}</button></div>
    </article>`;
  }
  function row(track, index) {
    remember(track);
    return `<div class="afm-track-row ${currentTrack?.id===track.id?'is-playing':''}">
      <button class="afm-row-play" data-action="music-play" data-id="${esc(track.id)}" aria-label="Play ${esc(track.title)}">${currentTrack?.id===track.id&&!audio.paused?'Ⅱ':'▶'}</button>
      ${artwork(track,'afm-row-art')}
      <div class="afm-row-info"><button data-action="music-play" data-id="${esc(track.id)}">${esc(track.title)}</button><small><button data-action="music-artist" data-id="${esc(track.artistId)}" data-name="${esc(track.artist)}">${esc(track.artist)}</button></small></div>
      <span class="afm-row-genre">${esc(track.genre || '—')}</span><span class="afm-row-time">${duration(track.duration)}</span>
      <button class="afm-icon-action ${isFavorite(track.id)?'is-active':''}" data-action="music-favorite" data-id="${esc(track.id)}" aria-label="Like track">${isFavorite(track.id)?'♥':'♡'}</button>
      <button class="afm-icon-action" data-action="music-add-playlist" data-id="${esc(track.id)}" aria-label="Add to playlist">＋</button>
    </div>`;
  }
  function section(title, content, action='') {
    return `<section class="afm-section"><div class="afm-section-head"><h2>${esc(title)}</h2>${action}</div>${content}</section>`;
  }
  function grid(tracks) {
    return tracks.length ? `<div class="afm-track-grid">${tracks.map(card).join('')}</div>` : `<div class="afm-empty">No playable tracks found here yet.</div>`;
  }
  function setStatus(message, kind='') {
    const node = document.getElementById('afmStatus');
    if (node) { node.textContent = message; node.dataset.kind = kind; node.hidden = !message; }
  }
  function playlistView() {
    const lists = getPlaylists();
    return `<div class="afm-library-actions"><button data-action="music-view" data-id="browse" class="${view==='browse'?'active':''}"><span>◉</span> Discover</button><button data-action="music-view" data-id="artists" class="${view==='artists'?'active':''}"><span>◍</span> Artists</button><button data-action="music-view" data-id="library" class="${view==='library'?'active':''}"><span>▤</span> Library</button><button data-action="music-view" data-id="favorites" class="${view==='favorites'?'active':''}"><span>♥</span> Liked Songs <small>${getFavorites().length}</small></button></div>
      <div class="afm-playlist-heading"><span>YOUR PLAYLISTS</span><button data-action="music-create-playlist" title="Create playlist">＋</button></div>
      <div class="afm-playlists">${lists.map(p=>`<button class="${view==='playlist'&&currentPlaylistId===p.id?'active':''}" data-action="music-playlist" data-id="${esc(p.id)}">♫ ${esc(p.name)} <small>${(p.trackIds||[]).length}</small></button>`).join('')}</div>
      <div class="afm-provider-note"><strong>Audio-only music</strong><p>Streamable tracks from independent creators on Audius. No subscription or file importing required.</p><a href="https://audius.co/" target="_blank" rel="noopener noreferrer">Discover Audius ↗</a></div>`;
  }
  function headerTitle() {
    const list = getPlaylists();
    if (view === 'search') return 'Search results';
    if (view === 'artists') return 'Artists';
    if (view === 'library') return 'Your library';
    if (view === 'favorites') return 'Liked Songs';
    if (view === 'playlist') return list.find(p => p.id === currentPlaylistId)?.name || 'Playlist';
    if (view === 'artist') return artistMode?.name || 'Artist';
    return 'Discover music';
  }
  function refreshChrome() {
    const head = document.querySelector('.afm-music-head h2');
    if (head) head.textContent = headerTitle();
    document.querySelectorAll('.afm-library-actions button').forEach(button => {
      button.classList.toggle('active', button.dataset.id === view);
    });
    document.querySelectorAll('.afm-playlists button').forEach(button => {
      button.classList.toggle('active', view === 'playlist' && button.dataset.id === currentPlaylistId);
    });
    updatePlayer();
  }
  function lyricsPanel() {
    const lines = Array.isArray(lyrics?.lines) ? lyrics.lines : [];
    let body;
    if (!currentTrack) body = '<div class="afm-empty afm-empty-small">Play a track and its lyrics appear here.</div>';
    else if (lyricsLoading) body = '<div class="afm-loading"><span></span> Finding lyrics…</div>';
    else if (lines.length) {
      body = `<div class="afm-lyrics-scroll" id="afmLyricsScroll">${lines.map((line, index) => {
        const time = typeof line.time === 'number' ? line.time : '';
        return `<button class="afm-lyric-line" data-action="music-lyric-seek" data-time="${time}" data-index="${index}">${esc(line.text || '♪')}</button>`;
      }).join('')}</div>`;
    } else if (lyrics && lyrics.found === false) {
      body = '<div class="afm-empty afm-empty-small"><strong>No lyrics found.</strong><p>LRCLIB does not have a match for this track yet.</p><button data-action="music-lyrics-retry">Search again</button></div>';
    } else body = '<div class="afm-empty afm-empty-small">Lyrics will load with the next track.</div>';
    return `<aside class="afm-lyrics${lyricsOpen ? ' is-open' : ''}${lyricsWide ? ' is-wide' : ''}" id="afmLyrics" aria-label="Lyrics panel" aria-live="off" ${lyricsOpen ? '' : 'hidden'}>
      <header class="afm-lyrics-head">
        <div class="afm-lyrics-title"><span class="afm-kicker">${lyrics?.synced ? 'SYNCED LYRICS' : 'LYRICS'}${lyrics?.source ? ` · ${esc(lyrics.source)}` : ''}</span><h2>${esc(currentTrack?.title || 'Lyrics')}</h2><p>${esc(currentTrack?.artist || 'Nothing playing')}</p></div>
        <div class="afm-lyrics-actions"><button data-action="music-lyrics-expand" title="${lyricsWide ? 'Narrow panel' : 'Widen panel'}" aria-label="${lyricsWide ? 'Narrow panel' : 'Widen panel'}">⤢</button><button data-action="music-lyrics-close" title="Close lyrics" aria-label="Close lyrics">✕</button></div>
      </header>
      ${body}
    </aside>`;
  }
  function renderLyrics() {
    const host = document.getElementById('afmLyrics');
    if (!host) return;
    const template = document.createElement('template');
    template.innerHTML = lyricsPanel().trim();
    host.replaceWith(template.content.firstElementChild);
    syncLyrics(true);
  }
  async function loadLyrics(track, force = false) {
    if (!track?.id) return;
    if (!force && lyricsTrackId === String(track.id) && lyrics) return;
    lyricsTrackId = String(track.id);
    const token = ++lyricsToken;
    lyricsLoading = true; lyrics = null; activeLyricIndex = -1;
    renderLyrics();
    const query = new URLSearchParams({ title: track.title, artist: track.artist });
    if (track.duration) query.set('duration', String(Math.round(track.duration)));
    try {
      const response = await fetch(`${LYRICS_API}?${query}`, { headers: { Accept: 'application/json' }, cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (token !== lyricsToken) return;
      lyrics = Array.isArray(data?.lines) && data.lines.length ? data : { found: false, lines: [], source: 'LRCLIB' };
    } catch (error) {
      if (token !== lyricsToken) return;
      lyrics = { found: false, lines: [], source: 'LRCLIB', error: String(error?.message || error) };
    }
    lyricsLoading = false;
    renderLyrics();
  }
  function syncLyrics(force = false) {
    if (!lyricsOpen || !lyrics?.synced) return;
    const lines = Array.isArray(lyrics.lines) ? lyrics.lines : [];
    if (!lines.length) return;
    // 120 ms of lead so a line lights up as it is sung, not after.
    const head = (audio.currentTime || 0) * 1000 + 120;
    let index = -1;
    for (let i = 0; i < lines.length; i += 1) {
      if (typeof lines[i].time === 'number' && lines[i].time * 1000 <= head) index = i;
      else break;
    }
    if (index === activeLyricIndex && !force) return;
    activeLyricIndex = index;
    const host = document.getElementById('afmLyricsScroll');
    if (!host) return;
    host.querySelectorAll('.afm-lyric-line').forEach((node, i) => {
      node.classList.toggle('is-active', i === index);
      node.classList.toggle('is-past', i < index);
    });
    const active = host.querySelector('.afm-lyric-line.is-active');
    if (active) {
      const top = active.offsetTop - host.clientHeight / 2 + active.clientHeight / 2;
      host.scrollTo({ top: Math.max(0, top), behavior: force ? 'auto' : 'smooth' });
    }
  }
  function toggleLyrics(force) {
    lyricsOpen = typeof force === 'boolean' ? force : !lyricsOpen;
    if (lyricsOpen && currentTrack) loadLyrics(currentTrack);
    renderLyrics();
    updatePlayer();
  }
  async function openArtists() {
    view = 'artists'; artistMode = null; refreshChrome();
    const content = document.getElementById('afmContent');
    if (!content) { AF.renderRoute('music'); return; }
    if (!artistsCache.length) {
      content.innerHTML = '<div class="afm-loading"><span></span> Gathering artists…</div>';
      try {
        const data = await api('/trending?time=week&limit=50');
        artistsCache = (data.tracks || []).map(normalize).filter(allowed);
        artistsCache.forEach(remember);
      } catch (err) { setStatus(err.message, 'error'); }
    }
    content.innerHTML = `<section class="afm-collection-head"><div><span class="afm-kicker">DISCOVER</span><h2>Artists</h2><p>Creators trending on Audius this week</p></div><button data-action="music-view" data-id="browse">Discover music</button></section>${artistCards(artistsCache)}`;
    setStatus('');
  }
  function renderPage() {
    return `<div class="afm-music-app">
      <nav class="afm-music-rail" aria-label="AF Hub navigation">
        <a class="afm-rail-logo" href="#home" title="AF Hub home">AF</a>
        <button data-action="route" data-route="home" title="Home">⌂</button>
        <button data-action="route" data-route="web" title="Search and browse">▤</button>
        <button data-action="route" data-route="games" title="Games">♧</button>
        <button class="active" data-action="route" data-route="music" title="Music">♫</button>
        <button data-action="route" data-route="apps" title="Apps">▦</button>
        <span class="afm-rail-spacer"></span>
        <button data-action="route" data-route="account" title="Profile">◉</button>
        <button data-action="route" data-route="settings" title="Settings">⚙</button>
      </nav>
      <aside class="afm-library-sidebar">
        <div class="afm-lib-title"><h1>Music</h1><span>AF HUB PLAYER</span></div>
        <form class="afm-search" id="musicSearchForm"><span>⌕</span><input id="musicSearchQuery" type="search" value="${esc(searchText)}" maxlength="100" placeholder="Find your taste" autocomplete="off" aria-label="Search tracks and artists"><button type="submit" aria-label="Search">↵</button></form>
        ${playlistView()}
      </aside>
      <main class="afm-music-main">
        <header class="afm-music-head"><div><span class="afm-kicker">AF GAME HUB · MUSIC</span><h2>${esc(headerTitle())}</h2><p>Audio-only playback · Free creator catalog · Powered by Audius</p></div><div class="afm-head-actions"><button data-action="music-refresh">↻ Refresh</button><a href="https://audius.co/" target="_blank" rel="noopener noreferrer">Audius ↗</a></div></header>
        <div id="afmStatus" class="afm-status" hidden></div>
        <div id="afmContent"><div class="afm-loading"><span></span> Loading your music…</div></div>
        <footer class="afm-music-footer">Tracks are streamed from Audius. Artist names, artwork, and original track links are retained. <a href="https://audius.org/open-music-license.pdf" target="_blank" rel="noopener noreferrer">Open Music License</a>.</footer>
      </main>
      ${lyricsPanel()}
    </div>`;
  }
  function artistCards(tracks) {
    const seen = new Set();
    const artists = [];
    for (const track of tracks) {
      if (!track.artistId || seen.has(track.artistId)) continue;
      seen.add(track.artistId);
      artists.push({id:track.artistId,name:track.artist,artwork:track.artwork,handle:track.artistHandle});
      if (artists.length >= 10) break;
    }
    return artists.length ? `<div class="afm-artist-grid">${artists.map(a=>`<button class="afm-artist-card" data-action="music-artist" data-id="${esc(a.id)}" data-name="${esc(a.name)}"><span>${a.artwork?`<img src="${esc(a.artwork)}" alt="" loading="lazy">`:'♫'}</span><strong>${esc(a.name)}</strong><small>Artist</small></button>`).join('')}</div>` : '<div class="afm-empty">Artist discovery will appear as the catalog loads.</div>';
  }
  async function loadBrowse() {
    const thisReq = ++requestNo;
    const content = document.getElementById('afmContent');
    if (!content) return;
    content.innerHTML = '<div class="afm-loading"><span></span> Finding trending tracks…</div>';
    setStatus('Connecting to the free Audius music catalog…');
    try {
      const data = await api('/trending?time=week&limit=30');
      if (thisReq !== requestNo || !document.getElementById('afmContent')) return;
      const tracks = (data.tracks || []).map(normalize).filter(allowed);
      tracks.forEach(remember);
      artistsCache = tracks;
      visibleTracks = tracks;
      setStatus(tracks.length ? `${tracks.length} streamable tracks loaded.` : 'The catalog did not return playable tracks. Try refreshing.');
      content.innerHTML = `${section('Trending songs',grid(tracks.slice(0,18)))}${section('Popular artists',artistCards(tracks))}${section('Recently played',renderHistory())}`;
    } catch (err) {
      if (thisReq !== requestNo) return;
      lastError = err.message;
      setStatus(err.message,'error');
      content.innerHTML = `<div class="afm-empty"><strong>Music could not load.</strong><p>${esc(err.message)}</p><button data-action="music-refresh">Try again</button></div>`;
    }
  }
  function renderHistory() {
    const history = getHistory().slice(0,8).map(normalize).filter(Boolean);
    if (!history.length) return '<div class="afm-empty afm-empty-small">Your listening history will appear here.</div>';
    return `<div class="afm-track-list">${history.map(row).join('')}</div>`;
  }
  async function searchMusic(query) {
    searchText = String(query || '').trim().slice(0,100);
    if (searchText.length < 2) { setStatus('Enter at least two characters to search.','error'); return; }
    view = 'search'; artistMode = null; refreshChrome();
    const content = document.getElementById('afmContent');
    const form = document.getElementById('musicSearchForm');
    if (!content) { AF.renderRoute('music'); return; }
    content.innerHTML = '<div class="afm-loading"><span></span> Searching tracks and artists…</div>';
    setStatus('Searching Audius…');
    const req = ++requestNo;
    try {
      const data = await api(`/search?q=${encodeURIComponent(searchText)}&limit=30`);
      if (req !== requestNo) return;
      const tracks = (data.tracks || []).map(normalize).filter(allowed);
      tracks.forEach(remember);
      visibleTracks = tracks;
      const artists = data.artists || [];
      content.innerHTML = `${section(`Tracks matching “${searchText}”`,tracks.length?`<div class="afm-track-list">${tracks.map(row).join('')}</div>`:'<div class="afm-empty">No playable match was found in Audius. This catalog does not include every mainstream artist or release.</div>')}${artists.length?section('Artists',`<div class="afm-artist-grid">${artists.map(a=>`<button class="afm-artist-card" data-action="music-artist" data-id="${esc(a.id)}" data-name="${esc(a.name||a.handle)}"><span>${a.artwork?`<img src="${esc(a.artwork)}" alt="" loading="lazy">`:'♫'}</span><strong>${esc(a.name||a.handle)}</strong><small>Artist</small></button>`).join('')}</div>`):''}`;
      setStatus(`${tracks.length} playable tracks · ${artists.length} artists found.`);
    } catch (err) {
      if (req !== requestNo) return;
      setStatus(err.message,'error');
      content.innerHTML = `<div class="afm-empty"><strong>Search failed.</strong><p>${esc(err.message)}</p></div>`;
    }
  }
  async function openArtist(id, name) {
    if (!id) return;
    view = 'artist'; artistMode = {id,name}; refreshChrome();
    const content = document.getElementById('afmContent');
    if (!content) return;
    content.innerHTML = '<div class="afm-loading"><span></span> Loading artist…</div>';
    setStatus('');
    const req = ++requestNo;
    try {
      const data = await api(`/artist/${encodeURIComponent(id)}`);
      if (req !== requestNo) return;
      const tracks = (data.tracks || []).map(normalize).filter(allowed);
      tracks.forEach(remember); visibleTracks = tracks;
      content.innerHTML = `<section class="afm-artist-hero"><div class="afm-artist-orb">♫</div><div><span class="afm-kicker">ARTIST</span><h2>${esc(name||'Artist')}</h2><p>${tracks.length} available tracks on Audius</p><a href="https://audius.co/" target="_blank" rel="noopener noreferrer">Explore creators ↗</a></div></section>${section('Tracks',tracks.length?`<div class="afm-track-list">${tracks.map(row).join('')}</div>`:'<div class="afm-empty">No playable tracks were found for this artist.</div>')}`;
    } catch (err) { setStatus(err.message,'error'); content.innerHTML = '<div class="afm-empty">Could not load this artist right now.</div>'; }
  }
  function playlistTracks(id) {
    const saved = getSaved();
    if (id === 'favorites') return saved.filter(t => getFavorites().includes(String(t.id)));
    if (id === 'library') return saved;
    const pl = getPlaylists().find(p => p.id === id);
    return saved.filter(t => pl?.trackIds?.includes(String(t.id)));
  }
  function openCollection(type, id='') {
    view = type; currentPlaylistId = id; artistMode = null; refreshChrome();
    const content = document.getElementById('afmContent');
    if (!content) { AF.renderRoute('music'); return; }
    let tracks = [];
    if (type === 'library' || type === 'favorites') tracks = playlistTracks(type);
    if (type === 'playlist') tracks = playlistTracks(id);
    visibleTracks = tracks; tracks.forEach(remember);
    const title = type === 'favorites' ? 'Liked Songs' : type === 'library' ? 'Your library' : (getPlaylists().find(p=>p.id===id)?.name || 'Playlist');
    content.innerHTML = `<div class="afm-collection-head"><div><span class="afm-kicker">YOUR COLLECTION</span><h2>${esc(title)}</h2><p>${tracks.length} saved tracks</p></div>${type==='playlist'?`<button data-action="music-delete-playlist" data-id="${esc(id)}">Delete playlist</button>`:''}</div>${tracks.length?`<div class="afm-track-list">${tracks.map(row).join('')}</div>`:'<div class="afm-empty"><strong>This collection is empty.</strong><p>Browse music, then use the heart or plus button to save tracks here.</p><button data-action="music-view" data-id="browse">Explore music</button></div>'}`;
    setStatus('');
  }
  function addToLibrary(track) {
    if (!track?.id) return;
    const all = getSaved();
    if (!all.some(t => String(t.id) === String(track.id))) saveSaved([track,...all].slice(0,500));
    remember(track);
  }
  function toggleFavorite(id) {
    const track = trackCache.get(String(id)) || getSaved().find(t=>String(t.id)===String(id));
    if (!track) return;
    addToLibrary(track);
    const favorites = getFavorites();
    setFavorites(favorites.includes(String(id)) ? favorites.filter(x=>String(x)!==String(id)) : [...favorites,String(id)]);
    if (document.getElementById('afmContent')) {
      if (view === 'favorites') openCollection('favorites');
      else if (view === 'library' || view === 'playlist') openCollection(view,currentPlaylistId);
      else if (view === 'browse') loadBrowse();
      else if (view === 'search') searchMusic(searchText);
    }
    updatePlayer();
  }
  function createPlaylist() {
    AF.dialog(`<div class="dialog-head"><div><div class="eyebrow">YOUR COLLECTION</div><h2>Create playlist</h2></div><button class="icon-button" data-action="close-dialog">×</button></div><div class="dialog-body"><label class="field-label">Playlist name<input class="input" id="afmNewPlaylistName" maxlength="50" placeholder="Late night mix"></label><div class="dialog-actions"><button class="btn" data-action="close-dialog">Cancel</button><button class="btn btn-primary" id="afmCreatePlaylistSave">Create playlist</button></div></div>`);
    document.getElementById('afmCreatePlaylistSave')?.addEventListener('click',()=>{
      const name=document.getElementById('afmNewPlaylistName')?.value.trim();
      if(!name){AF.toast('Enter a playlist name.','error');return;}
      const item={id:U.id('playlist'),name,trackIds:[]}; setPlaylists([...getPlaylists(),item]); AF.closeDialog(); openCollection('playlist',item.id); AF.toast('Playlist created.','success');
      const pList=document.querySelector('.afm-playlists'); if(pList) pList.innerHTML=getPlaylists().map(p=>`<button data-action="music-playlist" data-id="${esc(p.id)}">♫ ${esc(p.name)} <small>${p.trackIds.length}</small></button>`).join('');
    });
  }
  function addToPlaylist(id) {
    const track=trackCache.get(String(id)) || getSaved().find(t=>String(t.id)===String(id)); if(!track)return;
    addToLibrary(track);
    const lists=getPlaylists();
    AF.dialog(`<div class="dialog-head"><div><div class="eyebrow">SAVE TRACK</div><h2>Add to playlist</h2></div><button class="icon-button" data-action="close-dialog">×</button></div><div class="dialog-body">${lists.map(p=>`<button class="web-card" data-afm-pick="${esc(p.id)}"><span class="web-card-icon">♫</span><span class="web-card-copy"><strong>${esc(p.name)}</strong><small>${p.trackIds.length} tracks</small></span><span class="web-card-arrow">＋</span></button>`).join('')}<button class="btn" id="afmNewFromPick">＋ New playlist</button></div>`);
    document.querySelectorAll('[data-afm-pick]').forEach(button=>button.addEventListener('click',()=>{
      const playlistId=button.dataset.afmPick;
      setPlaylists(getPlaylists().map(p=>p.id===playlistId?{...p,trackIds:[...new Set([...p.trackIds,String(id)])]}:p));
      AF.closeDialog(); AF.toast('Added to playlist.','success');
      const pl=getPlaylists().find(p=>p.id===playlistId); if(view==='playlist'&&currentPlaylistId===playlistId)openCollection('playlist',playlistId);
    }));
    document.getElementById('afmNewFromPick')?.addEventListener('click',()=>{AF.closeDialog();createPlaylist();});
  }
  function updatePlayer() {
    const player=document.getElementById('miniPlayer'); if(!player)return;
    if(!currentTrack){player.hidden=true;return;}
    player.hidden=false;
    const art=document.getElementById('miniArt');
    if(art){art.innerHTML=currentTrack.artwork?`<img src="${esc(currentTrack.artwork)}" alt="" referrerpolicy="no-referrer">`:'♫';}
    document.getElementById('miniTitle').textContent=currentTrack.title;
    document.getElementById('miniArtist').textContent=currentTrack.artist;
    document.getElementById('miniPlay').textContent=audio.paused?'▶':'Ⅱ';
    const fav=document.getElementById('miniFavorite'); if(fav){fav.textContent=isFavorite(currentTrack.id)?'♥':'♡';fav.classList.toggle('is-active',isFavorite(currentTrack.id));}
    const repeat=document.getElementById('miniRepeat'); if(repeat){repeat.textContent=repeatMode==='one'?'↻¹':repeatMode==='all'?'↻':'↻̸';repeat.title=`Repeat ${repeatMode}`;}
    const shuffle=document.getElementById('miniShuffle'); if(shuffle){shuffle.classList.toggle('is-active',shuffleMode);}
    const lyricsBtn=document.getElementById('miniLyrics'); if(lyricsBtn){lyricsBtn.classList.toggle('is-active',lyricsOpen);lyricsBtn.setAttribute('aria-pressed',String(lyricsOpen));}
  }
  async function playTrackById(id) {
    let track = trackCache.get(String(id)) || getSaved().find(t=>String(t.id)===String(id));
    if (!track) return;
    if (!allowed(track)) { AF.toast('This track is not available for open playback.','error'); return; }
    if (visibleTracks.length) {
      const idx=visibleTracks.findIndex(t=>String(t.id)===String(id));
      queue=visibleTracks.slice(); queueIndex=idx>=0?idx:0;
    } else { queue=[track]; queueIndex=0; }
    currentTrack=track; addToLibrary(track);
    AFStore.set('lastMusicTrack',track);
    const history=getHistory().filter(t=>String(t.id)!==String(track.id));
    AFStore.set('musicHistory',[track,...history].slice(0,30));
    audio.pause();
    audio.src=`${API}/stream/${encodeURIComponent(track.id)}`;
    audio.load(); updatePlayer();
    if (lyricsOpen) loadLyrics(track);
    try { await audio.play(); updatePlayer(); }
    catch (error) { AF.toast('Playback could not start. Press play again or choose another track.','error'); }
    document.querySelectorAll('.afm-track-row,.afm-track-card').forEach(el=>el.classList.toggle('is-playing',!!el.querySelector(`[data-id="${CSS.escape(String(track.id))}"]`)));
  }
  function nextTrack(direction=1) {
    if (!queue.length) return;
    if (shuffleMode && queue.length>1) {
      let next=queueIndex; while(next===queueIndex) next=Math.floor(Math.random()*queue.length); queueIndex=next;
    } else queueIndex=(queueIndex+direction+queue.length)%queue.length;
    const next=queue[queueIndex]; if(next)playTrackById(next.id);
  }
  function timeUpdate() {
    const seek=document.getElementById('miniSeek');
    const elapsed=document.getElementById('miniElapsed');
    const total=document.getElementById('miniDuration');
    if(seek && audio.duration) seek.value=String(Math.round(audio.currentTime/audio.duration*1000));
    if(elapsed) elapsed.textContent=U.fmtTime(audio.currentTime||0);
    if(total) total.textContent=U.fmtTime(audio.duration||currentTrack?.duration||0);
    syncLyrics();
  }
  function renderInfo() {
    if(!currentTrack)return;
    AF.dialog(`<div class="dialog-head"><div><div class="eyebrow">NOW PLAYING</div><h2>${esc(currentTrack.title)}</h2></div><button class="icon-button" data-action="close-dialog">×</button></div><div class="dialog-body"><div class="afm-info-row">${artwork(currentTrack,'afm-info-art')}<div><strong>${esc(currentTrack.artist)}</strong><small>${esc(currentTrack.genre||'Audius track')}</small></div></div><p>${esc(currentTrack.description||'This creator has not added a track description.')}</p><p class="section-sub">Audio streamed directly from Audius. Creator and original track information remain available.</p><a class="btn btn-primary" href="${esc(currentTrack.permalink)}" target="_blank" rel="noopener noreferrer">Open original track ↗</a></div>`);
  }
  function onAction(action,id,el) {
    if(action==='music-view') { view=id||'browse'; refreshChrome(); if(view==='search') { searchText=document.getElementById('musicSearchQuery')?.value||searchText; searchMusic(searchText); } else if(view==='browse') loadBrowse(); else if(view==='artists') openArtists(); else openCollection(view); return; }
    if(action==='music-playlist') { openCollection('playlist',id); return; }
    if(action==='music-play') { playTrackById(id); return; }
    if(action==='music-favorite') { toggleFavorite(id); return; }
    if(action==='music-artist') { openArtist(id,el?.dataset.name||'Artist'); return; }
    if(action==='music-create-playlist') { createPlaylist(); return; }
    if(action==='music-add-playlist') { addToPlaylist(id); return; }
    if(action==='music-delete-playlist') { setPlaylists(getPlaylists().filter(p=>p.id!==id)); openCollection('library'); AF.renderRoute('music'); AF.toast('Playlist deleted.'); return; }
    if(action==='music-refresh') { if(view==='browse')loadBrowse(); else if(view==='search')searchMusic(searchText); else if(view==='artist'&&artistMode)openArtist(artistMode.id,artistMode.name); else openCollection(view,currentPlaylistId); return; }
    if(action==='music-prev') { nextTrack(-1); return; }
    if(action==='music-next') { nextTrack(1); return; }
    if(action==='music-toggle') { if(!currentTrack)return; if(audio.paused)audio.play().catch(()=>AF.toast('Press play again to start audio.','error')); else audio.pause(); return; }
    if(action==='music-repeat') { repeatMode=repeatMode==='off'?'all':repeatMode==='all'?'one':'off'; updatePlayer(); return; }
    if(action==='music-shuffle') { shuffleMode=!shuffleMode; updatePlayer(); return; }
    if(action==='music-favorite-current') { if(currentTrack)toggleFavorite(currentTrack.id); return; }
    if(action==='music-info-current') { renderInfo(); return; }
    if(action==='music-lyrics') {
      if(document.getElementById('afmLyrics')) toggleLyrics();
      else if(currentTrack) { lyricsOpen=true; AF.navigate('music'); }
      return;
    }
    if(action==='music-lyrics-close') { toggleLyrics(false); return; }
    if(action==='music-lyrics-expand') { lyricsWide=!lyricsWide; renderLyrics(); return; }
    if(action==='music-lyrics-retry') { if(currentTrack) loadLyrics(currentTrack,true); return; }
    if(action==='music-lyric-seek') {
      const stamp=el?.dataset.time;
      if(stamp!==undefined&&stamp!=='') { const seconds=Number(stamp); if(Number.isFinite(seconds)) audio.currentTime=seconds; }
      return;
    }
    if(action==='music-open-music') { AF.navigate('music'); return; }
    if(action==='music-stop') { audio.pause(); audio.removeAttribute('src'); audio.load(); currentTrack=null; updatePlayer(); return; }
  }
  function bindPage() {
    const form=document.getElementById('musicSearchForm');
    form?.addEventListener('submit',e=>{e.preventDefault();searchMusic(document.getElementById('musicSearchQuery')?.value||'');});
    const query=document.getElementById('musicSearchQuery');
    query?.addEventListener('keydown',e=>{if(e.key==='Escape'){query.value='';searchText='';view='browse';refreshChrome();loadBrowse();}});
    if(view==='browse')loadBrowse();
    else if(view==='artists')openArtists();
    else if(view==='search')searchMusic(searchText);
    else if(view==='artist'&&artistMode)openArtist(artistMode.id,artistMode.name);
    else if(['library','favorites','playlist'].includes(view))openCollection(view,currentPlaylistId);
    if(lyricsOpen&&currentTrack)loadLyrics(currentTrack);
    updatePlayer();
  }
  function bindGlobal() {
    audio.addEventListener('timeupdate',timeUpdate);
    audio.addEventListener('loadedmetadata',timeUpdate);
    audio.addEventListener('play',updatePlayer);
    audio.addEventListener('pause',updatePlayer);
    audio.addEventListener('ended',()=>{
      if(repeatMode==='one'){audio.currentTime=0;audio.play().catch(()=>{});return;}
      if(queueIndex<queue.length-1)nextTrack(1);
      else if(repeatMode==='all'&&queue.length) {queueIndex=-1;nextTrack(1);}
      else {updatePlayer();}
    });
    audio.addEventListener('error',()=>{if(currentTrack)AF.toast('This track could not be streamed. Try another result.','error');});
    document.getElementById('miniSeek')?.addEventListener('input',e=>{if(audio.duration)audio.currentTime=(Number(e.target.value)/1000)*audio.duration;});
    document.getElementById('miniVolume')?.addEventListener('input',e=>{audio.volume=Number(e.target.value)/100;AFStore.set('musicVolume',audio.volume);});
    audio.volume=Number(AFStore.get('musicVolume',0.8));
    const volume=document.getElementById('miniVolume'); if(volume)volume.value=String(audio.volume*100);
    const last=AFStore.get('lastMusicTrack',null);
    if(last&&typeof last==='object'&&last.id){currentTrack=normalize(last);remember(currentTrack);updatePlayer();}
  }
  bindGlobal();
  window.AFMusic={renderPage,bindPage,onAction,playTrack:playTrackById,search:searchMusic};
})();
