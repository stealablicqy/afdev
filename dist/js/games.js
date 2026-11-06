(() => {
  'use strict';
  const U = window.AFUtil;
  const games = [
    { id:'game_2048', title:'2048', type:'built-in', category:'Puzzle', description:'Slide the tiles, combine matching numbers and reach 2048.', art:'assets/covers/2048.svg', tag:'BUILT IN', badge:'PUZZLE' },
    { id:'game_memory', title:'Memory Match', type:'built-in', category:'Puzzle', description:'Flip cards and find every matching pair.', art:'assets/covers/memory.svg', tag:'BUILT IN', badge:'BRAIN' },
    { id:'game_click', title:'Click Sprint', type:'built-in', category:'Arcade', description:'Hit the targets as fast as you can before time runs out.', art:'assets/covers/sprint.svg', tag:'BUILT IN', badge:'ARCADE' },
    { id:'game_words', title:'Word Scramble', type:'built-in', category:'Brain', description:'Unscramble mixed-up words in a quick solo challenge.', art:'assets/covers/words.svg', tag:'BUILT IN', badge:'BRAIN' },
    { id:'game_guess', title:'Guess the Tab', type:'built-in', category:'Quiz', description:'Practice spotting authentic website addresses and lookalikes.', art:'assets/covers/guess-tab.svg', tag:'AF ORIGINAL', badge:'DIGITAL SKILLS' },
    { id:'coolmath', title:'Coolmath Games', type:'web', category:'Web games', description:'Logic, puzzle and skill games in the browser.', art:'assets/covers/coolmath.svg', url:'https://www.coolmathgames.com/', tag:'WEB LIBRARY' },
    { id:'crazygames', title:'CrazyGames', type:'web', category:'Web games', description:'A large collection of browser games from their publisher.', art:'assets/covers/crazygames.svg', url:'https://www.crazygames.com/', tag:'WEB LIBRARY' },
    { id:'poki', title:'Poki', type:'web', category:'Web games', description:'Casual games you can play in a browser.', art:'assets/covers/poki.svg', url:'https://poki.com/', tag:'WEB LIBRARY' },
    { id:'scratch', title:'Scratch', type:'web', category:'Create', description:'Play projects and build your own interactive games.', art:'assets/covers/scratch.svg', url:'https://scratch.mit.edu/', tag:'CREATE' },
    { id:'itch', title:'itch.io Games', type:'web', category:'Indie', description:'Discover independent games and creative projects.', art:'assets/covers/itch.svg', url:'https://itch.io/games', tag:'INDIE' },
    { id:'gnmath', title:'GN-Math', type:'web', category:'Web games', description:'A separate browser-game collection. Availability varies.', art:'assets/covers/crazygames.svg', url:'https://gn-math.dev/', tag:'WEB LIBRARY' },
    { id:'chess', title:'Chess.com', type:'web', category:'Brain', description:'Chess puzzles, lessons and matches.', art:'assets/covers/chess.svg', url:'https://www.chess.com/', tag:'BRAIN' }
  ];
  const imageFallback = 'assets/af-mark.svg';
  let activeCleanup = null;
  function cleanup(){if(activeCleanup){activeCleanup();activeCleanup=null;}}
  const favorites = () => U ? AFStore.get('gameFavorites', []) : [];
  const isFav = id => favorites().includes(id);
  const saveFav = (id) => {
    const list = favorites();
    const next = list.includes(id) ? list.filter(x => x !== id) : [...list, id];
    AFStore.set('gameFavorites', next);
    return next.includes(id);
  };
  function card(game) {
    const fav = isFav(game.id);
    return `<article class="library-card">
      <div class="library-art"><img src="${U.esc(game.art || imageFallback)}" alt="" loading="lazy" onerror="this.src='${imageFallback}'"><span class="library-tag">${U.esc(game.tag || game.category)}</span></div>
      <div class="library-card-body"><div class="library-card-title"><strong>${U.esc(game.title)}</strong><button class="icon-btn fav-toggle ${fav?'is-fav':''}" data-action="game-favorite" data-id="${U.esc(game.id)}" aria-label="${fav?'Remove from':'Add to'} favorites">${fav?'♥':'♡'}</button></div>
      <p>${U.esc(game.description)}</p><div class="card-actions"><button class="btn btn-primary btn-sm" data-action="game-launch" data-id="${U.esc(game.id)}">${game.type==='built-in'?'Play now':'Open game site'} ↗</button></div></div></article>`;
  }
  function renderCatalog() {
    const fav = favorites();
    const recent = AFStore.get('recentGames', []);
    const favoritesHtml = games.filter(g => fav.includes(g.id));
    const recentHtml = recent.map(id => games.find(g => g.id === id)).filter(Boolean).slice(0, 4);
    return `<div class="page-head"><div><div class="eyebrow">PLAY • EXPLORE • CREATE</div><h1 class="page-title">Game library</h1><p class="page-subtitle">Quick games for a break, plus links to browser-game collections.</p></div><button class="btn btn-primary" data-action="game-launch" data-id="game_guess">✦ Play Guess the Tab</button></div>
      <div class="filter-row"><input class="input" id="gameSearch" type="search" placeholder="Search the game library…" aria-label="Search games"><div class="filter-chips" id="gameFilters"><button class="chip active" data-filter="All">All</button><button class="chip" data-filter="Puzzle">Puzzle</button><button class="chip" data-filter="Brain">Brain</button><button class="chip" data-filter="Arcade">Arcade</button><button class="chip" data-filter="Web games">Web games</button><button class="chip" data-filter="Create">Create</button></div></div>
      ${recentHtml.length?`<div class="section-title-row"><div><h2 class="section-title">Recently played</h2><p class="section-sub">Pick up where you left off.</p></div></div><div class="card-grid">${recentHtml.map(card).join('')}</div>`:''}
      ${favoritesHtml.length?`<div class="section-title-row"><div><h2 class="section-title">Your favorites</h2><p class="section-sub">Games you've saved on this device.</p></div></div><div class="card-grid">${favoritesHtml.map(card).join('')}</div>`:''}
      <div class="section-title-row"><div><h2 class="section-title">All games & collections</h2><p class="section-sub"><span id="gamesVisibleCount">${games.length}</span> experiences</p></div><span class="tiny-label">LOCAL + EXTERNAL</span></div>
      <div class="card-grid" id="gamesGrid">${games.map(card).join('')}</div>
      <p class="section-sub" style="margin-top:14px">External game sites open directly in a new tab. Their availability, content and privacy practices are controlled by those providers.</p>`;
  }
  function openExternal(url) {
    const safe = U.safeUrl(url);
    if (!safe) { AF.toast('That link is not a valid web address.', 'error'); return; }
    const win = window.open(safe, '_blank', 'noopener,noreferrer');
    if (!win) AF.toast('Your browser blocked the new tab. Allow pop-ups for this site to open it.', 'error');
  }
  function launch(id) {
    const game = games.find(g => g.id === id);
    if (!game) return;
    const recent = AFStore.get('recentGames', []).filter(x => x !== id);
    AFStore.set('recentGames', [id, ...recent].slice(0, 12));
    if (game.type === 'web') return openExternal(game.url);
    if (id === 'game_2048') return open2048();
    if (id === 'game_memory') return openMemory();
    if (id === 'game_click') return openClickSprint();
    if (id === 'game_words') return openWordScramble();
    if (id === 'game_guess') return startGuessGame();
  }
  function modalGame(title, body, size='wide') {
    cleanup();
    AF.dialog(`<div class="dialog-head"><div><div class="eyebrow">AF ARCADE</div><h2>${U.esc(title)}</h2></div><button class="icon-button" data-action="close-dialog" aria-label="Close">×</button></div><div class="dialog-body game-dialog ${size}">${body}</div>`);
  }

  function openMemory() {
    const icons = ['🌙','🎧','🚀','⭐','🎮','🍓','🌈','⚡'];
    const cards = [...icons,...icons].sort(() => Math.random()-.5);
    modalGame('Memory Match', `<div class="memory-head"><span id="memoryMoves">Moves: 0</span><span id="memoryPairs">Pairs: 0 / 8</span></div><div class="memory-grid">${cards.map((v,i)=>`<button class="memory-card" data-memory="${i}" data-value="${v}"><span>?</span></button>`).join('')}</div><p class="section-sub">Flip two cards and find every matching pair.</p><div class="dialog-actions"><button class="btn" data-action="game-launch" data-id="game_memory">Restart</button></div>`);
    let open=[];let moves=0;let pairs=0;let lock=false;let mismatchTimer=null;
    activeCleanup=()=>{if(mismatchTimer)clearTimeout(mismatchTimer);};
    document.querySelectorAll('[data-memory]').forEach(btn=>btn.addEventListener('click',()=>{
      if(lock||btn.classList.contains('matched')||btn.classList.contains('revealed'))return;
      btn.classList.add('revealed');btn.querySelector('span').textContent=btn.dataset.value;open.push(btn);
      if(open.length===2){moves++;document.getElementById('memoryMoves').textContent=`Moves: ${moves}`;if(open[0].dataset.value===open[1].dataset.value){open.forEach(x=>x.classList.add('matched'));pairs++;document.getElementById('memoryPairs').textContent=`Pairs: ${pairs} / 8`;open=[];if(pairs===8)AF.toast(`You matched all pairs in ${moves} moves!`,'success');}else{lock=true;const pair=open;mismatchTimer=setTimeout(()=>{pair.forEach(x=>{x.classList.remove('revealed');x.querySelector('span').textContent='?';});open=[];lock=false;mismatchTimer=null;},700);}}
    }));
  }
  function open2048() {
    let board=Array(16).fill(0),score=0,won=false;
    const spawn=()=>{const free=board.map((v,i)=>v===0?i:-1).filter(i=>i>=0);if(free.length){const i=free[Math.floor(Math.random()*free.length)];board[i]=Math.random()<.9?2:4;}};
    spawn();spawn();
    const draw=()=>{const b=document.getElementById('board2048');if(!b)return;b.innerHTML=board.map((v,i)=>`<div class="tile2048 v${v||0}">${v||''}</div>`).join('');document.getElementById('score2048').textContent=score;};
    const move=(dir)=>{const before=board.join(',');for(let line=0;line<4;line++){let ids=[];for(let j=0;j<4;j++){const r=dir==='up'?j:dir==='down'?3-j:line;const c=dir==='left'?j:dir==='right'?3-j:line;ids.push(r*4+c);}let arr=ids.map(i=>board[i]).filter(Boolean);for(let k=0;k<arr.length-1;k++){if(arr[k]===arr[k+1]){arr[k]*=2;score+=arr[k];arr.splice(k+1,1);if(arr[k]>=2048)won=true;}}while(arr.length<4)arr.push(0);ids.forEach((idx,k)=>board[idx]=arr[k]);}if(board.join(',')!==before){spawn();draw();if(won)AF.toast('2048! You reached the goal. Keep going!','success');else if(!board.some(v=>v===0))AF.toast('Board is full. Restart for a new round.','error');}};
    modalGame('2048', `<div class="game2048-head"><p>Join the numbers and reach 2048.</p><div>Score <strong id="score2048">0</strong></div></div><div class="board2048" id="board2048"></div><div class="game2048-controls"><button class="btn btn-sm" data-dir="up">↑</button><div><button class="btn btn-sm" data-dir="left">←</button><button class="btn btn-sm" data-dir="down">↓</button><button class="btn btn-sm" data-dir="right">→</button></div></div><div class="dialog-actions"><button class="btn" data-action="game-launch" data-id="game_2048">New game</button></div><p class="section-sub">Use your arrow keys or the buttons. Swipe support works on touchscreens.</p>`);
    draw();
    const key=(e)=>{const m={ArrowUp:'up',w:'up',ArrowDown:'down',s:'down',ArrowLeft:'left',a:'left',ArrowRight:'right',d:'right'};if(m[e.key]){e.preventDefault();move(m[e.key]);}};
    document.addEventListener('keydown',key);
    document.querySelectorAll('[data-dir]').forEach(b=>b.addEventListener('click',()=>move(b.dataset.dir)));
    const boardEl=document.getElementById('board2048');let start=null;boardEl.addEventListener('touchstart',e=>{start=[e.touches[0].clientX,e.touches[0].clientY];},{passive:true});boardEl.addEventListener('touchend',e=>{if(!start)return;const dx=e.changedTouches[0].clientX-start[0],dy=e.changedTouches[0].clientY-start[1];if(Math.max(Math.abs(dx),Math.abs(dy))>20)move(Math.abs(dx)>Math.abs(dy)?(dx>0?'right':'left'):(dy>0?'down':'up'));start=null;},{passive:true});
    activeCleanup=()=>document.removeEventListener('keydown',key);
  }
  function openClickSprint() {
    let left=15,score=0,active=false,timer=null;
    modalGame('Click Sprint', `<div class="sprint-top"><div><small>TIME LEFT</small><strong id="sprintTime">15</strong></div><div><small>YOUR SCORE</small><strong id="sprintScore">0</strong></div></div><div class="sprint-field" id="sprintField"><button class="sprint-start" id="sprintStart">Start round</button></div><p class="section-sub">Tap the target as many times as you can in 15 seconds.</p>`);
    const field=document.getElementById('sprintField');
    activeCleanup=()=>{if(timer)clearInterval(timer);active=false;};
    const spawn=()=>{field.innerHTML='<button class="sprint-target" id="sprintTarget" aria-label="Tap target"></button>';const target=document.getElementById('sprintTarget');target.style.left=`${8+Math.random()*76}%`;target.style.top=`${8+Math.random()*76}%`;target.addEventListener('click',()=>{if(!active)return;score++;document.getElementById('sprintScore').textContent=score;spawn();});};
    document.getElementById('sprintStart').addEventListener('click',()=>{if(active)return;active=true;score=0;left=15;document.getElementById('sprintScore').textContent='0';spawn();timer=setInterval(()=>{left--;document.getElementById('sprintTime').textContent=left;if(left<=0){clearInterval(timer);active=false;field.innerHTML=`<div class="sprint-result"><strong>${score} hits</strong><small>Round complete</small><button class="btn btn-primary" id="sprintAgain">Play again</button></div>`;document.getElementById('sprintAgain').addEventListener('click',openClickSprint);}},1000);});
  }
  function openWordScramble() {
    const words=[['planet','A world that orbits a star'],['library','A place to borrow books'],['triangle','A shape with three sides'],['browser','An app used to visit websites'],['science','A way of studying the natural world'],['keyboard','An input device with keys'],['puzzle','A problem you solve for fun']];
    let index=Math.floor(Math.random()*words.length),score=0,answered=false,revealTimer=null;
    const scramble=w=>w.split('').sort(()=>Math.random()-.5).join('').toUpperCase();
    const render=()=>{const [word,hint]=words[index];document.getElementById('scrambleLetters').textContent=scramble(word);document.getElementById('scrambleHint').textContent=hint;document.getElementById('scrambleAnswer').value='';document.getElementById('scrambleScore').textContent=score;document.getElementById('scrambleFeedback').textContent='';answered=false;};
    modalGame('Word Scramble', `<div class="scramble-score">Score <strong id="scrambleScore">0</strong></div><div class="scramble-letters" id="scrambleLetters"></div><p class="section-sub" id="scrambleHint"></p><input class="input" id="scrambleAnswer" placeholder="Type the word" autocomplete="off"><p id="scrambleFeedback" class="quiz-feedback"></p><div class="dialog-actions"><button class="btn" data-action="scramble-skip">Skip</button><button class="btn btn-primary" data-action="scramble-check">Check answer</button></div>`);
    activeCleanup=()=>{if(revealTimer)clearTimeout(revealTimer);};
    render();
    document.getElementById('scrambleAnswer').addEventListener('keydown',e=>{if(e.key==='Enter')document.querySelector('[data-action="scramble-check"]').click();});
    document.querySelector('[data-action="scramble-check"]').addEventListener('click',()=>{if(answered)return;const answer=document.getElementById('scrambleAnswer').value.trim().toLowerCase();if(answer===words[index][0]){score++;document.getElementById('scrambleFeedback').textContent='Correct! Nice work.';document.getElementById('scrambleScore').textContent=score;answered=true;revealTimer=setTimeout(()=>{if(!document.getElementById('scrambleLetters'))return;index=(index+1)%words.length;render();revealTimer=null;},700);}else document.getElementById('scrambleFeedback').textContent='Not quite. Try again!';});
    document.querySelector('[data-action="scramble-skip"]').addEventListener('click',()=>{index=(index+1)%words.length;render();});
  }

  const tabRounds = [
    {q:'Which address is the real Google Classroom website?',hint:'Look closely at the actual domain ending.',answer:0,options:[['Google Classroom','https://classroom.google.com/','G'],['Google Classroom','https://google-classroom.school-login.example/','G'],['Google Classroom','https://classroom.google.signin.example/','G']],why:'Google Classroom is hosted at classroom.google.com. The important part is the actual domain: google.com.'},
    {q:'Which address is the real Khan Academy website?',hint:'A familiar name inside a longer address can be misleading.',answer:1,options:[['Khan Academy','https://khanacademy.learn.example/','K'],['Khan Academy','https://www.khanacademy.org/','K'],['Khan Academy','https://khan-academy.account.example/','K']],why:'Khan Academy uses khanacademy.org. The registered domain is the part immediately before the first single slash after the host.'},
    {q:'Which address is the real Wikipedia website?',hint:'Check the spelling and the top-level domain.',answer:2,options:[['Wikipedia','https://wikipedia.help-center.example/','W'],['Wikipedia','https://wikipediа.org/','W'],['Wikipedia','https://www.wikipedia.org/','W']],why:'Wikipedia uses wikipedia.org. Look out for extra words and characters that resemble normal letters.'},
    {q:'Which address is the real Microsoft Teams website?',hint:'One option uses the official Microsoft domain.',answer:0,options:[['Microsoft Teams','https://teams.microsoft.com/','M'],['Microsoft Teams','https://microsoft-teams.school.example/','M'],['Microsoft Teams','https://teams.microsoft.login.example/','M']],why:'The official Teams web app is on teams.microsoft.com. A trusted brand name elsewhere in a URL does not make the site official.'},
    {q:'Which address is the real Scratch website?',hint:'Look for the exact site domain.',answer:1,options:[['Scratch','https://scratch-game.example/','S'],['Scratch','https://scratch.mit.edu/','S'],['Scratch','https://mit-scratch.account.example/','S']],why:'Scratch is hosted at scratch.mit.edu. Always inspect the real host before entering account details.'}
  ];
  function startGuessGame() {
    let round=0,score=0,locked=false;
    function render(){
      const r=tabRounds[round];
      modalGame('Guess the Tab', `<div class="quiz-progress"><strong>ROUND ${round+1} / ${tabRounds.length}</strong><div class="quiz-progress-line"><span style="width:${(round/tabRounds.length)*100}%"></span></div><span>${score} correct</span></div><div class="quiz-card"><h3 class="quiz-question">${U.esc(r.q)}</h3><p class="quiz-hint">${U.esc(r.hint)}</p>${r.options.map((o,i)=>`<button class="tab-option" data-guess="${i}"><span class="tab-favicon">${U.esc(o[2])}</span><span class="tab-option-text"><strong>${U.esc(o[0])}</strong><small>${U.esc(o[1])}</small></span><span class="option-mark">↗</span></button>`).join('')}<p class="quiz-feedback" id="guessFeedback">Choose the address you believe is authentic.</p><div class="quiz-actions"><span class="muted" style="font-size:9px">No passwords or real accounts are used.</span><button class="btn btn-primary" id="guessNext" disabled>${round===tabRounds.length-1?'See results':'Next round'} →</button></div></div>`);
      locked=false;
      document.querySelectorAll('[data-guess]').forEach(btn=>btn.addEventListener('click',()=>{
        if(locked)return;locked=true;const choice=Number(btn.dataset.guess);const good=choice===r.answer;if(good)score++;
        document.querySelectorAll('[data-guess]').forEach((b,i)=>{b.disabled=true;if(i===r.answer)b.classList.add('correct');else if(i===choice)b.classList.add('incorrect');});
        document.getElementById('guessFeedback').textContent=(good?'Correct! ':'Not quite. ')+r.why;
        document.getElementById('guessNext').disabled=false;
      }));
      document.getElementById('guessNext').addEventListener('click',()=>{round++;if(round>=tabRounds.length){AFStore.set('guessBest',Math.max(score,AFStore.get('guessBest',0)));modalGame('Your results', `<div class="quiz-score"><strong>${score} / ${tabRounds.length}</strong><p>${score===5?'Perfect score!':score>=3?'Nice work — keep checking the exact domain.':'Good practice. Review the explanations and try again.'}</p><button class="btn btn-primary" id="guessRestart">Play again</button></div><div class="dialog-actions"><button class="btn" data-action="close-dialog">Close</button></div>`);document.getElementById('guessRestart').addEventListener('click',()=>{round=0;score=0;render();});}else render();});
    }
    render();
  }

  window.AFGames = { games, renderCatalog, launch, saveFav, startGuessGame, cleanup };
})();
