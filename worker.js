/*
 * AF Game Hub API Worker
 * Routes: POST /api/ai; GET /api/music/{search,trending,artist/:id,stream/:id}; GET /api/health
 * Static files are served through the Workers static ASSETS binding.
 */
// Llama 3.1 8B was retired by Cloudflare on 2026-05-30.
// GLM-4.7-Flash is a current Workers AI text model and is listed for Free-plan access.
const MODEL = '@cf/zai-org/glm-4.7-flash';
const SYSTEM_PROMPT = `You are AF AI, the built-in assistant for AF Game Hub. Be helpful, accurate, clear, and concise. Keep responses age-appropriate for a teen audience. Do not provide explicit sexual content, instructions for self-harm, dangerous activities, wrongdoing, or bypassing safety rules. When a request is unsafe, briefly explain and suggest a safe alternative. Do not claim to have browsed the web or used tools unless the app actually provided those results.`;
const json = (payload, status=200, extra={}) => new Response(JSON.stringify(payload), {status, headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...extra}});
const textLength = value => typeof value === 'string' ? value.length : 0;
const recentCalls = new Map();

async function verifyUser(request, env) {
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '').trim();
  const apiKey = request.headers.get('apikey') || env.SUPABASE_PUBLISHABLE_KEY;
  const supabaseUrl = env.SUPABASE_URL || 'https://eqrdzenoqvduboaxhsqb.supabase.co';
  if (!token || !apiKey) return null;
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {headers:{apikey:apiKey,Authorization:`Bearer ${token}`},cache:'no-store'});
  if (!response.ok) return null;
  const user = await response.json().catch(()=>null);
  return user?.id ? user : null;
}

function isRateLimited(key, limit=8) {
  const now = Date.now();
  const windowMs = 60_000;
  const entry = recentCalls.get(key);
  if (!entry || now - entry.startedAt >= windowMs) {
    recentCalls.set(key,{startedAt:now,count:1});
    if (recentCalls.size > 5000) {
      for (const [id,item] of recentCalls) if (now-item.startedAt >= windowMs) recentCalls.delete(id);
    }
    return false;
  }
  entry.count += 1;
  return entry.count > limit;
}

async function aiRoute(request, env) {
  if (request.method !== 'POST') return json({error:'Use POST for AI chat.'},405,{Allow:'POST'});
  if (!env.AI?.run) return json({error:'AF AI is not configured yet. Add the Workers AI binding named AI in Cloudflare Workers settings, then redeploy.'},503);
  let user;
  try { user = await verifyUser(request,env); } catch { return json({error:'Could not verify your AF Hub account. Try signing in again.'},401); }
  if (!user) return json({error:'Sign in to your AF Game Hub account before using AF AI.'},401);
  if (isRateLimited(user.id)) return json({error:'You are sending messages too quickly. Wait a minute and try again.'},429);
  const body = await request.json().catch(()=>null);
  if (!body || !Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 16) return json({error:'Send between 1 and 16 chat messages.'},400);
  const messages=[];
  for (const item of body.messages) {
    if (!item || !['user','assistant'].includes(item.role) || typeof item.content !== 'string' || !item.content.trim() || textLength(item.content)>3000) return json({error:'Each message must be text with a valid role and be no longer than 3,000 characters.'},400);
    messages.push({role:item.role,content:item.content.trim()});
  }
  const modelMessages=[{role:'system',content:SYSTEM_PROMPT},...messages];
  try {
    // Match Cloudflare's documented GLM-4.7-Flash binding example; keep the input minimal.
    const result=await env.AI.run(MODEL,{messages:modelMessages});
    if (result?.error) throw new Error(typeof result.error==='string'?result.error:JSON.stringify(result.error));
    const answer=typeof result?.response==='string'?result.response:
      typeof result?.output==='string'?result.output:
      typeof result?.result?.response==='string'?result.result.response:
      typeof result?.choices?.[0]?.message?.content==='string'?result.choices[0].message.content:
      typeof result?.output_text==='string'?result.output_text:
      typeof result?.content==='string'?result.content:'';
    if (!answer.trim()) return json({error:'The AI model did not return a text response. Try again.'},502);
    return json({response:answer.trim(),model:MODEL});
  } catch (error) {
    const detail=String(error?.message||error||'Unknown Workers AI error').slice(0,360);
    console.error('AF AI inference failed:',detail);
    return json({error:'Cloudflare Workers AI rejected or could not complete this request.',detail,model:MODEL},503);
  }
}

const AUDIO_API = 'https://api.audius.co/v1';
function toBool(value) { return value === true || value === 1 || value === 'true' || value === '1'; }
function trackIsPlayable(track) {
  const streamable = track.is_streamable ?? track.isStreamable;
  const gated = track.is_stream_gated ?? track.isStreamGated;
  const warning = String(track.parental_warning_type ?? track.parentalWarningType ?? '').toLowerCase();
  const unlisted = track.is_unlisted ?? track.isUnlisted;
  if (streamable != null && !toBool(streamable)) return false;
  const explicit = track.is_explicit ?? track.isExplicit ?? track.explicit;
  if (toBool(gated) || toBool(unlisted) || toBool(explicit)) return false;
  if (warning && !['none','clean','false'].includes(warning)) return false;
  return true;
}
function safeTrack(track) {
  const user = track.user || track.user_data || {};
  const art = track.artwork || {};
  return {
    id: String(track.id || track.track_id || ''),
    title: String(track.title || 'Untitled track').slice(0,180),
    artist: String(track.artist || track.artist_name || user.name || user.handle || 'Unknown artist').slice(0,120),
    user: {id:String(user.id || track.user_id || ''), handle:String(user.handle || ''), name:String(user.name || user.handle || '')},
    artwork: typeof art === 'string' ? art : (art._480x480 || art._1000x1000 || art._150x150 || ''),
    duration: Number(track.duration || 0), genre:String(track.genre || '').slice(0,60),
    play_count:Number(track.play_count ?? track.playCount ?? 0),
    permalink:String(track.permalink || 'https://audius.co/'),
    is_streamable:true, is_stream_gated:false,
    parental_warning_type:'', description:String(track.description || '').slice(0,1200)
  };
}
async function audiusJson(path, params={}) {
  const url = new URL(`${AUDIO_API}${path}`);
  for (const [key,value] of Object.entries(params)) if (value !== undefined && value !== null && value !== '') url.searchParams.set(key,String(value));
  url.searchParams.set('app_name','AFGameHub');
  const response = await fetch(url.toString(), {headers:{Accept:'application/json'}, cf:{cacheTtl:300,cacheEverything:true}});
  const data = await response.json().catch(()=>({}));
  if (!response.ok) {
    const message = data?.message || data?.error || `Audius returned HTTP ${response.status}.`;
    throw new Error(String(message).slice(0,260));
  }
  return data;
}
async function cachedJson(key, loader, ttl=300) {
  const cache = globalThis.caches?.default;
  const request = new Request(`https://afhub-audius-cache.local/${encodeURIComponent(key)}`);
  if (cache) {
    const cached = await cache.match(request);
    if (cached) return cached;
  }
  const value = await loader();
  const response = json(value,200,{'Cache-Control':`public, max-age=0, s-maxage=${ttl}`});
  if (cache) await cache.put(request,response.clone());
  return response;
}
async function musicTrendingRoute(request) {
  if (request.method !== 'GET') return json({error:'Use GET for music discovery.'},405,{Allow:'GET'});
  try {
    return await cachedJson('trending-week-v1',async()=>{
      const data = await audiusJson('/tracks/trending',{time:'week',limit:40});
      const tracks = (data.data || []).filter(trackIsPlayable).map(safeTrack).filter(t=>t.id);
      return {provider:'Audius',audioOnly:true,tracks};
    },600);
  } catch (error) { return json({error:`Audius music discovery is unavailable: ${String(error.message||error)}`},502); }
}
async function musicSearchRoute(request) {
  if (request.method !== 'GET') return json({error:'Use GET for music search.'},405,{Allow:'GET'});
  const url = new URL(request.url);
  const query = (url.searchParams.get('q') || '').trim().slice(0,100);
  if (query.length < 2) return json({error:'Enter at least 2 characters to search.'},400);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (isRateLimited(`audius-search:${ip}`,24)) return json({error:'Too many music searches. Wait a minute and try again.'},429);
  try {
    return await cachedJson(`search-v1-${query.toLowerCase()}`,async()=>{
      const [trackData,userData] = await Promise.all([
        audiusJson('/tracks/search',{query,limit:30,sort_method:'relevant'}),
        audiusJson('/users/search',{query,limit:12,sort_method:'relevant'})
      ]);
      const tracks = (trackData.data || []).filter(trackIsPlayable).map(safeTrack).filter(t=>t.id);
      const artists = (userData.data || []).map(user=>({
        id:String(user.id || ''),name:String(user.name || user.handle || 'Artist').slice(0,120),
        handle:String(user.handle || ''), artwork:user.profile_picture?._150x150 || user.profile_picture?._480x480 || ''
      })).filter(a=>a.id);
      return {provider:'Audius',audioOnly:true,query,tracks,artists};
    },300);
  } catch (error) { return json({error:`Audius search failed: ${String(error.message||error)}`},502); }
}
async function musicArtistRoute(request, id) {
  if (request.method !== 'GET') return json({error:'Use GET for artist tracks.'},405,{Allow:'GET'});
  if (!/^[A-Za-z0-9_-]{2,80}$/.test(id)) return json({error:'Invalid artist ID.'},400);
  try {
    return await cachedJson(`artist-tracks-v1-${id}`,async()=>{
      const data=await audiusJson(`/users/${encodeURIComponent(id)}/tracks`,{limit:40,sort_method:'popular'});
      return {provider:'Audius',audioOnly:true,tracks:(data.data||[]).filter(trackIsPlayable).map(safeTrack).filter(t=>t.id)};
    },300);
  } catch (error) { return json({error:`Could not load artist tracks: ${String(error.message||error)}`},502); }
}
function musicStreamRoute(request, id) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return json({error:'Use GET to stream audio.'},405,{Allow:'GET, HEAD'});
  if (!/^[A-Za-z0-9_-]{2,100}$/.test(id)) return json({error:'Invalid track ID.'},400);
  // This only redirects to Audius' official stream endpoint for a specific track ID.
  // It is not a general-purpose URL fetcher or an audio extractor for video services.
  const streamUrl = new URL(`${AUDIO_API}/tracks/${encodeURIComponent(id)}/stream`);
  streamUrl.searchParams.set('app_name','AFGameHub');
  return Response.redirect(streamUrl.toString(),302);
}


function decodeHtml(value='') {
  return String(value).replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n))).replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCharCode(parseInt(n,16)));
}
function plainHtml(value='') { return decodeHtml(String(value).replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()); }
function normalizeSearchHref(raw) {
  try {
    let u=new URL(decodeHtml(raw),'https://html.duckduckgo.com');
    if((u.hostname==='duckduckgo.com'||u.hostname.endsWith('.duckduckgo.com'))&&u.pathname==='/l/'){
      const target=u.searchParams.get('uddg');if(target)u=new URL(target);
    }
    if(!['http:','https:'].includes(u.protocol))return '';
    if(u.hostname.endsWith('duckduckgo.com'))return '';
    return u.toString();
  } catch { return ''; }
}
async function webSearchRoute(request) {
  if(request.method!=='GET')return json({error:'Use GET for web search.'},405,{Allow:'GET'});
  const url=new URL(request.url);const query=(url.searchParams.get('q')||'').trim().slice(0,160);
  if(query.length<2)return json({error:'Enter at least two characters to search.'},400);
  const ip=request.headers.get('CF-Connecting-IP')||'unknown';
  if(isRateLimited(`web-search:${ip}`,20))return json({error:'Too many searches. Wait a minute and try again.'},429);
  const key=`afhub-web-search-v1-${query.toLowerCase()}`;
  try {
    return await cachedJson(key,async()=>{
      const searchUrl=new URL('https://html.duckduckgo.com/html/');searchUrl.searchParams.set('q',query);
      const response=await fetch(searchUrl.toString(),{headers:{Accept:'text/html,application/xhtml+xml','User-Agent':'Mozilla/5.0 (compatible; AFGameHubSearch/1.0)'}});
      if(!response.ok)throw new Error(`Search provider returned HTTP ${response.status}.`);
      const html=await response.text();
      if(/anomaly-modal|bots use duckduckgo|select all squares/i.test(html))throw new Error('Search provider temporarily rate-limited automated requests. Try again later.');
      const anchors=[...html.matchAll(/<a\b([^>]*\bclass=["'][^"']*\bresult__a\b[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi)];
      const results=[];const seen=new Set();
      for(const match of anchors){
        const hrefMatch=match[1].match(/\bhref=["']([^"']+)["']/i);if(!hrefMatch)continue;
        const href=normalizeSearchHref(hrefMatch[1]);if(!href||seen.has(href))continue;
        const title=plainHtml(match[2]).slice(0,220);if(!title)continue;
        const rest=html.slice(match.index+match[0].length,match.index+match[0].length+2200);
        const snip=rest.match(/class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div|td|span)>/i);
        let domain='';try{domain=new URL(href).hostname.replace(/^www\./,'');}catch{}
        results.push({title,url:href,domain,snippet:snip?plainHtml(snip[1]).slice(0,420):''});seen.add(href);
        if(results.length>=20)break;
      }
      return {provider:'DuckDuckGo',query,results};
    },120);
  } catch(error) { return json({error:`AF Hub search could not complete: ${String(error.message||error).slice(0,220)}`},502); }
}

export default {
  async fetch(request, env, ctx) {
    const url=new URL(request.url);
    if (url.pathname==='/api/health') return json({ok:true,ai:!!env.AI?.run,aiModel:MODEL,musicProvider:'Audius',audioOnlyMusic:true,musicApi:true,youtubeKeyRequired:false});
    if (url.pathname==='/api/ai') return aiRoute(request,env);
    if (url.pathname==='/api/search') return webSearchRoute(request);
    if (url.pathname==='/api/music/search') return musicSearchRoute(request);
    if (url.pathname==='/api/music/trending') return musicTrendingRoute(request);
    if (url.pathname.startsWith('/api/music/artist/')) return musicArtistRoute(request,url.pathname.slice('/api/music/artist/'.length));
    if (url.pathname.startsWith('/api/music/stream/')) return musicStreamRoute(request,url.pathname.slice('/api/music/stream/'.length));
    return env.ASSETS.fetch(request);
  }
};
