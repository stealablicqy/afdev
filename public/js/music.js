(() => {
  'use strict';
  const U = window.AFUtil;
  const audio = document.getElementById('audioEngine');
  // The hub is served straight from the CDN, so there is no server to proxy
  // through. Every provider below is called directly and sends ACAO: *.
  const AUDIUS = 'https://api.audius.co/v1';
  const ITUNES = 'https://itunes.apple.com';
  const APP_NAME = 'AFGameHub';
  // Piped mirrors are the catalogue: their search endpoint is CORS-open and
  // returns YouTube video ids plus real durations, which the hidden IFrame
  // player below turns into full-length playback. Order matters — the first
  // mirror that answers wins and is cached for the session.
  const PIPED_APIS = [
    'https://api.piped.private.coffee',
    'https://pipedapi.leptons.xyz',
    'https://pipedapi.reallyaweso.me',
    'https://pipedapi.adminforge.de',
    'https://pipedapi.kavin.rocks',
    'https://piped-api.privacy.com.de',
    'https://pipedapi.darkness.services',
    'https://pipedapi.nosebs.ru'
  ];
  let pipedBase = '';
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
  const LYRICS_API = 'https://lrclib.net/api';
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

  function audiusStream(id) {
    return `${AUDIUS}/tracks/${encodeURIComponent(id)}/stream?app_name=${APP_NAME}`;
  }

  function normalize(raw) {
    const user = raw.user || raw.user_data || {};
    const art = raw.artwork || raw.cover_art || {};
    const id = String(raw.id ?? raw.track_id ?? '');
    const title = String(raw.title || 'Untitled track').slice(0,180);
    const artist = String(raw.artist || raw.artist_name || user.name || user.handle || 'Unknown artist').slice(0,120);
    const permalink = raw.permalink || raw.url || (raw.slug ? `https://audius.co/${raw.slug}` : 'https://audius.co/');
    const artwork = typeof art === 'string' ? art : (art._480x480 || art._1000x1000 || art._150x150 || raw.artwork_url || '');
    const isItunes = id.startsWith('itunes:');
    const track = {
      id, title, artist, artistId: String(user.id || raw.user_id || raw.artistId || ''), artistHandle: String(user.handle || raw.artistHandle || ''),
      artwork, duration: Number(raw.duration || 0), genre: String(raw.genre || ''),
      playCount: Number(raw.play_count ?? raw.playCount ?? 0), permalink,
      stream: raw.stream || (isItunes ? '' : audiusStream(id)),
      isStreamable: raw.is_streamable !== false && raw.isStreamable !== false && String(raw.is_streamable ?? raw.isStreamable ?? 'true') !== 'false',
      isStreamGated: raw.is_stream_gated === true || raw.isStreamGated === true,
      parentalWarningType: String(raw.parental_warning_type || raw.parentalWarningType || '').toLowerCase(),
      description: String(raw.description || '').slice(0,1200),
      source: raw.source || (isItunes ? 'Preview clip' : 'Audius')
    };
    return track;
  }
  // Apple's Search API covers the mainstream catalog that Audius does not:
  // full studio releases with a 30 second preview. `itunes:` keeps the two
  // namespaces apart in storage and in the queue.
  function normalizeItunes(raw) {
    if (!raw || raw.wrapperType !== 'track' || raw.kind !== 'song') return null;
    const preview = String(raw.previewUrl || '');
    if (!preview) return null;
    const art = String(raw.artworkUrl100 || raw.artworkUrl60 || '');
    return {
      id: `itunes:${raw.trackId}`,
      title: String(raw.trackName || 'Untitled track').slice(0, 180),
      artist: String(raw.artistName || 'Unknown artist').slice(0, 120),
      artistId: `itunes:${raw.artistId || ''}`,
      artistHandle: '',
      artwork: art ? art.replace(/\/\d+x\d+bb\.(jpg|png)$/i, '/600x600bb.$1') : '',
      duration: Math.max(0, Math.round(Number(raw.trackTimeMillis || 0) / 1000)),
      genre: String(raw.primaryGenreName || 'Song'),
      playCount: 0,
      permalink: String(raw.trackViewUrl || 'https://music.apple.com/'),
      stream: preview,
      isStreamable: true,
      isStreamGated: false,
      parentalWarningType: String(raw.trackExplicitness === 'explicit' ? 'explicit' : 'none'),
      description: `${raw.collectionName ? `${raw.collectionName}. ` : ''}30 second Preview clip. Full track opens in Apple Music.`,
      source: 'Preview clip'
    };
  }
  function pipedBases() {
    let cached = '';
    try { cached = localStorage.getItem('af.music.piped') || ''; } catch {}
    const list = PIPED_APIS.slice();
    const first = cached || pipedBase;
    if (first && list.includes(first)) {
      return [first, ...list.filter(base => base !== first)];
    }
    return list;
  }

  function parseDurationLabel(value) {
    if (typeof value === 'number') return value;
    const text = String(value || '');
    const parts = text.split(':').map(Number);
    if (parts.some(n => !Number.isFinite(n))) return 0;
    return parts.reduce((total, n) => total * 60 + n, 0);
  }

  // Piped search rows are flat objects, not Audius payloads. The video id lives
  // in `url` as /watch?v=…; `yt:` keeps that namespace separate from Audius ids
  // in storage, favourites and the queue.
  function normalizePiped(raw) {
    if (!raw || raw.type !== 'stream') return null;
    const url = String(raw.url || '');
    const videoId = (url.match(/[?&]v=([A-Za-z0-9_-]{11})/) || [])[1]
      || (String(raw.id || '').match(/([A-Za-z0-9_-]{11})$/) || [])[1]
      || '';
    if (!videoId) return null;
    const title = String(raw.title || 'Untitled track').slice(0, 180);
    if (!title || /^\[?(deleted|private) video\]?$/i.test(title)) return null;
    const uploader = String(raw.uploaderName || raw.uploader || 'YouTube').replace(/\s*-\s*Topic$/i, '').trim();
    const art = String(raw.thumbnail || '');
    return {
      id: `yt:${videoId}`,
      title,
      artist: uploader || 'YouTube',
      artistId: `yt:${uploader}`,
      artistHandle: '',
      artwork: art.startsWith('http') ? art : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      duration: parseDurationLabel(raw.duration),
      genre: String(raw.category || 'Song'),
      playCount: Number(raw.views || 0),
      permalink: `https://www.youtube.com/watch?v=${videoId}`,
      stream: `yt:${videoId}`,
      isStreamable: true,
      isStreamGated: false,
      parentalWarningType: '',
      description: 'Full length audio, played through the embedded YouTube player.',
      source: 'YouTube'
    };
  }

  async function pipedSearch(query, limit = 25) {
    const term = String(query || '').trim();
    if (!term) return [];
    for (const base of pipedBases()) {
      try {
        const data = await fetchJson(`${base}/search?q=${encodeURIComponent(term)}&filter=music_songs`);
        const rows = Array.isArray(data?.items) ? data.items : [];
        const tracks = rows.map(normalizePiped).filter(Boolean);
        if (tracks.length) {
          pipedBase = base;
          try { localStorage.setItem('af.music.piped', base); } catch {}
          return tracks.slice(0, limit);
        }
      } catch {
        // Dead mirror — fall through to the next one.
      }
    }
    return [];
  }

  function remember(track) {
    if (!track?.id) return;
    trackCache.set(track.id, track);
  }
  function allowed(track) {
    // Nothing is filtered any more: every result plays. Explicit tracks,
    // gated Audius uploads and YouTube rows all stream at full length.
    return !!(track && track.id);
  }
  async function fetchJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store', signal: controller.signal });
      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : {}; } catch { throw new Error('The music service returned an unreadable response.'); }
      if (!response.ok) throw new Error(data?.error || `Music service returned HTTP ${response.status}.`);
      return data;
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('The music service took too long to answer.');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  async function audiusSearch(query, limit = 30) {
    const data = await fetchJson(`${AUDIUS}/tracks/search?query=${encodeURIComponent(query)}&limit=${limit}&app_name=${APP_NAME}`);
    return (data.data || []).map(normalize).filter(allowed);
  }
  async function audiusTrending(limit = 40) {
    const data = await fetchJson(`${AUDIUS}/tracks/trending?time=week&limit=${limit}&app_name=${APP_NAME}`);
    return (data.data || []).map(normalize).filter(allowed);
  }
  async function itunesSearch(query, limit = 25) {
    const data = await fetchJson(`${ITUNES}/search?term=${encodeURIComponent(query)}&media=music&entity=song&limit=${limit}&country=US`);
    return (data.results || []).map(normalizeItunes).filter(Boolean);
  }
  // Rotating seed list so the "popular" shelf changes day to day instead of
  // hammering the same six artists forever.
  const POPULAR_ARTISTS = ['Drake','Taylor Swift','The Weeknd','SZA','Kendrick Lamar','Bad Bunny','Billie Eilish','Post Malone','Ariana Grande','Travis Scott','Doja Cat','Tyler, The Creator','Olivia Rodrigo','Future','21 Savage','Sabrina Carpenter','Metro Boomin','Rihanna','Kanye West','Playboi Carti','Don Toliver','Lil Baby','Brent Faiyaz','Frank Ocean'];
  function popularSeeds(count = 6) {
    const day = Math.floor(Date.now() / 86400000);
    const seeds = [];
    for (let i = 0; i < count; i += 1) seeds.push(POPULAR_ARTISTS[(day * count + i) % POPULAR_ARTISTS.length]);
    return seeds;
  }
  function dedupe(tracks) {
    const seen = new Set();
    return tracks.filter(track => {
      if (!track?.id) return false;
      const key = `${String(track.title).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}|${String(track.artist).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  async function popularTracks() {
    const seeds = popularSeeds(6);
    const batches = await Promise.allSettled(seeds.map(name => pipedSearch(name, 8)));
    const merged = [];
    for (const batch of batches) if (batch.status === 'fulfilled') merged.push(...batch.value);
    return dedupe(merged);
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
      <div class="afm-provider-note"><strong>Music that actually plays</strong><p>Full tracks stream from independent creators on Audius. Mainstream releases play as 30 second Preview clips, so the whole catalog is searchable without a subscription.</p><a href="https://music.apple.com/" target="_blank" rel="noopener noreferrer">Browse Apple Music ↗</a></div>`;
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
  function cleanTitle(value) {
    return String(value || '')
      .replace(/\((?:feat|ft|with)\.?[^)]*\)/gi, '')
      .replace(/\[(?:feat|ft|with)\.?[^\]]*\]/gi, '')
      .replace(/\s*-\s*(?:remaster(?:ed)?|deluxe|explicit|radio edit|single version)\b.*$/i, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }
  function parseLrc(value) {
    const lines = [];
    const stamp = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
    for (const rawLine of String(value || '').split(/\r?\n/)) {
      const text = rawLine.replace(/\[[^\]]*\]/g, '').trim();
      if (!text) continue;
      let match;
      stamp.lastIndex = 0;
      let placed = false;
      while ((match = stamp.exec(rawLine))) {
        const minutes = Number(match[1]);
        const seconds = Number(match[2]);
        const fraction = match[3] ? Number(`0.${match[3]}`) : 0;
        lines.push({ time: minutes * 60 + seconds + fraction, text });
        placed = true;
      }
      if (!placed) lines.push({ time: null, text });
    }
    const timed = lines.filter(line => typeof line.time === 'number');
    if (timed.length < 4) return { synced: false, lines: lines.map(({ text }) => ({ time: null, text })) };
    return { synced: true, lines: timed.sort((a, b) => a.time - b.time) };
  }
  function lyricsPayload(record) {
    if (!record) return { found: false, synced: false, lines: [], source: 'LRCLIB' };
    if (record.instrumental) return { found: true, synced: false, lines: [{ time: null, text: 'Instrumental track.' }], source: 'LRCLIB' };
    if (record.syncedLyrics) {
      const parsed = parseLrc(record.syncedLyrics);
      if (parsed.lines.length) return { found: true, synced: parsed.synced, lines: parsed.lines, source: 'LRCLIB' };
    }
    if (record.plainLyrics) {
      const lines = String(record.plainLyrics).split(/\r?\n/).map(text => ({ time: null, text: text.trim() })).filter(line => line.text);
      if (lines.length) return { found: true, synced: false, lines, source: 'LRCLIB' };
    }
    return { found: false, synced: false, lines: [], source: 'LRCLIB' };
  }
  function scoreRecord(record, title, artist) {
    const name = cleanTitle(record.trackName || record.name || '').toLowerCase();
    const who = String(record.artistName || '').toLowerCase();
    let score = 0;
    if (name === title.toLowerCase()) score += 3;
    else if (name.includes(title.toLowerCase()) || title.toLowerCase().includes(name)) score += 1;
    if (who.includes(artist.toLowerCase()) || artist.toLowerCase().includes(who)) score += 2;
    if (record.syncedLyrics) score += 2;
    return score;
  }
  async function loadLyrics(track, force = false) {
    if (!track?.id) return;
    if (!force && lyricsTrackId === String(track.id) && lyrics) return;
    lyricsTrackId = String(track.id);
    const token = ++lyricsToken;
    lyricsLoading = true; lyrics = null; activeLyricIndex = -1;
    renderLyrics();
    const title = cleanTitle(track.title);
    const artist = String(track.artist || '').split(/\s*(?:,|&|feat\.?|ft\.?|with)\s*/i)[0].trim() || track.artist;
    const params = new URLSearchParams({ track_name: title, artist_name: artist });
    if (track.duration) params.set('duration', String(Math.round(track.duration)));
    let record = null;
    try {
      try {
        record = await fetchJson(`${LYRICS_API}/get?${params}`);
      } catch {
        record = null;
      }
      if (!record) {
        const list = await fetchJson(`${LYRICS_API}/search?${params}`);
        const rows = Array.isArray(list) ? list : [];
        rows.sort((a, b) => scoreRecord(b, title, artist) - scoreRecord(a, title, artist));
        record = rows.find(row => scoreRecord(row, title, artist) > 0) || null;
      }
      if (token !== lyricsToken) return;
      lyrics = lyricsPayload(record);
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
    const head = engineTime() * 1000 + 120;
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
        const [audius, popular] = await Promise.allSettled([audiusTrending(60), popularTracks()]);
        const pool = [];
        if (audius.status === 'fulfilled') pool.push(...audius.value);
        if (popular.status === 'fulfilled') pool.push(...popular.value);
        artistsCache = dedupe(pool);
        artistsCache.forEach(remember);
      } catch (err) { setStatus(err.message, 'error'); }
    }
    content.innerHTML = `<section class="afm-collection-head"><div><span class="afm-kicker">DISCOVER</span><h2>Artists</h2><p>Mainstream releases from Apple Music and creators trending on Audius</p></div><button data-action="music-view" data-id="browse">Discover music</button></section>${artistCards(artistsCache)}`;
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
        <header class="afm-music-head"><div><span class="afm-kicker">AF GAME HUB · MUSIC</span><h2>${esc(headerTitle())}</h2><p>Full tracks · Mainstream catalogue plus independent creator streams · Lyrics from LRCLIB</p></div><div class="afm-head-actions"><button data-action="music-refresh">↻ Refresh</button><a href="https://music.youtube.com/" target="_blank" rel="noopener noreferrer">YouTube Music ↗</a></div></header>
        <div id="afmStatus" class="afm-status" hidden></div>
        <div id="afmContent"><div class="afm-loading"><span></span> Loading your music…</div></div>
        <footer class="afm-music-footer">Mainstream tracks play full length through the embedded YouTube engine. Independent tracks stream directly from Audius, with artist names, artwork, and original links retained. <a href="https://audius.org/open-music-license.pdf" target="_blank" rel="noopener noreferrer">Audius Open Music License</a>.</footer>
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
    setStatus('Loading the full-length catalogue…');
    try {
      const [popular, trending] = await Promise.allSettled([popularTracks(), audiusTrending(30)]);
      if (thisReq !== requestNo || !document.getElementById('afmContent')) return;
      const mainstream = popular.status === 'fulfilled' ? popular.value : [];
      const indie = trending.status === 'fulfilled' ? trending.value : [];
      if (popular.status === 'rejected' && trending.status === 'rejected') {
        throw new Error(popular.reason?.message || trending.reason?.message || 'The music services did not answer.');
      }
      const tracks = dedupe([...mainstream, ...indie]);
      tracks.forEach(remember);
      artistsCache = dedupe([...mainstream, ...indie]);
      visibleTracks = tracks;
      setStatus(tracks.length ? `${tracks.length} full tracks loaded.` : 'The catalogue did not return tracks. Try refreshing.');
      content.innerHTML = `${section('Popular right now',grid(mainstream.slice(0,18)))}${section('Trending on Audius',grid(indie.slice(0,12)))}${section('Popular artists',artistCards(artistsCache))}${section('Recently played',renderHistory())}`;
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
    content.innerHTML = '<div class="afm-loading"><span></span> Searching the catalogue…</div>';
    setStatus('Searching full-length tracks…');
    const req = ++requestNo;
    try {
      const [main, audius] = await Promise.allSettled([pipedSearch(searchText, 30), audiusSearch(searchText, 20)]);
      if (req !== requestNo) return;
      const mainstream = main.status === 'fulfilled' ? main.value : [];
      const indie = audius.status === 'fulfilled' ? audius.value : [];
      const tracks = dedupe([...mainstream, ...indie]);
      tracks.forEach(remember);
      visibleTracks = tracks;
      content.innerHTML = `${section(`Tracks matching “${searchText}”`,tracks.length?`<div class="afm-track-list">${tracks.map(row).join('')}</div>`:`<div class="afm-empty">No match for “${esc(searchText)}”. Try the artist name on its own.</div>`)}${section('Artists',artistCards(tracks))}`;
      setStatus(`${tracks.length} full tracks · ${mainstream.length} catalogue · ${indie.length} Audius.`);
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
      let tracks = [];
      if (String(id).startsWith('yt:')) {
        tracks = await pipedSearch(String(id).slice(3) || name || '', 40);
        tracks = tracks.filter(track => track.artistId === String(id));
      } else if (String(id).startsWith('itunes:')) {
        const data = await fetchJson(`${ITUNES}/lookup?id=${encodeURIComponent(String(id).slice(7))}&entity=song&limit=50&country=US`);
        tracks = (data.results || []).map(normalizeItunes).filter(Boolean);
      } else {
        try {
          const data = await fetchJson(`${AUDIUS}/users/${encodeURIComponent(id)}/tracks?limit=50&app_name=${APP_NAME}`);
          tracks = (data.data || []).map(normalize).filter(allowed);
        } catch {
          const fallback = await audiusSearch(name || id, 30);
          tracks = fallback.filter(track => String(track.artistId) === String(id));
        }
      }
      if (req !== requestNo) return;
      tracks = dedupe(tracks);
      tracks.forEach(remember); visibleTracks = tracks;
      const provider = String(id).startsWith('yt:') ? 'YouTube' : String(id).startsWith('itunes:') ? 'Apple Music' : 'Audius';
      content.innerHTML = `<section class="afm-artist-hero"><div class="afm-artist-orb">${tracks[0]?.artwork?`<img src="${esc(tracks[0].artwork)}" alt="" referrerpolicy="no-referrer">`:'♫'}</div><div><span class="afm-kicker">ARTIST</span><h2>${esc(name||'Artist')}</h2><p>${tracks.length} playable tracks on ${provider}</p><a href="${String(id).startsWith('itunes:')?'https://music.apple.com/':'https://audius.co/'}" target="_blank" rel="noopener noreferrer">Open on ${provider} ↗</a></div></section>${section('Tracks',tracks.length?`<div class="afm-track-list">${tracks.map(row).join('')}</div>`:'<div class="afm-empty">No playable tracks were found for this artist.</div>')}`;
      setStatus(`${tracks.length} tracks loaded.`);
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
  /* ---- YouTube engine ---------------------------------------------------
     Mainstream rows carry a `yt:<videoId>` id. They play through a hidden
     IFrame using YouTube's postMessage API: no API script, no key, and the
     frame is parked off-screen so the UI never has to host it. */
  let ytFrame = null;
  let ytHost = null;
  let ytPlayerId = '';
  let ytVideoId = '';
  let ytState = -1;
  let ytTime = 0;
  let ytDuration = 0;
  let ytVolume = 80;

  function ytActive() {
    return !!(currentTrack && String(currentTrack.id).startsWith('yt:') && ytFrame);
  }

  function ensureYT() {
    if (ytFrame && document.body.contains(ytFrame)) return ytFrame;
    ytHost = document.createElement('div');
    ytHost.id = 'afYtHost';
    ytHost.setAttribute('aria-hidden', 'true');
    ytHost.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
    ytFrame = document.createElement('iframe');
    ytFrame.id = 'afYtFrame';
    ytFrame.title = 'Audio engine';
    ytFrame.allow = 'autoplay; encrypted-media; picture-in-picture';
    ytFrame.setAttribute('referrerpolicy', 'no-referrer');
    ytHost.appendChild(ytFrame);
    document.body.appendChild(ytHost);
    ytPlayerId = 'afyt' + Math.random().toString(36).slice(2, 8);
    return ytFrame;
  }

  function ytPost(payload) {
    try { ytFrame?.contentWindow?.postMessage(JSON.stringify(payload), '*'); } catch {}
  }
  function ytCommand(func, args = []) {
    ytPost({ event: 'command', func, args, id: ytPlayerId, channel: 'widget' });
  }
  function ytHandshake() {
    ytPost({ event: 'listening', id: ytPlayerId, channel: 'widget' });
  }

  function ytLoad(videoId) {
    ensureYT();
    ytVideoId = videoId;
    ytState = -1;
    ytTime = 0;
    ytDuration = 0;
    const origin = encodeURIComponent(location.origin || 'https://localhost');
    ytFrame.src = `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&enablejsapi=1&playsinline=1&rel=0&origin=${origin}`;
    // The frame drops its first listening event while it warms up, so the
    // handshake repeats for a few seconds instead of once.
    let tries = 0;
    const beat = setInterval(() => {
      ytHandshake();
      ytCommand('setVolume', [ytVolume]);
      tries += 1;
      if (tries > 24) clearInterval(beat);
    }, 250);
    setTimeout(() => ytCommand('playVideo'), 900);
    setTimeout(() => ytCommand('playVideo'), 2400);
  }

  function applyYtState(state) {
    if (!Number.isFinite(state)) return;
    ytState = state;
    document.body.classList.toggle('music-playing', state === 1);
    if (state === 0) {
      if (repeatMode === 'one') { ytCommand('seekTo', [0, true]); ytCommand('playVideo'); return; }
      nextTrack(1);
      return;
    }
    if (state === 1 || state === 2 || state === 5) updatePlayer();
  }

  window.addEventListener('message', (event) => {
    if (!ytFrame) return;
    const raw = typeof event.data === 'string' ? event.data : '';
    if (!raw || (raw.indexOf('infoDelivery') === -1 && raw.indexOf('onReady') === -1 && raw.indexOf('onStateChange') === -1)) return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || !msg.event) return;
    if (msg.event === 'onReady') {
      ytHandshake();
      ytCommand('setVolume', [ytVolume]);
      return;
    }
    if (msg.event === 'onStateChange') {
      applyYtState(Number(msg.info));
      return;
    }
    if (msg.event === 'infoDelivery' && msg.info) {
      if (typeof msg.info.currentTime === 'number') ytTime = msg.info.currentTime;
      if (typeof msg.info.duration === 'number' && msg.info.duration) ytDuration = msg.info.duration;
      if (typeof msg.info.playerState === 'number') applyYtState(msg.info.playerState);
      if (ytActive()) paintTime();
    }
  });

  function engineTime() {
    return ytActive() ? ytTime : (audio.currentTime || 0);
  }
  function engineDuration() {
    return ytActive() ? (ytDuration || currentTrack?.duration || 0) : (audio.duration || currentTrack?.duration || 0);
  }
  function enginePlaying() {
    return ytActive() ? ytState === 1 || ytState === 3 : !audio.paused;
  }
  function paintTime() {
    const seek = document.getElementById('miniSeek');
    const elapsed = document.getElementById('miniElapsed');
    const total = document.getElementById('miniDuration');
    const t = engineTime();
    const d = engineDuration();
    if (seek && d) seek.value = String(Math.round(t / d * 1000));
    if (elapsed) elapsed.textContent = U.fmtTime(t);
    if (total) total.textContent = U.fmtTime(d);
  }

  function updatePlayer() {
    const player=document.getElementById('miniPlayer'); if(!player)return;
    if(!currentTrack){player.hidden=true;return;}
    player.hidden=false;
    const art=document.getElementById('miniArt');
    if(art){art.innerHTML=currentTrack.artwork?`<img src="${esc(currentTrack.artwork)}" alt="" referrerpolicy="no-referrer">`:'♫';}
    document.getElementById('miniTitle').textContent=currentTrack.title;
    document.getElementById('miniArtist').textContent=currentTrack.artist;
    document.getElementById('miniPlay').textContent=enginePlaying()?'Ⅱ':'▶';
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
    audio.removeAttribute('src');
    audio.load();
    if (String(track.id).startsWith('yt:')) {
      ytLoad(String(track.id).slice(3));
      document.body.classList.add('music-playing');
      updatePlayer();
    } else {
      if (ytFrame) ytCommand('pauseVideo');
      audio.src=track.stream;
      audio.load(); updatePlayer();
      try { await audio.play(); updatePlayer(); }
      catch (error) { AF.toast('Playback could not start. Press play again or choose another track.','error'); }
    }
    if (lyricsOpen) loadLyrics(track);
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
    paintTime();
    syncLyrics();
  }
  function renderInfo() {
    if(!currentTrack)return;
    AF.dialog(`<div class="dialog-head"><div><div class="eyebrow">NOW PLAYING</div><h2>${esc(currentTrack.title)}</h2></div><button class="icon-button" data-action="close-dialog">×</button></div><div class="dialog-body"><div class="afm-info-row">${artwork(currentTrack,'afm-info-art')}<div><strong>${esc(currentTrack.artist)}</strong><small>${esc(currentTrack.genre||currentTrack.source||'Track')}</small></div></div><p>${esc(currentTrack.description||'This creator has not added a track description.')}</p><p class="section-sub">${esc(currentTrack.source||'Audius')}. Creator and original track information remain available.</p><a class="btn btn-primary" href="${esc(currentTrack.permalink)}" target="_blank" rel="noopener noreferrer">Open original track ↗</a></div>`);
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
    if(action==='music-toggle') {
      if(!currentTrack)return;
      if(ytActive()){
        if(ytState===1){ ytCommand('pauseVideo'); applyYtState(2); }
        else { ytCommand('playVideo'); applyYtState(1); }
        updatePlayer(); return;
      }
      if(audio.paused)audio.play().catch(()=>AF.toast('Press play again to start audio.','error')); else audio.pause(); return;
    }
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
      if(stamp!==undefined&&stamp!=='') {
        const seconds=Number(stamp);
        if(Number.isFinite(seconds)) {
          if(ytActive()){ ytTime=seconds; ytCommand('seekTo',[seconds,true]); paintTime(); }
          else audio.currentTime=seconds;
        }
      }
      return;
    }
    if(action==='music-open-music') { AF.navigate('music'); return; }
    if(action==='music-stop') { audio.pause(); audio.removeAttribute('src'); audio.load(); if(ytFrame)ytCommand('pauseVideo'); ytState=-1; document.body.classList.remove('music-playing'); currentTrack=null; updatePlayer(); return; }
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
    audio.addEventListener('play',()=>{if(!ytActive())document.body.classList.add('music-playing');updatePlayer();});
    audio.addEventListener('pause',()=>{if(!ytActive())document.body.classList.remove('music-playing');updatePlayer();});
    audio.addEventListener('ended',()=>{
      if(repeatMode==='one'){audio.currentTime=0;audio.play().catch(()=>{});return;}
      if(queueIndex<queue.length-1)nextTrack(1);
      else if(repeatMode==='all'&&queue.length) {queueIndex=-1;nextTrack(1);}
      else {updatePlayer();}
    });
    audio.addEventListener('error',()=>{if(currentTrack)AF.toast('This track could not be streamed. Try another result.','error');});
    document.getElementById('miniSeek')?.addEventListener('input',e=>{
      const ratio=Number(e.target.value)/1000;
      if(ytActive()){ const seconds=ratio*(ytDuration||currentTrack?.duration||0); ytTime=seconds; ytCommand('seekTo',[seconds,true]); paintTime(); return; }
      if(audio.duration)audio.currentTime=ratio*audio.duration;
    });
    document.getElementById('miniVolume')?.addEventListener('input',e=>{
      audio.volume=Number(e.target.value)/100;
      AFStore.set('musicVolume',audio.volume);
      ytVolume=Math.round(audio.volume*100);
      if(ytFrame)ytCommand('setVolume',[ytVolume]);
    });
    audio.volume=Number(AFStore.get('musicVolume',0.8));
    ytVolume=Math.round(audio.volume*100);
    const volume=document.getElementById('miniVolume'); if(volume)volume.value=String(audio.volume*100);
    const last=AFStore.get('lastMusicTrack',null);
    if(last&&typeof last==='object'&&last.id){currentTrack=normalize(last);remember(currentTrack);updatePlayer();}
  }
  bindGlobal();
  window.AFMusic={renderPage,bindPage,onAction,playTrack:playTrackById,search:searchMusic,pauseAll(){
    try{audio.pause();}catch{}
    if(ytFrame)ytCommand('pauseVideo');
    document.body.classList.remove('music-playing');
  }};
})();
