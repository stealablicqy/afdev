(() => {
  'use strict';
  const U=window.AFUtil;
  const root=document.getElementById('viewRoot');
  const titles={home:'Home',web:'Browser',games:'Games',music:'Music',apps:'Apps',media:'Watch & listen',movies:'Movies & media',study:'Tools & utilities',ai:'AI assistant',community:'Chat & friends',account:'My profile',notes:'Quick notes',settings:'Settings'};
  let aiConversation=AFStoreSafeGet('aiConversation',[]);
  let aiSessionKey='';
  let aiPendingImage=null;
  let aiSessions=AFStoreSafeGet('aiSessions',[]);
  let aiActiveSessionId=AFStoreSafeGet('aiActiveSessionId','');
  if(!aiActiveSessionId){aiActiveSessionId=`chat_${Date.now().toString(36)}`;AFStore.set('aiActiveSessionId',aiActiveSessionId);}
  if(aiConversation.length&&!aiSessions.some(x=>x.id===aiActiveSessionId)){aiSessions.unshift({id:aiActiveSessionId,title:(aiConversation.find(m=>m.role==='user')?.content||'Previous conversation').slice(0,42),messages:aiConversation,updatedAt:Date.now()});AFStore.set('aiSessions',aiSessions);}
  function AFStoreSafeGet(k,d){try{return window.AFStore?.get(k,d)??d;}catch{return d;}}
  function openWeb(value){
    const raw=String(value||'').trim();if(!raw)return;
    const looksLikeUrl=/^(https?:\/\/|[\w-]+(?:\.[\w-]+)+(?:[:\/]\S*)?$)/i.test(raw);
    if(looksLikeUrl){const safe=U.safeUrl(/^https?:\/\//i.test(raw)?raw:`https://${raw}`);location.href=`./go/?url=${encodeURIComponent(safe||raw)}`;return;}
    location.href=`./go/?q=${encodeURIComponent(raw.slice(0,180))}`;
  }
  const appLinks=[
    {name:'Google Classroom',desc:'Classwork and assignments',url:'https://classroom.google.com/',cat:'Productivity',icon:'C',color:'#4285f4'},
    {name:'Google Drive',desc:'Cloud files and folders',url:'https://drive.google.com/',cat:'Productivity',icon:'D',color:'#20a76b'},
    {name:'Google Docs',desc:'Documents and writing',url:'https://docs.google.com/document/',cat:'Productivity',icon:'D',color:'#4285f4'},
    {name:'Khan Academy',desc:'Lessons and practice',url:'https://www.khanacademy.org/',cat:'Productivity',icon:'K',color:'#18a66a'},
    {name:'IXL',desc:'Skills practice',url:'https://www.ixl.com/',cat:'Productivity',icon:'I',color:'#4b83d1'},
    {name:'YouTube',desc:'Videos and learning',url:'https://www.youtube.com/',cat:'Media',icon:'▶',color:'#ef333f'},
    {name:'Spotify',desc:'Music and podcasts',url:'https://open.spotify.com/',cat:'Media',icon:'●',color:'#1ed760'},
    {name:'SoundCloud',desc:'Independent music',url:'https://soundcloud.com/',cat:'Media',icon:'☁',color:'#ff6c2c'},
    {name:'Discord',desc:'Communities and chat',url:'https://discord.com/app',cat:'Social',icon:'D',color:'#6577e8'},
    {name:'TikTok',desc:'Short videos and creators',url:'https://www.tiktok.com/',cat:'Social',icon:'♪',color:'#d2d2d2'},
    {name:'Twitch',desc:'Gaming streams and creators',url:'https://www.twitch.tv/',cat:'Social',icon:'T',color:'#9d71ef'},
    {name:'Scratch',desc:'Create interactive projects',url:'https://scratch.mit.edu/',cat:'Create',icon:'S',color:'#f5a623'},
    {name:'Canva',desc:'Design and presentations',url:'https://www.canva.com/',cat:'Create',icon:'C',color:'#5b78ff'},
    {name:'GitHub',desc:'Code and collaboration',url:'https://github.com/',cat:'Create',icon:'⌘',color:'#858b99'},
    {name:'Roblox',desc:'Browser-based game platform',url:'https://www.roblox.com/',cat:'Gaming',icon:'R',color:'#d8dbe3'},
    {name:'Fortnite Cloud Gaming',desc:'Play through the official Xbox Cloud Gaming service',url:'https://www.xbox.com/en-US/play/fortnite',cat:'Cloud Gaming',icon:'F',color:'#6a67d8'},
    {name:'Cool Math Games',desc:'Puzzle, logic and skill games',url:'https://www.coolmathgames.com/',cat:'Gaming',icon:'C',color:'#36a5e6'},
    {name:'CrazyGames',desc:'Browser games from the official site',url:'https://www.crazygames.com/',cat:'Gaming',icon:'C',color:'#d44b42'},
    {name:'Poki',desc:'Browser game collection',url:'https://poki.com/',cat:'Gaming',icon:'P',color:'#42b7a8'},
    {name:'EmulatorJS',desc:'Open-source in-browser emulator project',url:'https://emulatorjs.org/',cat:'Emulators',icon:'E',color:'#6879ba'},
    {name:'Amazon Luna',desc:'Cloud gaming service',url:'https://luna.amazon.com/',cat:'Cloud Gaming',icon:'L',color:'#ab78e6'},
    {name:'Boosteroid',desc:'Cloud gaming service',url:'https://boosteroid.com/',cat:'Cloud Gaming',icon:'B',color:'#2f83d4'}
  ];
  const mediaLinks=[
    {name:'YouTube',desc:'Creator videos, music videos and educational content.',url:'https://www.youtube.com/',icon:'▶',note:"Use the creator or rights-holder's official channel."},
    {name:'PBS',desc:'Educational series, documentaries and public media.',url:'https://www.pbs.org/',icon:'P',note:'Availability varies by show and location.'},
    {name:'Internet Archive',desc:'A digital library with items shared under different rights.',url:'https://archive.org/details/movies',icon:'IA',note:"Check each item's rights and download terms."},
    {name:'Spotify',desc:'Music and podcasts through its official web player.',url:'https://open.spotify.com/',icon:'●',note:'Listening features depend on account and region.'},
    {name:'SoundCloud',desc:'Creator-uploaded music and mixes.',url:'https://soundcloud.com/',icon:'☁',note:"Creators control whether tracks can be played and shared."},
    {name:'NASA+',desc:'Free space, science and documentary programming.',url:'https://plus.nasa.gov/',icon:'N',note:'NASA media has specific reuse guidelines.'}
  ];
  let activeGameFilter='All';let appsFilter='All';let notesEditing=null;let quizFlashIndex=0;let calcExpression='';

  function toast(message,type=''){
    const stack=document.getElementById('toastStack');const node=document.createElement('div');node.className=`toast ${type}`;node.textContent=message;stack.appendChild(node);setTimeout(()=>node.remove(),3400);
  }
  function dialog(markup){const layer=document.getElementById('dialogLayer');layer.innerHTML=`<div class="dialog" role="dialog" aria-modal="true">${markup}</div>`;layer.hidden=false;}
  function closeDialog(){window.AFGames?.cleanup?.();const layer=document.getElementById('dialogLayer');layer.hidden=true;layer.innerHTML='';}
  function navigate(route){if(!titles[route])route='home';if(location.hash==='#'+route){renderRoute(route);return;}location.hash=route;}
  function updateNav(route){document.querySelectorAll('.nav-link[data-route]').forEach(a=>a.classList.toggle('active',a.dataset.route===route));document.getElementById('currentSection').textContent=titles[route]||'Home';document.getElementById('sidebar').classList.remove('open');}
  function renderRoute(route=(location.hash||'#home').slice(1)){
    if(!titles[route])route='home';updateNav(route);document.body.dataset.route=route;
    root.innerHTML=({home:renderHome,web:renderWeb,games:()=>AFGames.renderCatalog(),music:()=>AFMusic.renderPage(),apps:renderApps,media:renderMedia,movies:renderMovies,study:renderStudy,ai:renderAI,community:renderCommunity,account:renderAccount,notes:renderNotes,settings:renderSettings}[route]||renderHome)();
    root.dataset.route=route;
    if(route==='music')AFMusic.bindPage();
    if(route==='web')bindWebPage();
    if(route==='games')bindGameFilters();
    if(route==='apps')bindAppsSearch();
    if(route==='study')bindStudy();
    if(route==='settings')bindSettings();
    if(route==='ai')bindAI();
    if(route==='account')bindAccountPage();
    if(route==='community')bindCommunityPage();
    if(route==='movies')bindMoviesPage();
    if(route==='home')bindHomeSearch();
    const countEl=document.getElementById('gameCount');
    if(countEl)countEl.textContent=String(AFGames.games.length).padStart(2,'0');
  }
  function shortcut(name,url,initial,image=''){
    const safe=U.safeUrl(url);
    return `<a class="shortcut-card" href="${safe?U.esc(safe):'#'}" ${safe?'target="_blank" rel="noopener noreferrer"':'aria-disabled="true"'}><div class="shortcut-logo">${image?`<img src="${U.esc(image)}" alt="">`:U.esc(initial)}</div><span>${U.esc(name)}</span></a>`;
  }
  function renderHome(){
    const musicCount=AFStore.get('musicTracks',[]).length;
    const recent=AFStore.get('recentGames',[]).map(id=>AFGames.games.find(g=>g.id===id)).filter(Boolean).slice(0,4);
    const s=AFStore.get('settings',{});
    const quick=[['Games','games','▣'],['Music','music','♫'],['AI','ai','✧'],['Apps','apps','▦'],['Movies','movies','▷'],['Browser','web','◍']];
    return `<section class="desync-home"><div class="home-brand-lockup"><img class="home-brand-falcon" src="assets/falcon.png" alt="" width="112" height="112"><div class="home-brand-word">AF <span>GAME HUB</span></div><div class="home-brand-sub">YOUR PERSONAL WEB SPACE</div></div>
      <form class="home-omnibox" id="heroSearchForm"><span class="search-glyph">&#9906;</span><input id="heroSearchInput" type="search" placeholder="Search for anything or enter a website…" autocomplete="off" aria-label="Search the web or enter a website"><button class="home-search-go" type="submit" aria-label="Search">&#8599;</button></form>
      <div class="home-quick-links">${quick.map(([name,route,icon])=>`<button class="home-quick-link" data-action="route" data-route="${route}"><span>${icon}</span><small>${name}</small></button>`).join('')}</div>
      <div class="home-extra-links"><button class="text-link" data-action="route" data-route="games">All ${AFGames.games.length} games &#8599;</button><button class="text-link" data-action="route" data-route="apps">Explore more links &#8599;</button></div>
      ${recent.length?`<div class="home-recent"><div class="section-title-row"><div><h2 class="section-title">Recently played</h2><p class="section-sub">Pick up where you left off.</p></div><button class="text-link" data-action="route" data-route="games">All games &#8599;</button></div><div class="home-recent-grid">${recent.map(g=>`<button class="home-recent-card" data-action="game-launch" data-id="${U.esc(g.id)}"><img src="${U.esc(g.art)}" alt="" loading="lazy"><span><strong>${U.esc(g.title)}</strong><small>${U.esc(g.category||'Game')}</small></span><b>&#8599;</b></button>`).join('')}</div></div>`:''}
      </section>`;
  }
  function renderWeb(){
    return `<div class="page-head"><div><div class="eyebrow">AF WEB WORKSPACE</div><h1 class="page-title">Browser</h1><p class="page-subtitle">Browse inside the hub with tabs, an omnibox and history.</p></div><a class="btn btn-primary" href="go/">Open browser &#8599;</a></div>
      <section class="web-launch panel"><div class="web-launch-copy"><span class="tiny-label">PROXY LADDER</span><h2>Traffic leaves through the relay, not this site</h2><p>Pages load through a WebSocket relay so the network filter only ever sees this hub. Set the relay address in Settings if the default one is unreachable.</p></div><div class="web-launch-actions"><a class="btn btn-primary" href="go/">Launch browser &#8599;</a><button class="btn" data-action="route" data-route="settings">Relay settings</button></div></section>
      <div class="section-title-row"><div><h2 class="section-title">Quick launch</h2><p class="section-sub">Opens in the AF browser.</p></div></div>
      <div class="bookmark-grid">${appLinks.slice(0,12).map(a=>`<button type="button" class="web-card" data-action="web-open" data-url="${U.esc(a.url)}"><span class="web-card-icon" style="background:${U.esc(a.color||'#242833')}">${U.esc(a.icon||a.name[0])}</span><span class="web-card-copy"><strong>${U.esc(a.name)}</strong><small>${U.esc(a.desc||U.host(a.url))}</small></span><span class="web-card-arrow">&#8599;</span></button>`).join('')}</div>`;
  }
  function renderGames(){return AFGames.renderCatalog();}
  function bindGameFilters(){AFGames.bindCatalog();}
  function renderApps(){
    const own=AFStore.get('customApps',[]);const all=[...appLinks,...own.map(a=>({...a,custom:true,cat:a.cat||'Custom'}))];
    const cats=['All','Social','Gaming','Emulators','Cloud Gaming','Media','Create','Productivity','Custom'];
    return `<div class="page-head"><div><div class="eyebrow">YOUR DIGITAL TOOLBOX</div><h1 class="page-title">Apps</h1><p class="page-subtitle">Your go-to creative, entertainment and everyday apps in one organized place.</p></div><button class="btn btn-primary" data-action="app-add">＋ Add custom app</button></div><div class="filter-row"><input class="input" id="appsSearch" type="search" placeholder="Search apps…"><div class="filter-chips">${cats.map(c=>`<button class="chip ${c==='All'?'active':''}" data-app-filter="${c}">${c}</button>`).join('')}</div></div><div class="app-card-grid" id="appCardGrid">${all.map(appTile).join('')}</div><p class="section-sub" style="margin-top:13px">App shortcuts open the provider's own website in a new tab. External sign-in and site rules still apply.</p>`;
  }
  function appTile(a){const safe=U.safeUrl(a.url);return `<div class="app-tile" data-app-name="${U.esc(String(a.name||'').toLowerCase())}" data-app-cat="${U.esc(a.cat||'Custom')}">${safe?`<a class="app-tile-link" href="${U.esc(safe)}" target="_blank" rel="noopener noreferrer">`:'<div class="app-tile-link" aria-disabled="true">'}<span class="app-icon" style="background:${U.esc(a.color||'#242833')}">${a.image?`<img src="${U.esc(a.image)}" alt="">`:U.esc(a.icon||(a.name||'?')[0])}</span><span style="min-width:0;flex:1"><strong>${U.esc(a.name||'Unnamed app')}</strong><small>${U.esc(a.desc||U.host(a.url))}</small></span>${safe?'</a>':'</div>'}${a.custom?`<button type="button" class="icon-btn" data-action="app-remove" data-id="${U.esc(a.id)}" title="Remove ${U.esc(a.name||'app')}">×</button>`:'<span class="web-card-arrow">↗</span>'}</div>`;}
  function bindAppsSearch(){const input=document.getElementById('appsSearch');const apply=()=>{const q=input.value.toLowerCase();const active=document.querySelector('[data-app-filter].active')?.dataset.appFilter||'All';document.querySelectorAll('[data-app-name]').forEach(el=>{el.hidden=!(el.dataset.appName.includes(q)&&(active==='All'||el.dataset.appCat===active));});};input?.addEventListener('input',apply);document.querySelectorAll('[data-app-filter]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('[data-app-filter]').forEach(x=>x.classList.toggle('active',x===b));apply();}));}
  function addAppDialog(){dialog(`<div class="dialog-head"><div><div class="eyebrow">CUSTOM SHORTCUT</div><h2>Add your app</h2></div><button class="icon-button" data-action="close-dialog">×</button></div><div class="dialog-body"><label class="field-label">App name<input class="input" id="customAppName" maxlength="50" placeholder="My app"></label><label class="field-label">Website URL<input class="input" id="customAppUrl" type="url" placeholder="https://example.com"></label><label class="field-label">Short description<input class="input" id="customAppDesc" maxlength="90" placeholder="What this app is for"></label><div class="dialog-actions"><button class="btn" data-action="close-dialog">Cancel</button><button class="btn btn-primary" id="customAppSave">Add app</button></div></div>`);document.getElementById('customAppSave').addEventListener('click',()=>{const name=document.getElementById('customAppName').value.trim();const url=U.safeUrl(document.getElementById('customAppUrl').value);if(!name||!url){toast('Enter an app name and a valid website URL.','error');return;}const apps=AFStore.get('customApps',[]);apps.push({id:U.id('app'),name,url,desc:document.getElementById('customAppDesc').value.trim(),icon:name[0].toUpperCase(),cat:'Custom',custom:true});AFStore.set('customApps',apps);closeDialog();renderRoute('apps');toast('Custom app added.','success');});}
  function renderMedia(){return `<div class="page-head"><div><div class="eyebrow">OFFICIAL PLAYERS & SOURCES</div><h1 class="page-title">Watch & listen</h1><p class="page-subtitle">Discover video, audio and public-media destinations from their official websites.</p></div></div><section class="media-feature"><div><div class="eyebrow">MEDIA SPOTLIGHT</div><h3>Keep the player, respect the source.</h3><p>AF Hub links to official platforms and supports provider embeds in the Music section. Playback, ads, subscriptions, and content availability are managed by each publisher.</p><button class="btn btn-primary" data-action="route" data-route="music">Open music player ♫</button></div><div class="music-notice"><strong>Streaming note</strong><br>Only use links and media you are allowed to share. AF Hub does not scrape, extract or rehost videos or copyrighted audio.</div></section><div class="section-title-row"><div><h2 class="section-title">Explore media platforms</h2><p class="section-sub">Open each service directly.</p></div></div><div class="media-tiles">${mediaLinks.map(m=>`<a class="media-tile" href="${U.esc(m.url)}" target="_blank" rel="noopener noreferrer"><span class="provider-logo">${U.esc(m.icon)}</span><strong>${U.esc(m.name)} ↗</strong><small>${U.esc(m.desc)}<br><br>${U.esc(m.note)}</small></a>`).join('')}</div>`;}
  function renderStudy(){
    const cards=AFStore.get('flashcards',[]);
    return `<div class="page-head"><div><div class="eyebrow">LEARN • PRACTICE • ORGANIZE</div><h1 class="page-title">Study tools</h1><p class="page-subtitle">Simple tools that work locally, without needing an account.</p></div></div><div class="tool-grid"><section class="panel tool-card"><h3>Quick calculator</h3><p>A simple calculator for everyday school math.</p><div class="calc-display" id="calcDisplay">0</div><div class="calc-grid">${['7','8','9','÷','4','5','6','×','1','2','3','−','0','.','⌫','+','C','(',')','='].map(x=>`<button class="${['÷','×','−','+','='].includes(x)?'operator':''}" data-calc="${x}">${x}</button>`).join('')}</div></section><section class="panel tool-card"><h3>Flashcards</h3><p>Create a small deck and quiz yourself. Cards stay on this device.</p><form id="flashcardForm" class="dialog-body"><label class="field-label">Question<input class="input" id="flashQuestion" maxlength="150" placeholder="What is photosynthesis?"></label><label class="field-label">Answer<input class="input" id="flashAnswer" maxlength="220" placeholder="Plants use light to make food…"></label><button class="btn btn-primary" type="submit">＋ Add flashcard</button></form><div class="activity-item" style="margin-top:15px"><span class="activity-icon">✧</span><span class="activity-copy"><strong>${cards.length} saved flashcard${cards.length===1?'':'s'}</strong><small>Practice whenever you're ready</small></span><button class="btn btn-sm" data-action="flashcard-quiz" ${cards.length?'':'disabled'}>Study</button></div><div id="flashcardDeck" class="track-list">${cards.slice(-3).reverse().map(c=>`<div class="note-card"><strong>${U.esc(c.q)}</strong><p>${U.esc(c.a)}</p></div>`).join('')}</div></section><section class="panel tool-card"><h3>Study assistant</h3><p>AI assistance can be connected after the AF API is deployed and a private provider key is configured. No key belongs in the browser.</p><div class="warning-note">Cloud feature not connected in this local build. The other study tools work offline.</div><button class="btn" style="margin-top:12px" data-action="route" data-route="notes">Open quick notes</button></section><section class="panel tool-card"><h3>Focus checklist</h3><p>Break a big assignment into small steps.</p><div id="focusList">${AFStore.get('focusItems',[]).map((item,i)=>`<div class="toggle-row"><label><input type="checkbox" data-focus-done="${i}" ${item.done?'checked':''}> ${U.esc(item.text)}</label><button class="icon-btn" data-action="focus-remove" data-id="${i}">×</button></div>`).join('')}</div><button class="btn btn-sm" data-action="focus-add">＋ Add step</button></section></div>`;
  }
  function bindStudy(){
    document.getElementById('flashcardForm')?.addEventListener('submit',e=>{e.preventDefault();const q=document.getElementById('flashQuestion').value.trim(),a=document.getElementById('flashAnswer').value.trim();if(!q||!a){toast('Add both a question and answer.','error');return;}const list=AFStore.get('flashcards',[]);list.push({id:U.id('card'),q,a});AFStore.set('flashcards',list);renderRoute('study');toast('Flashcard saved.','success');});
    document.querySelectorAll('[data-calc]').forEach(b=>b.addEventListener('click',()=>calcPress(b.dataset.calc)));
    document.querySelectorAll('[data-focus-done]').forEach(b=>b.addEventListener('change',()=>{const list=AFStore.get('focusItems',[]);list[Number(b.dataset.focusDone)].done=b.checked;AFStore.set('focusItems',list);}));
  }
  function calcPress(key){const display=document.getElementById('calcDisplay');if(!display)return;if(key==='C')calcExpression='';else if(key==='⌫')calcExpression=calcExpression.slice(0,-1);else if(key==='='){try{const val=safeCalculate(calcExpression);calcExpression=String(val);}catch{toast('Check the calculation and try again.','error');}}else calcExpression+=({'÷':'/','×':'*','−':'-'}[key]||key);display.textContent=calcExpression||'0';}
  function safeCalculate(expression){const tokens=expression.match(/\d+(?:\.\d+)?|[()+\-*/]/g)||[];if(tokens.join('')!==expression.replace(/\s/g,''))throw Error('Invalid');let pos=0;function factor(){const t=tokens[pos++];if(t==='('){const v=expr();if(tokens[pos++]!==')')throw Error('Paren');return v;}if(t==='-')return -factor();const n=Number(t);if(!Number.isFinite(n))throw Error('Number');return n;}function term(){let v=factor();while(tokens[pos]==='*'||tokens[pos]==='/'){const op=tokens[pos++],n=factor();v=op==='*'?v*n:v/n;}return v;}function expr(){let v=term();while(tokens[pos]==='+'||tokens[pos]==='-'){const op=tokens[pos++],n=term();v=op==='+'?v+n:v-n;}return v;}const result=expr();if(pos!==tokens.length||!Number.isFinite(result))throw Error('Invalid');return Number(result.toFixed(8));}
  function flashcardQuiz(){const cards=AFStore.get('flashcards',[]);if(!cards.length)return;let i=0,show=false;function draw(){const c=cards[i%cards.length];dialog(`<div class="dialog-head"><div><div class="eyebrow">FLASHCARD REVIEW</div><h2>Card ${i+1} of ${cards.length}</h2></div><button class="icon-button" data-action="close-dialog">×</button></div><div class="dialog-body"><div class="quiz-card"><div class="tiny-label">${show?'ANSWER':'QUESTION'}</div><h3 style="font:600 19px Space Grotesk;line-height:1.5;margin:10px 0">${U.esc(show?c.a:c.q)}</h3></div><div class="dialog-actions"><button class="btn" id="flipCard">${show?'Show question':'Reveal answer'}</button><button class="btn btn-primary" id="nextCard">${i===cards.length-1?'Finish':'Next card'} →</button></div></div>`);document.getElementById('flipCard').addEventListener('click',()=>{show=!show;draw();});document.getElementById('nextCard').addEventListener('click',()=>{i++;show=false;if(i>=cards.length){closeDialog();toast('Flashcard review complete.','success');}else draw();});}draw();}
  function aiHistoryMarkup(){return aiSessions.slice(0,8).map(x=>`<button class="ai-history-item ${x.id===aiActiveSessionId?'active':''}" data-ai-session="${U.esc(x.id)}"><strong>${U.esc(x.title||'Untitled chat')}</strong><small>${new Date(x.updatedAt||Date.now()).toLocaleDateString()}</small></button>`).join('')||'<p class="section-sub">Your conversations will appear here.</p>'; }
  function refreshAiHistory(){const box=document.querySelector('.ai-history-list');if(box)box.innerHTML=aiHistoryMarkup();}
  function saveAiSession(){
    if(!aiConversation.length)return;
    const first=aiConversation.find(m=>m.role==='user')?.content||'Conversation';
    const item={id:aiActiveSessionId,title:first.slice(0,42),messages:aiConversation.map(m=>({...m})),updatedAt:Date.now()};
    aiSessions=[item,...aiSessions.filter(x=>x.id!==aiActiveSessionId)].slice(0,30);
    AFStore.set('aiSessions',aiSessions);refreshAiHistory();
  }
  function startAiSession(){
    saveAiSession();aiConversation=[];aiPendingImage=null;aiActiveSessionId=`chat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,6)}`;
    AFStore.set('aiActiveSessionId',aiActiveSessionId);AFStore.set('aiConversation',[]);renderRoute('ai');
  }
  function loadAiSession(id){
    saveAiSession();const item=aiSessions.find(x=>x.id===id);if(!item)return;aiActiveSessionId=id;aiConversation=item.messages.map(m=>({...m}));aiPendingImage=null;AFStore.set('aiActiveSessionId',id);AFStore.set('aiConversation',aiConversation);renderRoute('ai');
  }
  function renderAI(){
    const history=aiConversation.length?aiConversation.map(m=>`<div class="ai-message ${m.role==='user'?'user':'assistant'}"><strong>${m.role==='user'?'You':'AF AI'}</strong><p>${U.esc(m.content)}</p></div>`).join(''):`<div class="ai-welcome"><div class="empty-icon">&#10023;</div><h3>Meet AF AI</h3><p>Ask anything — questions, ideas, explanations, code, planning, or help using AF Game Hub.</p></div>`;
    return `<div class="page-head"><div><div class="eyebrow">AF AI &bull; BUILT INTO YOUR HUB</div><h1 class="page-title">AI assistant</h1><p class="page-subtitle">A hosted assistant. No account, no local model, no API key on your device.</p></div><div class="ai-button-row"><button class="btn" id="aiNewBtn">&#65291; New chat</button><button class="btn" id="aiClearBtn">Clear chat</button></div></div>
      <div class="ai-layout"><section class="panel ai-panel"><div class="ai-chat-head"><div><strong>AF AI CHAT</strong><small id="aiConnectionState">Ready &middot; hosted model</small></div><span class="tiny-label">HOSTED AI</span></div><div class="ai-messages" id="aiMessages" aria-live="polite">${history}</div><form class="ai-prompt-form" id="aiPromptForm"><textarea class="textarea" id="aiPrompt" rows="2" maxlength="3000" placeholder="Ask AF AI anything&hellip;" required></textarea><button class="btn btn-primary" id="aiSendBtn" type="submit">Send &#8599;</button></form><p class="section-sub">Responses can be wrong. Check anything important before you rely on it.</p></section>
      <aside class="panel ai-config"><div class="section-title-row" style="margin-top:0"><div><h2 class="section-title">Chat history</h2><p class="section-sub">Saved in this browser.</p></div></div><div class="ai-history-list">${aiHistoryMarkup()}</div><div class="section-title-row" style="margin-top:20px"><div><h2 class="section-title">AF AI service</h2><p class="section-sub">Hosted models, no account.</p></div></div><div class="ai-service-card"><span class="ai-service-mark">&#10023;</span><div><strong>AF AI &middot; hosted</strong><small>Fallback ladder &middot; text chat &middot; live test</small></div><span class="ai-service-state" id="aiServiceState">Idle</span></div><button class="btn" id="aiTestBtn" type="button">Test AI service</button><div id="aiStatusNote" class="ai-status-note">Send a message to start chatting.</div><div class="warning-note" style="margin-top:14px">Hosted endpoints are free and shared, so a burst of requests can be throttled for a moment. Add your own endpoint in Settings to skip them.</div></aside></div>`;
  }
  // Hosted endpoints change their access rules without notice: pollinations now
  // demands a Turnstile token from browser origins, and llm7 throttles bursts
  // per IP. So the assistant walks a ladder and keeps whichever lane answered,
  // for the rest of the session. A user endpoint and model always win, which is
  // what lets a filtered school device point the hub somewhere reachable.
  const AI_LANES=[
    {id:'custom',url:()=>(localStorage.getItem('af.ai.endpoint')||'').trim(),model:()=>(localStorage.getItem('af.ai.model')||'').trim()||'fast'},
    {id:'llm7',url:()=>'https://api.llm7.io/v1/chat/completions',model:()=>'fast'},
    {id:'pollinations',url:()=>'https://text.pollinations.ai/openai',model:()=>'openai'}
  ];
  let aiLaneId='';
  function aiLane(){return AI_LANES.find(lane=>lane.id===aiLaneId)||null;}
  async function aiCall(lane,messages){
    const endpoint=lane.url();
    if(!endpoint)throw new Error('no endpoint set');
    const res=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:lane.model(),messages,stream:false})});
    if(!res.ok){
      const detail=await res.text().catch(()=>'');
      throw new Error(`HTTP ${res.status}${detail?` \u2014 ${detail.slice(0,120)}`:''}`);
    }
    const data=await res.json().catch(()=>null);
    const answer=data&&(data.choices?.[0]?.message?.content||data.choices?.[0]?.text||data.response);
    if(!answer)throw new Error('empty answer');
    return cleanAnswer(answer);
  }
  // Some free lanes return raw chat-template frames (`<minimax:tool_call>`) and
  // the model's own narration after the answer. Everything from the first frame
  // tag on is scaffolding, not reply, so it is cut before the message renders.
  function cleanAnswer(raw){
    let text=String(raw||'');
    const cut=text.search(/<[a-z0-9_-]+:[a-z0-9_-]+[\s>/]/i);
    if(cut>0)text=text.slice(0,cut);
    text=text.replace(/<\|[^|]{0,40}\|>/g,' ').replace(/<\/?[a-z0-9_-]+:[^>]{0,200}>/gi,' ');
    text=text.replace(/^\s*(assistant|system|model)\s*:\s*/i,'');
    return text.replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
  }
  async function aiRequest(messages){
    const preferred=aiLane();
    const order=preferred?[preferred,...AI_LANES.filter(lane=>lane!==preferred)]:AI_LANES;
    const failures=[];
    for(const lane of order){
      if(!lane.url())continue;
      try{
        const answer=await aiCall(lane,messages);
        aiLaneId=lane.id;
        return answer;
      }catch(err){
        failures.push(`${lane.id}: ${err.message}`);
      }
    }
    throw new Error(failures.length?`AF AI could not reach a model \u2014 ${failures.join('; ')}`:'AF AI has no endpoint configured.');
  }
  function bindAI(){
    const state=document.getElementById('aiConnectionState');
    const prompt=document.getElementById('aiPrompt');
    const messages=document.getElementById('aiMessages');
    const form=document.getElementById('aiPromptForm');
    const status=document.getElementById('aiStatusNote');
    const service=document.getElementById('aiServiceState');
    if(!form)return;
    const draw=()=>{messages.innerHTML='';if(!aiConversation.length){messages.innerHTML='<div class="ai-welcome"><div class="empty-icon">&#10023;</div><h3>Meet AF AI</h3><p>Ask anything &mdash; questions, ideas, explanations, code, planning, or help using AF Game Hub.</p></div>';return;}aiConversation.forEach(m=>{const node=document.createElement('div');node.className=`ai-message ${m.role==='user'?'user':'assistant'}`;const head=document.createElement('strong');head.textContent=m.role==='user'?'You':'AF AI';const body=document.createElement('p');body.textContent=m.content;node.append(head,body);messages.append(node);});messages.scrollTop=messages.scrollHeight;};
    service.textContent='Ready';
    document.getElementById('aiTestBtn')?.addEventListener('click',async()=>{
      status.textContent='Testing a real AI response\u2026';
      service.textContent='Testing';
      try{
        const answer=await aiRequest([{role:'user',content:'Reply with exactly: AF AI connection successful.'}]);
        service.textContent='Online';state.textContent='Service online \u00b7 test succeeded';status.textContent=`AF AI replied: ${answer.slice(0,160)}`;
      }catch(err){
        service.textContent='Offline';state.textContent='AI request failed';status.textContent=err.message;
      }
    });
    document.getElementById('aiNewBtn')?.addEventListener('click',startAiSession);
    document.getElementById('aiClearBtn')?.addEventListener('click',()=>{aiConversation=[];AFStore.set('aiConversation',aiConversation);aiSessions=aiSessions.filter(x=>x.id!==aiActiveSessionId);AFStore.set('aiSessions',aiSessions);refreshAiHistory();draw();status.textContent='Current conversation cleared from this browser.';});
    form.addEventListener('submit',async e=>{
      e.preventDefault();
      const text=prompt.value.trim();if(!text)return;
      const prior=aiConversation.slice(-14).filter(m=>['user','assistant'].includes(m.role)).map(m=>({role:m.role,content:String(m.content).slice(0,3000)}));
      aiConversation.push({role:'user',content:text});AFStore.set('aiConversation',aiConversation);saveAiSession();prompt.value='';draw();
      const send=document.getElementById('aiSendBtn');send.disabled=true;send.textContent='Thinking\u2026';state.textContent='AF AI is thinking\u2026';status.textContent='Sending your message\u2026';
      try{
        const answer=await aiRequest([...prior,{role:'user',content:text}]);
        aiConversation.push({role:'assistant',content:answer});AFStore.set('aiConversation',aiConversation);saveAiSession();state.textContent='Connected \u00b7 response received';service.textContent='Online';status.textContent='Response received. This chat is saved in this browser.';
      }catch(err){
        aiConversation.push({role:'assistant',content:`AF AI could not complete that request. ${err.message}`});AFStore.set('aiConversation',aiConversation);saveAiSession();state.textContent='Connection problem';service.textContent='Offline';status.textContent=err.message;
      }finally{draw();send.disabled=false;send.textContent='Send \u2197';prompt.focus();}
    });
    prompt?.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();form.requestSubmit();}});
    draw();
  }

  function renderMovies(){
    const providers=[['YouTube','https://www.youtube.com/','Creator videos, trailers and free official content.','▶'],['PBS','https://www.pbs.org/','Documentaries and public media.','P'],['NASA+','https://plus.nasa.gov/','Science and space programming.','N'],['Internet Archive','https://archive.org/details/movies','A digital archive; check each item’s rights and access terms.','IA'],['Tubi','https://tubitv.com/','Ad-supported movies and series where available.','T'],['Pluto TV','https://pluto.tv/','Free ad-supported channels and on-demand shows.','P']];
    return `<div class="page-head"><div><div class="eyebrow">WATCH FROM OFFICIAL SOURCES</div><h1 class="page-title">Movies & media</h1><p class="page-subtitle">Launch official streaming services or play a video file stored on your Chromebook.</p></div></div><section class="panel movie-local-panel"><div><span class="tiny-label">ON THIS DEVICE</span><h2>Play your own video</h2><p>Choose a video file from your Chromebook. It stays in this browser session and is not uploaded.</p><label class="btn btn-primary" for="localMovieInput">Choose video file</label><input id="localMovieInput" type="file" accept="video/*" hidden></div><video id="localMovieVideo" controls playsinline hidden></video></section><div class="section-title-row"><div><h2 class="section-title">Streaming platforms</h2><p class="section-sub">Open the provider directly. Availability depends on the provider and your region.</p></div></div><div class="media-tiles">${providers.map(([name,url,desc,icon])=>`<a class="media-tile" href="${url}" target="_blank" rel="noopener noreferrer"><span class="provider-logo">${icon}</span><strong>${name} ↗</strong><small>${desc}</small></a>`).join('')}</div><div class="warning-note" style="margin-top:18px">AF Hub does not scrape, decrypt, or rehost copyrighted streams. Use official players and media you have permission to watch.</div>`;
  }
  let activeMovieUrl=null;
  function bindMoviesPage(){const input=document.getElementById('localMovieInput');input?.addEventListener('change',()=>{const file=input.files?.[0];if(!file)return;if(activeMovieUrl)URL.revokeObjectURL(activeMovieUrl);activeMovieUrl=URL.createObjectURL(file);const video=document.getElementById('localMovieVideo');video.src=activeMovieUrl;video.hidden=false;video.play().catch(()=>{});});}

  function renderAccount(){
    const cloud=window.AFCloud;
    if(!cloud){return `<div class="page-head"><div><div class="eyebrow">ACCOUNT CONNECTION</div><h1 class="page-title">My profile</h1><p class="page-subtitle">The Supabase connection module did not load.</p></div></div><div class="warning-note">Check your internet connection and confirm that the Supabase client CDN is available.</div>`;}
    if(!cloud.ready){return `<div class="page-head"><div><div class="eyebrow">ACCOUNT CONNECTION</div><h1 class="page-title">My profile</h1><p class="page-subtitle">Checking your secure account session…</p></div></div><section class="panel tool-card"><div class="loading-state"><div class="loader"></div><span>Connecting to Supabase…</span></div></section>`;}
    if(cloud.error&&!cloud.client){return `<div class="page-head"><div><div class="eyebrow">ACCOUNT CONNECTION</div><h1 class="page-title">My profile</h1><p class="page-subtitle">Supabase could not be initialized.</p></div></div><div class="warning-note">${U.esc(cloud.error.message||'The Supabase client library could not load.')}</div>`;}
    const user=cloud.user;
    if(!user){return `<div class="page-head"><div><div class="eyebrow">AF GAME HUB ACCOUNT</div><h1 class="page-title">Welcome to your hub.</h1><p class="page-subtitle">Sign in to sync your profile and personal data across devices.</p></div><span class="security-ready"><i></i> SECURE AUTH</span></div>
      <section class="panel account-auth-card">
        <div class="auth-tabs"><button class="auth-tab active" type="button" data-auth-tab="login">Sign in</button><button class="auth-tab" type="button" data-auth-tab="signup">Create account</button></div>
        <div id="authLoginPanel"><h2>Sign in</h2><p class="section-sub">Welcome back to AF Game Hub.</p><form id="authLoginForm" class="account-auth-form"><label class="field-label">Email address<input class="input" type="email" id="authLoginEmail" autocomplete="email" maxlength="254" required placeholder="you@example.com"></label><label class="field-label">Password<input class="input" type="password" id="authLoginPassword" autocomplete="current-password" minlength="8" required placeholder="Your password"></label><button class="btn btn-primary" type="submit">Sign in ↗</button></form></div>
        <div id="authSignupPanel" hidden><h2>Create your account</h2><p class="section-sub">Use an email address you can access to verify your account.</p><form id="authSignupForm" class="account-auth-form"><label class="field-label">Display name<input class="input" type="text" id="authSignupName" maxlength="40" minlength="1" required placeholder="Your display name"></label><label class="field-label">Email address<input class="input" type="email" id="authSignupEmail" autocomplete="email" maxlength="254" required placeholder="you@example.com"></label><label class="field-label">Password<input class="input" type="password" id="authSignupPassword" autocomplete="new-password" minlength="8" required placeholder="At least 8 characters"></label><button class="btn btn-primary" type="submit">Create account ↗</button></form></div>
        <p class="auth-status" id="authStatus" role="status" aria-live="polite">Your account is secured by Supabase Authentication.</p>
      </section>
      <p class="section-sub" style="margin-top:12px">By creating an account, you agree to use AF Game Hub respectfully. Never share your password or verification link.</p>`;}
    const meta=user.user_metadata||{};const fallbackName=meta.display_name||user.email?.split('@')[0]||'AF Hub user';const p=AFStore.get('profile',{name:fallbackName,about:''});const initials=fallbackName.trim().split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase();
    return `<div class="page-head"><div><div class="eyebrow">YOUR AF GAME HUB ACCOUNT</div><h1 class="page-title">My profile</h1><p class="page-subtitle">Your account is connected. Your private data is protected by database policies.</p></div><span class="security-ready"><i></i> SIGNED IN</span></div>
      <section class="panel account-profile-card"><div class="account-avatar">${U.esc(initials||'AF')}</div><div><span class="tiny-label">CLOUD ACCOUNT</span><h2>${U.esc(fallbackName)}</h2><p>${U.esc(user.email||'Verified account')}</p></div></section>
      <section class="panel settings-card account-edit-card"><h3>Profile details</h3><form id="cloudProfileForm" class="account-auth-form"><label class="field-label">Display name<input id="cloudDisplayName" class="input" maxlength="40" minlength="1" required value="${U.esc(meta.display_name||p.name||fallbackName)}"></label><label class="field-label">Username <span class="section-sub">Optional; 3–24 letters, numbers or underscores</span><input id="cloudUsername" class="input" maxlength="24" pattern="[A-Za-z0-9_]{3,24}" placeholder="your_username"></label><label class="field-label">About you<input id="cloudBio" class="input" maxlength="160" value="${U.esc(p.about||'')}" placeholder="A short optional bio"></label><button class="btn btn-primary" type="submit">Save cloud profile</button></form><p class="auth-status" id="profileStatus" role="status" aria-live="polite">Profile information is stored in your AF Hub account.</p></section>
      <section class="panel account-edit-card" style="margin-top:13px"><div class="section-title-row"><div><h3>Account session</h3><p class="section-sub">Signed in as ${U.esc(user.email||'')}</p></div><button class="btn btn-danger" id="authSignOutBtn" type="button">Sign out</button></div></section>`;
  }
  function bindAccountPage(){
    const cloud=window.AFCloud;
    if(!cloud)return;
    if(!cloud.ready){cloud.readyPromise.then(()=>{if(root.dataset.route==='account')renderRoute('account');});return;}
    const status=(id,message,type='')=>{const el=document.getElementById(id);if(el){el.textContent=message;el.className=`auth-status ${type}`;}};
    document.querySelectorAll('[data-auth-tab]').forEach(btn=>btn.addEventListener('click',()=>{
      const signup=btn.dataset.authTab==='signup';
      document.querySelectorAll('[data-auth-tab]').forEach(x=>x.classList.toggle('active',x===btn));
      document.getElementById('authLoginPanel').hidden=signup;
      document.getElementById('authSignupPanel').hidden=!signup;
      status('authStatus',signup?'Create an account with an email you can verify.':'Sign in with your AF Game Hub account.');
    }));
    document.getElementById('authLoginForm')?.addEventListener('submit',async e=>{
      e.preventDefault();const button=e.currentTarget.querySelector('button[type="submit"]');button.disabled=true;button.textContent='Signing in…';
      try{const email=document.getElementById('authLoginEmail').value.trim().toLowerCase();const password=document.getElementById('authLoginPassword').value;const {error}=await cloud.signIn(email,password);if(error)throw error;status('authStatus','Signed in successfully.','success');renderRoute('account');toast('Welcome back!','success');}
      catch(err){status('authStatus',err.message||'Sign-in failed. Check your details and try again.','error');}
      finally{if(button.isConnected){button.disabled=false;button.textContent='Sign in ↗';}}
    });
    document.getElementById('authSignupForm')?.addEventListener('submit',async e=>{
      e.preventDefault();const button=e.currentTarget.querySelector('button[type="submit"]');button.disabled=true;button.textContent='Creating account…';
      try{const displayName=document.getElementById('authSignupName').value.trim();const email=document.getElementById('authSignupEmail').value.trim().toLowerCase();const password=document.getElementById('authSignupPassword').value;if(displayName.length<1||displayName.length>40)throw new Error('Display name must be 1–40 characters.');if(password.length<8)throw new Error('Use a password with at least 8 characters.');const {data,error}=await cloud.signUp({email,password,displayName});if(error)throw error;if(data.session){status('authStatus','Your account is ready and you are signed in.','success');renderRoute('account');toast('AF Game Hub account created.','success');}else{status('authStatus','Account created. Check your email for the verification link, then return here and sign in.','success');document.getElementById('authSignupForm').reset();}}
      catch(err){status('authStatus',err.message||'Could not create the account. Please try again.','error');}
      finally{if(button.isConnected){button.disabled=false;button.textContent='Create account ↗';}}
    });
    document.getElementById('cloudProfileForm')?.addEventListener('submit',async e=>{
      e.preventDefault();const button=e.currentTarget.querySelector('button[type="submit"]');button.disabled=true;button.textContent='Saving…';
      try{const display_name=document.getElementById('cloudDisplayName').value.trim();const username=document.getElementById('cloudUsername').value.trim();const bio=document.getElementById('cloudBio').value.trim();if(display_name.length<1||display_name.length>40)throw new Error('Display name must be 1–40 characters.');if(username&&!/^[A-Za-z0-9_]{3,24}$/.test(username))throw new Error('Username must be 3–24 letters, numbers or underscores.');const row=await cloud.updateProfile({display_name,username,bio});AFStore.set('profile',{name:row.display_name,about:row.bio});syncAccountChrome();status('profileStatus','Your cloud profile has been saved.','success');toast('Cloud profile updated.','success');}
      catch(err){status('profileStatus',err.message||'Profile update failed.','error');}
      finally{if(button.isConnected){button.disabled=false;button.textContent='Save cloud profile';}}
    });
    document.getElementById('authSignOutBtn')?.addEventListener('click',async()=>{try{const {error}=await cloud.signOut();if(error)throw error;toast('You have signed out.');renderRoute('account');}catch(err){toast(err.message||'Could not sign out.','error');}});
    if(cloud.user){cloud.getProfile().then(row=>{if(!row)return;const name=document.getElementById('cloudDisplayName');const username=document.getElementById('cloudUsername');const bio=document.getElementById('cloudBio');if(name)name.value=row.display_name||'';if(username)username.value=row.username||'';if(bio)bio.value=row.bio||'';AFStore.set('profile',{name:row.display_name||'AF Hub user',about:row.bio||''});syncAccountChrome();}).catch(err=>status('profileStatus',`Profile could not be loaded: ${err.message}`,'error'));}
  }
  function syncAccountChrome(){
    const user=window.AFCloud?.user;const local=AFStore.get('profile',{name:'Personal profile'});const label=user?(user.user_metadata?.display_name||user.email?.split('@')[0]||'AF Hub user'):(local.name||'Personal profile');
    const side=document.getElementById('sideProfileName');if(side)side.textContent=label;
    const chip=document.getElementById('profileChip');if(chip){const text=chip.querySelector('span:nth-child(2)');if(text)text.textContent=label;chip.title=user?`Signed in: ${user.email}`:'Open your profile';}
    const small=document.querySelector('.sidebar-profile .profile-info small');if(small)small.textContent=user?'Cloud account connected':'Saved on this device';
  }



  function renderCommunity(){const messages=AFStore.get('localChatMessages',[]);return `<div class="page-head"><div><div class="eyebrow">COMMUNITY SPACE</div><h1 class="page-title">Chat & friends</h1><p class="page-subtitle">A local chat sandbox and the foundation for shared rooms.</p></div><span class="security-ready"><i></i> LOCAL PREVIEW</span></div><div class="chat-layout"><aside class="panel chat-room-list"><h3>Channels</h3><button class="chat-room active"># general</button><button class="chat-room" disabled># hangman <small>coming later</small></button><div class="section-sub" style="margin-top:20px">Friends and groups need account sign-in before they can be shared across devices.</div></aside><section class="panel chat-main"><div class="chat-main-head"><strong># general</strong><span>Only visible in this browser</span></div><div class="chat-messages-local" id="localChatMessages">${messages.length?messages.map(m=>`<div class="local-chat-message"><strong>${U.esc(m.name)}</strong><p>${U.esc(m.text)}</p><small>${new Date(m.at).toLocaleString()}</small></div>`).join(''):'<div class="empty-state"><div class="empty-icon">☷</div><h3>No local messages yet</h3><p>Send a test message to try the interface. It will not be sent to other people.</p></div>'}</div><form id="localChatForm" class="chat-compose"><input id="localChatInput" maxlength="500" class="input" placeholder="Write a local test message…" required><button class="btn btn-primary" type="submit">Send</button></form></section></div><div class="feature-grid" style="margin-top:15px"><section class="panel tool-card"><h3>Friends & direct messages</h3><p>Requires a secure account system, friend requests, blocking and private-message storage.</p><span class="tiny-label">BACKEND REQUIRED</span></section><section class="panel tool-card"><h3>Voice & video calls</h3><p>Requires authenticated signaling, WebRTC connection setup and privacy controls.</p><span class="tiny-label">BACKEND REQUIRED</span></section><section class="panel tool-card"><h3>Rooms & moderation</h3><p>Shared rooms need permissions, reporting, spam protection and active moderation.</p><span class="tiny-label">BACKEND REQUIRED</span></section></div>`;}
  function bindCommunityPage(){document.getElementById('localChatForm')?.addEventListener('submit',e=>{e.preventDefault();const input=document.getElementById('localChatInput');const text=input.value.trim();if(!text)return;const p=AFStore.get('profile',{name:'Me'});const list=AFStore.get('localChatMessages',[]);list.push({name:p.name||'Me',text,at:Date.now()});AFStore.set('localChatMessages',list.slice(-100));renderRoute('community');});}

  function renderCommunityLegacy(){return `<div class="page-head"><div><div class="eyebrow">AF COMMUNITY</div><h1 class="page-title">Community chat</h1><p class="page-subtitle">A shared community space that can be connected when a secure backend is ready.</p></div></div><div class="two-col"><section class="panel tool-card"><div class="empty-state"><div class="empty-icon">☷</div><h3>Community is not connected</h3><p>Shared chat needs secure sign-in, room permissions, reporting, moderation and clear data-handling rules. This local build does not send, receive or share community messages.</p><div class="warning-note">No shared accounts or chat messages are active. Local notes remain private to this browser.</div></div></section><aside class="panel tool-card"><h3>Safety features planned</h3><p>Before shared chat is enabled, the backend needs authenticated profiles, abuse reporting, rate limits, room controls, retention rules and an administrator moderation workflow.</p></aside></div>`;}
  function renderNotes(){const notes=AFStore.get('notes',[]);return `<div class="page-head"><div><div class="eyebrow">THINK • CAPTURE • RETURN</div><h1 class="page-title">Quick notes</h1><p class="page-subtitle">A scratchpad for ideas, reminders and assignment notes. Saved locally in this browser.</p></div><button class="btn btn-primary" data-action="note-new">＋ New note</button></div><div class="two-col"><section class="notes-editor panel" style="padding:16px"><div class="section-title-row" style="margin:0"><h2 class="section-title">Your notes</h2><span class="tiny-label">${notes.length} SAVED</span></div>${notes.length?notes.slice().reverse().map(n=>`<article class="note-card"><div style="display:flex;align-items:center;justify-content:space-between;gap:8px"><strong>${U.esc(n.title||'Untitled note')}</strong><div><button class="icon-btn" data-action="note-edit" data-id="${U.esc(n.id)}" title="Edit">✎</button><button class="icon-btn" data-action="note-remove" data-id="${U.esc(n.id)}" title="Delete">×</button></div></div><p>${U.esc(n.body)}</p><small class="section-sub">${new Date(n.updatedAt||Date.now()).toLocaleString()}</small></article>`).join(''):`<div class="empty-state"><div class="empty-icon">▤</div><h3>No notes yet</h3><p>Create a note to keep track of an idea or assignment.</p><button class="btn btn-primary" data-action="note-new">Create a note</button></div>`}</section><aside class="panel tool-card"><h3>Private by default</h3><p>Notes are stored in this browser's local storage. They are not uploaded to an account or shared with other people.</p><div class="warning-note">Export a backup from Settings before clearing browser data or changing devices.</div><button class="btn" style="margin-top:12px" data-action="route" data-route="settings">Backup settings</button></aside></div>`;}
  function noteDialog(note=null){dialog(`<div class="dialog-head"><div><div class="eyebrow">LOCAL NOTE</div><h2>${note?'Edit note':'New note'}</h2></div><button class="icon-button" data-action="close-dialog">×</button></div><div class="dialog-body"><label class="field-label">Title<input class="input" id="noteTitle" maxlength="80" value="${U.esc(note?.title||'')}" placeholder="Assignment notes"></label><label class="field-label">Note<textarea class="textarea" id="noteBody" maxlength="5000" placeholder="Write something…">${U.esc(note?.body||'')}</textarea></label><div class="dialog-actions"><button class="btn" data-action="close-dialog">Cancel</button><button class="btn btn-primary" id="noteSave">Save note</button></div></div>`);document.getElementById('noteSave').addEventListener('click',()=>{const title=document.getElementById('noteTitle').value.trim(),body=document.getElementById('noteBody').value.trim();if(!title&&!body){toast('Write something before saving.','error');return;}let list=AFStore.get('notes',[]);if(note)list=list.map(n=>n.id===note.id?{...n,title,body,updatedAt:Date.now()}:n);else list.push({id:U.id('note'),title,body,updatedAt:Date.now()});AFStore.set('notes',list);closeDialog();renderRoute('notes');toast('Note saved.','success');});}
  function renderSettings(){const s=AFStore.get('settings',{accent:'#ef3340',reduceMotion:false});const colors=['#ef3340','#7c65ed','#3b89ea','#14a987','#d28a28','#d45a9d','#f3b63f','#ffffff'];const privacy=AFStore.get('tabPrivacy',{preset:'AF Game Hub'});return `<div class="page-head"><div><div class="eyebrow">PERSONALIZE YOUR SPACE</div><h1 class="page-title">Settings</h1><p class="page-subtitle">Appearance, privacy, chat preferences and local data.</p></div></div><div class="settings-section-label">APPEARANCE</div><div class="settings-grid"><section class="panel settings-card"><h3>Accent color</h3><p>Choose the highlight color used across buttons and active navigation.</p><div class="swatches">${colors.map(c=>`<button class="swatch ${s.accent===c?'active':''}" data-accent="${c}" style="background:${c}" aria-label="Set accent ${c}"></button>`).join('')}</div><div class="toggle-row"><span>Reduce animations</span><input class="security-toggle" id="reduceMotionToggle" type="checkbox" ${s.reduceMotion?'checked':''}></div></section><section class="panel settings-card"><h3>Interface shape</h3><p>Choose how rounded panels and buttons appear.</p><select class="input" id="shapeSelect"><option value="rounded">Rounded</option><option value="square">Square</option><option value="pill">Pill</option></select><div class="toggle-row"><span>Animated background</span><input class="security-toggle" id="backgroundToggle" type="checkbox" ${s.background!==false?'checked':''}></div></section></div><div class="settings-section-label">TAB CLOAK</div><div class="settings-grid"><section class="panel settings-card"><h3>Disguise this tab</h3><p>Changes the browser tab title and icon so the tab reads like a school tool. Pick a disguise and it applies instantly.</p><label class="field-label">Disguise<select class="input" id="cloakPresetSelect">${(window.AFCloak?.presets||[]).map(p=>`<option value="${U.esc(p.id)}">${U.esc(p.name)}</option>`).join('')}<option value="off">Real tab (AF Game Hub)</option></select></label><div class="dialog-actions" style="justify-content:flex-start;margin-top:12px"><button class="btn btn-primary" id="cloakApplyBtn">Apply disguise</button><button class="btn" id="cloakPanicBtn">Panic switch</button></div><p class="section-sub" style="margin-top:10px">Panic key: Alt + X &mdash; swaps to your panic disguise in one keystroke.</p></section><section class="panel settings-card"><h3>Panic disguise</h3><p>The tab shown when you hit Alt + X. Make it something boring.</p><label class="field-label">Panic target<select class="input" id="cloakPanicSelect">${(window.AFCloak?.presets||[]).map(p=>`<option value="${U.esc(p.id)}">${U.esc(p.name)}</option>`).join('')}</select></label><h3 style="margin-top:18px">Privacy cover</h3><p>Full-page neutral screen while you step away.</p><button class="btn" id="settingsCoverBtn">Open privacy cover</button><p class="section-sub" style="margin-top:10px">Shortcut: Alt + Shift + P</p></section></div><div class="settings-section-label">PROXY</div><section class="panel settings-card"><h3>Relay address</h3><p>The in-app browser routes through a Wisp relay. If pages will not load, put a different relay here.</p><label class="field-label">Wisp URL<input class="input" id="wispUrlInput" type="url" spellcheck="false" placeholder="wss://anura.pro/wisp/"></label><div class="dialog-actions" style="justify-content:flex-start;margin-top:12px"><button class="btn btn-primary" id="wispSaveBtn">Save relay</button><button class="btn" id="wispResetBtn">Reset relay</button></div><p class="section-sub" style="margin-top:10px">Stored on this device only. Applies the next time the browser opens.</p></section><section class="panel settings-card"><h3>Rammerhead server</h3><p>Adds the Rammerhead lane. It needs a running Rammerhead server; leave it blank when the hub is hosted on its own Node server, which advertises one automatically.</p><label class="field-label">Server URL<input class="input" id="rhUrlInput" type="url" spellcheck="false" placeholder="https://your-rammerhead-host"></label><div class="dialog-actions" style="justify-content:flex-start;margin-top:12px"><button class="btn btn-primary" id="rhSaveBtn">Save server</button><button class="btn" id="rhResetBtn">Remove lane</button></div><p class="section-sub" style="margin-top:10px">The browser shows a Rammerhead button only when a server answers.</p></section><div class="settings-section-label">AI</div><section class="panel settings-card"><h3>Assistant endpoint</h3><p>AF AI tries the built-in hosted models first. Put your own OpenAI-compatible endpoint here to pin it instead &mdash; the hub then skips the public ones entirely.</p><label class="field-label">Endpoint URL<input class="input" id="aiEndpointInput" type="url" spellcheck="false" placeholder="https://api.example.com/v1/chat/completions"></label><label class="field-label">Model<input class="input" id="aiModelInput" type="text" spellcheck="false" placeholder="fast"></label><div class="dialog-actions" style="justify-content:flex-start;margin-top:12px"><button class="btn btn-primary" id="aiEndpointSaveBtn">Save endpoint</button><button class="btn" id="aiEndpointResetBtn">Use built-in</button></div><p class="section-sub" style="margin-top:10px">Leave blank to use the free hosted ladder.</p></section><div class="settings-section-label">CHAT</div><section class="panel settings-card"><h3>Notifications & safety</h3><p>Choose how the local chat preview behaves. Shared DMs and calls are not connected in this build.</p><div class="toggle-row"><span>Play a sound for new local messages</span><input class="security-toggle" id="dmSoundToggle" type="checkbox" ${s.dmSound?'checked':''}></div><div class="toggle-row"><span>Do Not Disturb</span><input class="security-toggle" id="dndToggle" type="checkbox" ${s.dnd?'checked':''}></div><button class="btn" style="margin-top:12px" data-action="route" data-route="community">Open chat</button></section><div class="settings-section-label">LOCAL DATA</div><div class="settings-grid"><section class="panel settings-card"><h3>Export or import data</h3><p>Back up bookmarks, playlists, settings, notes and local profile details. Audio files are stored separately and are not included.</p><div class="dialog-actions" style="justify-content:flex-start"><button class="btn btn-primary" data-action="export-data">↓ Export data</button><button class="btn" data-action="import-data">↑ Import data</button><input type="file" id="backupFile" accept="application/json" hidden></div></section><section class="panel settings-card"><h3>Clear local data</h3><p>Remove AF Hub's local settings and profile from this browser. This cannot be undone unless you made a backup.</p><button class="btn btn-danger" id="clearLocalDataBtn">Clear AF Hub data</button></section></div><div class="warning-note" style="margin-top:15px">AF Hub stores this profile and preferences in browser storage. It does not have the original Desync account, payment or synchronization servers.</div>`;}
  function bindSettings(){const wispInput=document.getElementById('wispUrlInput');if(wispInput){try{wispInput.value=localStorage.getItem('af.go.wisp')||'wss://anura.pro/wisp/';}catch{}}const rhInput=document.getElementById('rhUrlInput');if(rhInput){try{rhInput.value=localStorage.getItem('af.go.rh')||'';}catch{}}document.getElementById('rhSaveBtn')?.addEventListener('click',()=>{const v=String(rhInput?.value||'').trim().replace(/\/+$/,'');if(!/^https?:\/\//i.test(v)){toast('Enter an http:// or https:// address.','error');return;}try{localStorage.setItem('af.go.rh',v);}catch{}toast('Rammerhead server saved.','success');});document.getElementById('rhResetBtn')?.addEventListener('click',()=>{try{localStorage.removeItem('af.go.rh');}catch{}if(rhInput)rhInput.value='';toast('Rammerhead lane removed.','success');});document.getElementById('wispSaveBtn')?.addEventListener('click',()=>{const v=String(wispInput?.value||'').trim();if(!/^wss?:\/\//i.test(v)){toast('Enter a ws:// or wss:// address.','error');return;}try{localStorage.setItem('af.go.wisp',v);}catch{}toast('Relay saved.','success');});document.getElementById('wispResetBtn')?.addEventListener('click',()=>{try{localStorage.removeItem('af.go.wisp');}catch{}if(wispInput)wispInput.value='wss://anura.pro/wisp/';toast('Relay reset.','success');});const aiEndpointInput=document.getElementById('aiEndpointInput');const aiModelInput=document.getElementById('aiModelInput');if(aiEndpointInput){try{aiEndpointInput.value=localStorage.getItem('af.ai.endpoint')||'';}catch{}}if(aiModelInput){try{aiModelInput.value=localStorage.getItem('af.ai.model')||'';}catch{}}document.getElementById('aiEndpointSaveBtn')?.addEventListener('click',()=>{const endpoint=String(aiEndpointInput?.value||'').trim();const model=String(aiModelInput?.value||'').trim();if(endpoint&&!/^https?:\/\//i.test(endpoint)){toast('Enter an http:// or https:// endpoint.','error');return;}try{if(endpoint)localStorage.setItem('af.ai.endpoint',endpoint);else localStorage.removeItem('af.ai.endpoint');if(model)localStorage.setItem('af.ai.model',model);else localStorage.removeItem('af.ai.model');}catch{}aiLaneId=endpoint?'custom':'';toast(endpoint?'AI endpoint saved.':'AI using the built-in ladder.','success');});document.getElementById('aiEndpointResetBtn')?.addEventListener('click',()=>{try{localStorage.removeItem('af.ai.endpoint');localStorage.removeItem('af.ai.model');}catch{}if(aiEndpointInput)aiEndpointInput.value='';if(aiModelInput)aiModelInput.value='';aiLaneId='';toast('AI endpoint cleared.','success');});document.querySelectorAll('[data-accent]').forEach(b=>b.addEventListener('click',()=>{const s=AFStore.get('settings',{});s.accent=b.dataset.accent;AFStore.set('settings',s);applySettings();renderRoute('settings');}));const update=(key,value)=>{const s=AFStore.get('settings',{});s[key]=value;AFStore.set('settings',s);applySettings();};document.getElementById('reduceMotionToggle')?.addEventListener('change',e=>update('reduceMotion',e.target.checked));document.getElementById('backgroundToggle')?.addEventListener('change',e=>update('background',e.target.checked));document.getElementById('shapeSelect')?.addEventListener('change',e=>{document.documentElement.dataset.shape=e.target.value;update('shape',e.target.value);});const shape=AFStore.get('settings',{}).shape;if(shape)document.getElementById('shapeSelect').value=shape;document.getElementById('tabPresetSelect')?.addEventListener('change',()=>{});document.getElementById('saveTabPresetBtn')?.addEventListener('click',()=>{const preset=document.getElementById('tabPresetSelect')?.value;if(!preset)return;AFStore.set('tabPrivacy',{preset});applyTabAppearance();toast('Tab label preference applied.','success');});
    const cloak=window.AFCloak;
    if(cloak){
      const presetSel=document.getElementById('cloakPresetSelect');
      if(presetSel)presetSel.value=cloak.current()?.id||'off';
      document.getElementById('cloakApplyBtn')?.addEventListener('click',()=>{
        const id=presetSel?.value||'off';
        if(id==='off'){cloak.apply(null);applyTabAppearance();toast('Real tab restored.','success');return;}
        cloak.apply(cloak.find(id));
        toast('Disguise applied.','success');
      });
      document.getElementById('cloakPanicBtn')?.addEventListener('click',()=>{cloak.panic();toast('Panic switch fired.');});
      const panicSel=document.getElementById('cloakPanicSelect');
      if(panicSel)panicSel.value=cloak.getPanic();
      panicSel?.addEventListener('change',()=>{cloak.setPanic(panicSel.value);toast('Panic disguise saved.');});
    }document.getElementById('settingsCoverBtn')?.addEventListener('click',togglePrivacyCover);document.getElementById('dmSoundToggle')?.addEventListener('change',e=>update('dmSound',e.target.checked));document.getElementById('dndToggle')?.addEventListener('change',e=>update('dnd',e.target.checked));document.getElementById('clearLocalDataBtn')?.addEventListener('click',async()=>{if(!confirm('Clear AF Game Hub settings, profile, saved music list and imported audio from this browser? Make a backup first if you need anything.'))return;const backup=AFStore.exportAll();for(const key of Object.keys(backup))AFStore.remove(key);try{const audio=await AFStore.audio.all();await Promise.all(audio.map(track=>AFStore.audio.delete(track.id)));}catch{}applySettings();applyTabAppearance();renderRoute('home');toast('AF Hub local data and imported audio cleared.','success');});document.getElementById('backupFile')?.addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{const data=JSON.parse(await file.text());AFStore.importAll(data);applySettings();applyTabAppearance();renderRoute('home');toast('Backup imported.','success');}catch{toast('That backup file is not valid.','error');}});}
  function applyTabAppearance(){const c=window.AFCloak;if(c&&c.current())return;const p=AFStore.get('tabPrivacy',{preset:'AF Game Hub'});const names={'AF Game Hub':['AF Game Hub','assets/falcon.png'],'Calculator':['Calculator','assets/favicon.png'],'Notes':['Notes','assets/favicon.png'],'Calendar':['Calendar','assets/favicon.png']};const pair=names[p.preset]||names['AF Game Hub'];document.title=pair[0];let link=document.querySelector('link[rel~="icon"]');if(link)link.href=pair[1];}
  function togglePrivacyCover(){const cover=document.getElementById('privacyCover');if(!cover)return;cover.hidden=!cover.hidden;document.body.classList.toggle('privacy-covered',!cover.hidden);if(!cover.hidden){document.title='New Tab';}else applyTabAppearance();}
  function applySettings(){const s=AFStore.get('settings',{accent:'#ef3340',reduceMotion:false});document.documentElement.style.setProperty('--accent',s.accent||'#ef3340');document.documentElement.style.setProperty('--accent-2',s.accent||'#ff5963');document.body.classList.toggle('reduced-motion',!!s.reduceMotion);document.body.classList.toggle('no-background',s.background===false);if(s.shape)document.documentElement.dataset.shape=s.shape;const sec=AFStore.get('securitySettings',{trackerShield:true});navigator.serviceWorker?.controller?.postMessage({type:'AFHUB_SHIELD',enabled:sec.trackerShield!==false});navigator.serviceWorker?.ready?.then(reg=>reg.active?.postMessage({type:'AFHUB_SHIELD',enabled:sec.trackerShield!==false})).catch(()=>{});}
  function bindHomeSearch(){document.getElementById('heroSearchForm')?.addEventListener('submit',e=>{e.preventDefault();runGlobalSearch(document.getElementById('heroSearchInput').value,document.getElementById('homeSearchEngine')?.value||'duck');});}
  function runGlobalSearch(value,engine='duck'){
    const q=String(value||'').trim();if(!q)return;
    const lower=q.toLowerCase();
    const routeMatch=Object.entries(titles).find(([key,title])=>key===lower||title.toLowerCase()===lower);
    if(routeMatch){navigate(routeMatch[0]);return;}
    const game=AFGames.games.find(g=>g.title.toLowerCase().includes(lower));
    if(game){navigate('games');setTimeout(()=>{const input=document.getElementById('gameSearch');if(input){input.value=q;input.dispatchEvent(new Event('input'));}},80);return;}
    // Searches and addresses leave the hub through the /go/ workspace, never window.open.
    openWeb(q);
  }
  function focusAddDialog(){dialog(`<div class="dialog-head"><div><div class="eyebrow">FOCUS CHECKLIST</div><h2>Add a step</h2></div><button class="icon-button" data-action="close-dialog">×</button></div><div class="dialog-body"><label class="field-label">Task<input class="input" id="focusText" maxlength="110" placeholder="Read the assignment instructions"></label><div class="dialog-actions"><button class="btn" data-action="close-dialog">Cancel</button><button class="btn btn-primary" id="focusSave">Add step</button></div></div>`);document.getElementById('focusSave').addEventListener('click',()=>{const text=document.getElementById('focusText').value.trim();if(!text)return;const list=AFStore.get('focusItems',[]);list.push({text,done:false});AFStore.set('focusItems',list);closeDialog();renderRoute('study');});}
  function exportData(){const data=AFStore.exportAll();const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='af-game-hub-backup.json';a.click();URL.revokeObjectURL(url);toast('Backup exported.','success');}
  function importData(){document.getElementById('backupFile')?.click();}
  function resetSettings(){AFStore.set('settings',{accent:'#ef3340',reduceMotion:false});applySettings();renderRoute('settings');toast('Appearance reset.');}

  function handleAction(action,id,el){
    if(action==='route')return navigate(el.dataset.route);
    if(action==='web-open')return openWeb(el.dataset.url);
    if(action==='close-dialog')return closeDialog();
    if(action==='app-add')return addAppDialog();
    if(action==='app-remove'){AFStore.set('customApps',AFStore.get('customApps',[]).filter(x=>x.id!==id));renderRoute('apps');return toast('App shortcut removed.');}
    if(action==='game-launch')return AFGames.launch(id);
    if(action==='game-random')return AFGames.launchRandom();
    if(action==='game-favorite'){const added=AFGames.saveFav(id);renderRoute('games');return toast(added?'Added to favorites.':'Removed from favorites.');}
    if(action==='music-add-stream'||action.startsWith('music-'))return AFMusic.onAction(action,id,el);
    if(action==='note-new')return noteDialog();
    if(action==='note-edit'){const note=AFStore.get('notes',[]).find(n=>n.id===id);if(note)noteDialog(note);return;}
    if(action==='note-remove'){AFStore.set('notes',AFStore.get('notes',[]).filter(n=>n.id!==id));renderRoute('notes');return toast('Note deleted.');}
    if(action==='flashcard-quiz')return flashcardQuiz();
    if(action==='focus-add')return focusAddDialog();
    if(action==='focus-remove'){AFStore.set('focusItems',AFStore.get('focusItems',[]).filter((x,i)=>i!==Number(id)));renderRoute('study');return;}
    if(action==='export-data')return exportData();
    if(action==='import-data')return importData();
    if(action==='reset-settings')return resetSettings();
  }

  // Delegated actions keep dynamic pages compact and maintain one interaction path.
  document.addEventListener('click',e=>{
    const aiSession=e.target.closest('[data-ai-session]');if(aiSession){e.preventDefault();loadAiSession(aiSession.dataset.aiSession);return;}
    const nav=e.target.closest('[data-route-link]');if(nav){e.preventDefault();navigate(nav.dataset.routeLink);return;}
    const action=e.target.closest('[data-action]');if(action){e.preventDefault();handleAction(action.dataset.action,action.dataset.id,action);return;}
    if(e.target===document.getElementById('dialogLayer'))closeDialog();
  });
  document.getElementById('globalSearchForm').addEventListener('submit',e=>{e.preventDefault();runGlobalSearch(document.getElementById('globalSearch').value);});
  document.getElementById('themeQuickBtn').addEventListener('click',()=>{const s=AFStore.get('settings',{accent:'#ef3340'});const colors=['#ef3340','#7c65ed','#3b89ea','#14a987'];const i=colors.indexOf(s.accent||'#ef3340');s.accent=colors[(i+1)%colors.length];AFStore.set('settings',s);applySettings();toast('Accent color changed.');});
  document.getElementById('mobileMenuBtn').addEventListener('click',()=>document.getElementById('sidebar').classList.toggle('open'));
  document.getElementById('profileMenuBtn').addEventListener('click',()=>navigate('account'));
  document.getElementById('profileChip').addEventListener('click',()=>navigate('account'));
  window.addEventListener('afhub-auth-ready',()=>{syncAccountChrome();if(root.dataset.route==='account')renderRoute('account');});
  window.addEventListener('afhub-auth-change',()=>{syncAccountChrome();if(root.dataset.route==='account')renderRoute('account');});
  document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();document.getElementById('globalSearch').focus();}if(e.altKey&&e.shiftKey&&e.key.toLowerCase()==='p'){e.preventDefault();togglePrivacyCover();}if(e.key==='Escape'){closeDialog();document.getElementById('sidebar').classList.remove('open');}});
  window.addEventListener('hashchange',()=>renderRoute());
  const AF={toast,dialog,closeDialog,navigate,renderRoute,applySettings};window.AF=AF;
  applySettings();applyTabAppearance();syncAccountChrome();renderRoute();
})();
