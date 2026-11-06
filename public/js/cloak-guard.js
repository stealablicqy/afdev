/* Screen guard — the part of the cloak that classroom monitoring actually sees.
   Title and favicon swaps only change the tab label. Hapara Highlights and
   GoGuardian read more than the label: they pull document text from content
   scripts and grab periodic screenshots of the rendered tab. This module covers
   both surfaces.

   What it does
     - On hide / blur / print, the whole hub UI goes inert and display:none, so
       document.body.innerText comes back empty for any extension reading it.
     - A full stand-in page is painted over the viewport, branded to match the
       active disguise, so a timer screenshot captures a school tool.
     - Title and favicon move to the same disguise at the same instant.
     - Audio is muted while covered and restored on return.
     - The cover tab opens a real about:blank decoy with its own painted document,
       its own title and its own favicon, and takes the foreground.

   What it cannot do
     - It does not change the address bar. Nothing in a page can. Keep the cover
       tab in front if the URL itself is the thing being looked at.
     - It does not stop a network log or a DNS log on the school's own router.
     - It does not defeat a screenshot taken while you are actively using the hub
       in the foreground. That is what the cover tab and Alt+X are for. */

(function () {
  "use strict";

  const GUARD_ATTR = "data-afguard";
  const ENTER_MS = 140;
  const PANIC_HOLD_MS = 180000;

  let engaged = false;
  let locked = false;
  let lockTimer = 0;
  let blurTimer = 0;
  let iframeGuardUntil = 0;
  let layer = null;
  let coverWin = null;
  let mutedBefore = false;
  let savedTitle = "";
  let savedIcon = "";
  let savedPreset = null;
  let savedPresetKnown = false;

  const esc = (v) =>
    String(v ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );

  /* ---------------------------------------------------------------- styles */

  const BASE_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;overflow:hidden}
body{font:14px/1.45 "Google Sans",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  background:#f8f9fa;color:#202124;-webkit-font-smoothing:antialiased;overflow:auto}
a{color:inherit;text-decoration:none}
.top{height:64px;display:flex;align-items:center;gap:16px;padding:0 20px;background:#fff;
  border-bottom:1px solid #e0e0e0;position:sticky;top:0;z-index:5}
.brand{font-size:21px;font-weight:500;letter-spacing:-.2px;white-space:nowrap}
.brand b{font-weight:700}
.grow{flex:1}
.av{width:32px;height:32px;border-radius:50%;background:#1a73e8;color:#fff;display:grid;
  place-items:center;font-size:12px;font-weight:600;flex:0 0 auto}
.rnd{width:40px;height:40px;border-radius:50%;display:grid;place-items:center;color:#5f6368;font-size:17px}
.shell{display:flex;min-height:calc(100% - 64px)}
.side{width:250px;flex:0 0 250px;padding:10px 8px;background:#fff}
.side .it{display:flex;align-items:center;gap:16px;padding:9px 14px;border-radius:0 24px 24px 0;
  font-weight:500;color:#3c4043;font-size:13.5px}
.side .it.on{background:#e8f0fe;color:#1967d2}
.side .it i{width:18px;text-align:center;font-style:normal;font-size:15px}
.main{flex:1;padding:22px 26px;min-width:0;background:#f8f9fa}
.h1{font-size:21px;font-weight:500;margin-bottom:2px}
.meta{color:#5f6368;font-size:11.5px}
.card{background:#fff;border:1px solid #e0e0e0;border-radius:8px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(258px,1fr));gap:16px;margin-top:18px}
.cc{border-radius:8px;overflow:hidden;border:1px solid #e0e0e0;background:#fff}
.cc .cap{height:84px;padding:14px 16px;color:#fff;display:flex;flex-direction:column;
  justify-content:space-between}
.cc .cap h3{font-size:17px;font-weight:500;line-height:1.2;text-overflow:ellipsis;overflow:hidden;
  white-space:nowrap}
.cc .cap span{font-size:11.5px;opacity:.85}
.cc .body{padding:12px 16px 18px}
.cc .body strong{display:block;font-size:12.5px;font-weight:500}
.cc .body small{color:#5f6368;font-size:11.5px}
.btn{height:36px;padding:0 18px;border-radius:4px;background:#1a73e8;color:#fff;font-size:13.5px;
  font-weight:500;display:inline-flex;align-items:center;border:0;font-family:inherit}
.btn.ghost{background:#fff;color:#1a73e8;border:1px solid #dadce0}
.btn.sm{height:30px;padding:0 12px;font-size:12.5px}
`;

  /* --------------------------------------------------------------- decoys */

  function classroomTop() {
    return `<div class="top">
      <div class="rnd">&#9776;</div>
      <div class="brand"><b style="color:#5f6368">Google</b> Classroom</div>
      <div class="grow"></div>
      <div class="rnd">+</div>
      <div class="rnd">&#8942;</div>
      <div class="av">JD</div>
    </div>`;
  }

  function classCard(title, section, teacher, color, letter) {
    return `<div class="cc">
      <div class="cap" style="background:${color}">
        <h3>${esc(title)}</h3><span>${esc(section)}</span>
      </div>
      <div class="body"><strong>${esc(teacher)}</strong><small>Period ${letter}</small></div>
    </div>`;
  }

  const DECOYS = {
    classroom: `<div class="top">
        <div class="rnd">&#9776;</div>
        <div class="brand"><b style="color:#5f6368">Google</b> Classroom</div>
        <div class="grow"></div>
        <div class="rnd">+</div>
        <div class="rnd">&#8942;</div>
        <div class="av">JD</div>
      </div>
      <div class="shell">
        <div class="side">
          <div class="it on"><i>&#9965;</i> Classes</div>
          <div class="it"><i>&#9873;</i> Calendar</div>
          <div class="it"><i>&#9993;</i> To review</div>
          <div class="it"><i>&#9634;</i> Archived classes</div>
          <div class="it"><i>&#9881;</i> Settings</div>
        </div>
        <div class="main">
          <div class="h1">Classes</div>
          <div class="meta">Semester 2 &middot; 2026</div>
          <div class="grid">
            ${classCard("Algebra II &mdash; Period 3", "Room 214", "Ms. Alvarez", "#0f9d58", "3")}
            ${classCard("English Literature", "Room 117", "Mr. Whitfield", "#4285f4", "2")}
            ${classCard("AP Biology", "Lab 2B", "Dr. Nakamura", "#db4437", "5")}
            ${classCard("World History", "Room 208", "Mr. Okafor", "#f4b400", "1")}
            ${classCard("Spanish III", "Room 130", "Sra. Delgado", "#a142f4", "4")}
            ${classCard("Physical Education", "Gym B", "Coach Brennan", "#00acc1", "6")}
          </div>
        </div>
      </div>`,

    docs: `<div class="top" style="height:64px;background:#f9fbfd;gap:10px">
        <div style="font-size:20px;color:#4285f4">&#128196;</div>
        <div style="display:flex;flex-direction:column;line-height:1.15">
          <div style="font-size:16px;font-weight:500">Unit 6 Study Guide</div>
          <div style="display:flex;gap:12px;font-size:12px;color:#444746">
            <span>File</span><span>Edit</span><span>View</span><span>Insert</span>
            <span>Format</span><span>Tools</span><span>Extensions</span><span>Help</span>
          </div>
        </div>
        <div class="grow"></div>
        <div class="rnd" style="font-size:13px">&#128337;</div>
        <div style="background:#c2e7ff;border-radius:20px;padding:0 16px;height:36px;display:flex;
          align-items:center;gap:6px;font-size:13.5px;font-weight:500">&#128274; Share</div>
        <div class="av">JD</div>
      </div>
      <div style="height:38px;background:#edf2fa;border-bottom:1px solid #dadce0;display:flex;
        align-items:center;gap:18px;padding:0 20px;color:#444746;font-size:14px">
        <span>100%</span><span>Normal text</span><span>Arial</span><span>11</span>
        <span><b>B</b></span><span><i>I</i></span><span><u>U</u></span><span>&#8801;</span>
        <span>&#128279;</span><span>&#128172;</span>
      </div>
      <div style="background:#f9fbfd;padding:26px 0 60px;min-height:calc(100% - 102px)">
        <div style="width:816px;max-width:92%;margin:0 auto;background:#fff;border:1px solid #dadce0;
          border-radius:2px;padding:72px 88px 96px;box-shadow:0 1px 3px rgba(60,64,67,.15)">
          <div style="font-size:26px;font-weight:400;margin-bottom:20px">Unit 6 Study Guide</div>
          <p style="font-size:11pt;line-height:1.6;margin-bottom:14px">
            <b>Section 6.1 &mdash; Quadratic Functions</b></p>
          <p style="font-size:11pt;line-height:1.6;margin-bottom:14px;color:#202124">
            A quadratic function is a function that can be written in the form
            f(x) = ax&sup2; + bx + c, where a &ne; 0. The graph of a quadratic function is a
            parabola. When a &gt; 0 the parabola opens upward and the vertex is a minimum.
            When a &lt; 0 the parabola opens downward and the vertex is a maximum.</p>
          <p style="font-size:11pt;line-height:1.6;margin-bottom:14px;color:#202124">
            The axis of symmetry is the vertical line x = &minus;b / 2a. The vertex lies on this
            line, so its x-coordinate is &minus;b / 2a. Substitute that value back into the
            function to find the y-coordinate of the vertex.</p>
          <p style="font-size:11pt;line-height:1.6;margin-bottom:14px">
            <b>Section 6.2 &mdash; Factoring</b></p>
          <p style="font-size:11pt;line-height:1.6;margin-bottom:14px;color:#202124">
            To factor x&sup2; + bx + c, find two numbers whose product is c and whose sum is b.
            Always check for a greatest common factor first. Remember to verify your work by
            expanding the factored form.</p>
          <p style="font-size:11pt;line-height:1.6;color:#5f6368">
            <i>Practice problems: p. 341 #1&ndash;24 odd, p. 348 #3&ndash;18 odd.</i></p>
        </div>
      </div>`,

    drive: `<div class="top" style="background:#f8fafd;border-bottom:1px solid #e0e0e0">
        <div class="rnd">&#9776;</div>
        <div class="brand"><b style="color:#5f6368">Google</b> Drive</div>
        <div style="flex:1;max-width:720px;margin:0 24px;height:46px;background:#e9eef6;
          border-radius:24px;display:flex;align-items:center;padding:0 18px;color:#5f6368">
          &#128269;&nbsp;Search in Drive
        </div>
        <div class="grow"></div>
        <div class="rnd">&#9881;</div>
        <div class="av">JD</div>
      </div>
      <div class="shell">
        <div class="side" style="background:#f8fafd">
          <div style="padding:8px 0 14px"><span class="btn" style="height:40px;border-radius:24px;
            padding:0 22px">+ New</span></div>
          <div class="it on"><i>&#128193;</i> My Drive</div>
          <div class="it"><i>&#128101;</i> Shared with me</div>
          <div class="it"><i>&#128337;</i> Recent</div>
          <div class="it"><i>&#11088;</i> Starred</div>
          <div class="it"><i>&#128465;</i> Trash</div>
          <div class="it"><i>&#9723;</i> Storage &mdash; 6.4 GB of 15 GB</div>
        </div>
        <div class="main" style="background:#fff">
          <div class="h1" style="font-size:15px;color:#444746">Suggested files</div>
          <div class="grid">
            ${["Unit 6 Study Guide.docx", "Lab Report &mdash; Osmosis.pdf", "Essay Draft 2.docx", "Semester Notes.pdf"]
              .map(
                (n) => `<div class="card" style="padding:14px 16px;display:flex;gap:12px;align-items:center">
                  <div style="width:34px;height:34px;border-radius:4px;background:#e8f0fe;display:grid;
                    place-items:center;color:#1a73e8">&#128196;</div>
                  <div style="min-width:0"><div style="font-size:13px;font-weight:500;overflow:hidden;
                    text-overflow:ellipsis;white-space:nowrap">${n}</div>
                    <div class="meta">Edited yesterday</div></div>
                </div>`
              )
              .join("")}
          </div>
        </div>
      </div>`,

    ixl: `<div class="top" style="background:#fff;border-bottom:2px solid #ff8b00">
        <div class="brand" style="color:#ff8b00;font-weight:700;font-size:24px">IXL</div>
        <div class="grow"></div>
        <div style="display:flex;gap:22px;font-size:13.5px;color:#333;font-weight:500">
          <span>Learning</span><span>Analytics</span><span>Diagnostic</span><span>Resources</span>
        </div>
        <div class="grow"></div>
        <div class="av" style="background:#ff8b00">JD</div>
      </div>
      <div style="max-width:900px;margin:0 auto;padding:44px 24px">
        <div class="meta" style="font-size:13px">Algebra 2 &rsaquo; BB.4 Solve a quadratic equation by factoring</div>
        <div style="font-size:15px;color:#444;margin:18px 0 8px">A rectangle has an area of
          <b>x&sup2; + 7x + 12</b> square units. Which expression gives its length if the width is
          <b>(x + 3)</b> units?</div>
        <div style="display:flex;gap:18px;align-items:center;margin:22px 0 30px">
          <div style="font-size:30px;font-weight:600;color:#ff8b00">x + 4</div>
        </div>
        <div style="display:grid;gap:12px;max-width:420px">
          ${["x + 4", "x + 9", "x + 3", "x + 12"]
            .map(
              (o, i) => `<div style="border:1px solid #d7dbe0;border-radius:8px;padding:14px 18px;
                font-size:15px;${i === 0 ? "border-color:#ff8b00;background:#fff8ef;font-weight:600" : ""}">
                ${o}</div>`
            )
            .join("")}
        </div>
        <div style="margin-top:26px;display:flex;gap:14px">
          <span class="btn" style="background:#ff8b00">Submit</span>
          <span class="btn ghost" style="border-color:#d7dbe0;color:#555">Explanation</span>
        </div>
        <div class="meta" style="margin-top:34px">SmartScore 82 &middot; 14 questions answered</div>
      </div>`,

    quizlet: `<div class="top" style="background:#4255ff;border:0;color:#fff">
        <div class="brand" style="font-weight:700">Quizlet</div>
        <div class="grow"></div>
        <div style="display:flex;gap:20px;font-size:13.5px;font-weight:500">
          <span>Home</span><span>Library</span><span>Create</span>
        </div>
        <div class="grow"></div>
        <div class="av" style="background:#fff;color:#4255ff">JD</div>
      </div>
      <div style="max-width:860px;margin:0 auto;padding:44px 24px">
        <div style="display:flex;justify-content:space-between;align-items:flex-end">
          <div>
            <div class="h1" style="font-size:24px">Biology Unit 6 &mdash; Cell Division</div>
            <div class="meta">28 terms &middot; Juno Alvarez</div>
          </div>
          <div class="meta">Card 7 of 28</div>
        </div>
        <div style="margin-top:30px;background:#fff;border:1px solid #d9dde3;border-radius:14px;
          min-height:300px;display:grid;place-items:center;padding:40px;text-align:center">
          <div>
            <div style="font-size:13px;color:#939bb4;letter-spacing:.8px;font-weight:600">TERM</div>
            <div style="font-size:30px;font-weight:600;margin-top:16px">Mitosis</div>
          </div>
        </div>
        <div style="display:flex;justify-content:center;gap:14px;margin-top:22px">
          <span class="btn ghost" style="border-color:#d9dde3;color:#4255ff">Don't know</span>
          <span class="btn" style="background:#4255ff">Know</span>
        </div>
        <div style="margin-top:36px;max-width:620px;margin-left:auto;margin-right:auto;
          display:grid;gap:10px">
          ${["Prophase", "Metaphase", "Anaphase", "Telophase"]
            .map(
              (t) => `<div style="display:flex;justify-content:space-between;padding:11px 16px;
                background:#fff;border:1px solid #eceef4;border-radius:8px">
                <span style="font-size:13.5px">${t}</span><span class="meta">stage</span></div>`
            )
            .join("")}
        </div>
      </div>`,

    canvas: `<div class="top" style="background:#fff;border-bottom:1px solid #e5e5e5">
        <div class="brand" style="color:#e0342b;font-weight:700">canvas</div>
        <div class="grow"></div>
        <div style="display:flex;gap:18px;font-size:13px;color:#555">
          <span>Dashboard</span><span>Courses</span><span>Calendar</span><span>Inbox</span>
        </div>
        <div class="grow"></div>
        <div class="av" style="background:#e0342b">JD</div>
      </div>
      <div class="shell">
        <div class="side" style="border-right:1px solid #eee">
          <div class="it on"><i>&#9638;</i> Dashboard</div>
          <div class="it"><i>&#128197;</i> Calendar</div>
          <div class="it"><i>&#9993;</i> Inbox</div>
          <div class="it"><i>&#128218;</i> Courses</div>
        </div>
        <div class="main" style="background:#fff">
          <div class="h1" style="color:#e0342b">Dashboard</div>
          <div class="meta">Spring 2026</div>
          <div class="grid">
            ${[
              ["AP Biology", "#e0342b"],
              ["Algebra II", "#0f9d58"],
              ["World History", "#f4b400"],
              ["English Literature", "#4285f4"],
            ]
              .map(
                ([n, c]) => `<div class="cc" style="border-color:#eee">
                  <div class="cap" style="background:${c};height:70px"><h3>${n}</h3></div>
                  <div class="body"><strong>3 assignments due</strong>
                    <small>Next due Friday, 11:59 PM</small></div></div>`
              )
              .join("")}
          </div>
        </div>
      </div>`,

    khan: `<div class="top" style="background:#fff;border-bottom:1px solid #e5e5e5">
        <div class="brand" style="color:#14bf96;font-weight:700">Khan Academy</div>
        <div class="grow"></div>
        <div style="display:flex;gap:20px;font-size:13px;color:#333">
          <span>Courses</span><span>Search</span><span>Donate</span>
        </div>
        <div class="grow"></div>
        <div class="av" style="background:#14bf96">JD</div>
      </div>
      <div style="max-width:960px;margin:0 auto;padding:40px 24px">
        <div class="h1" style="font-size:26px">Algebra 2</div>
        <div class="meta">Unit 6: Quadratic equations &middot; 7 of 12 skills mastered</div>
        <div style="height:8px;background:#e6e6e6;border-radius:4px;margin:18px 0 30px;overflow:hidden">
          <div style="width:58%;height:100%;background:#14bf96"></div>
        </div>
        <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr))">
          ${[
            ["Solve by factoring", "4 questions", "#14bf96"],
            ["Complete the square", "6 questions", "#1b9c82"],
            ["Quadratic formula", "3 questions", "#0f8f78"],
            ["Graphing parabolas", "5 questions", "#14bf96"],
          ]
            .map(
              ([t, s, c]) => `<div class="card" style="padding:18px">
                <div style="font-size:14px;font-weight:600;margin-bottom:6px">${t}</div>
                <div class="meta">${s}</div>
                <div style="height:5px;background:#eee;border-radius:3px;margin-top:14px">
                  <div style="width:${30 + Math.round(Math.random() * 50)}%;height:100%;
                    background:${c};border-radius:3px"></div></div></div>`
            )
            .join("")}
        </div>
      </div>`,

    gmail: `<div class="top" style="background:#f6f8fc;border-bottom:0">
        <div class="rnd">&#9776;</div>
        <div class="brand"><b style="color:#5f6368">Gmail</b></div>
        <div style="flex:1;max-width:680px;margin:0 20px;height:46px;background:#eaf1fb;
          border-radius:8px;display:flex;align-items:center;padding:0 16px;color:#5f6368">
          &#128269;&nbsp;Search mail
        </div>
        <div class="grow"></div>
        <div class="rnd">&#9881;</div>
        <div class="av">J</div>
      </div>
      <div class="shell">
        <div class="side" style="background:#f6f8fc">
          <div style="padding:4px 0 14px"><span class="btn" style="height:48px;border-radius:16px;
            padding:0 24px;background:#c2e7ff;color:#001d35">+ Compose</span></div>
          <div class="it on" style="background:#d3e3fd;color:#001d35"><i>&#9993;</i> Inbox</div>
          <div class="it"><i>&#11088;</i> Starred</div>
          <div class="it"><i>&#128337;</i> Snoozed</div>
          <div class="it"><i>&#10148;</i> Sent</div>
          <div class="it"><i>&#128196;</i> Drafts</div>
        </div>
        <div class="main" style="background:#fff;padding:0">
          ${[
            ["Ms. Alvarez", "Unit 6 Study Guide posted", "The study guide for Unit 6 is now posted in Classroom. Please review sections 6.1 through 6.3 before Friday.", "9:42 AM"],
            ["Counselor's Office", "Course selection for next year", "Course selection opens Monday. Please have your parent or guardian review the form before you submit it.", "Yesterday"],
            ["Mr. Whitfield", "Essay revisions", "Good work on the first draft. Please see my comments and resubmit by Thursday.", "Yesterday"],
            ["Library", "Overdue notice", "The book you checked out is due in three days. Renew online if you still need it.", "Mon"],
            ["IT Helpdesk", "Password reset complete", "Your school account password was updated successfully. If you did not make this change, contact the helpdesk.", "Mon"],
          ]
            .map(
              ([who, subj, body, when]) => `<div style="display:flex;gap:14px;padding:13px 20px;
                border-bottom:1px solid #f1f3f4;align-items:center">
                <div class="av" style="background:#7986cb">${who[0]}</div>
                <div style="min-width:0;flex:1">
                  <div style="font-size:13px;font-weight:600">${who}</div>
                  <div style="font-size:13px;color:#202124;overflow:hidden;text-overflow:ellipsis;
                    white-space:nowrap">${subj} &mdash; <span style="color:#5f6368">${body}</span></div>
                </div>
                <div class="meta" style="flex:0 0 auto">${when}</div>
              </div>`
            )
            .join("")}
        </div>
      </div>`,

    google: `<div style="min-height:100%;display:flex;flex-direction:column;background:#fff">
        <div style="display:flex;justify-content:flex-end;gap:16px;padding:16px 22px;
          font-size:13px;color:#202124;align-items:center">
          <span>Gmail</span><span>Images</span>
          <div class="rnd">&#9783;</div>
          <div class="av">JD</div>
        </div>
        <div style="flex:1;display:flex;flex-direction:column;align-items:center;
          padding-top:9vh;text-align:center">
          <div style="font-size:78px;font-weight:500;letter-spacing:-4px;line-height:1;user-select:none">
            <span style="color:#4285f4">G</span><span style="color:#ea4335">o</span
            ><span style="color:#fbbc04">o</span><span style="color:#4285f4">g</span
            ><span style="color:#34a853">l</span><span style="color:#ea4335">e</span>
          </div>
          <div style="width:min(584px,88%);height:46px;border:1px solid #dfe1e5;border-radius:24px;
            margin-top:32px;display:flex;align-items:center;padding:0 18px;gap:12px;
            box-shadow:0 1px 6px rgba(32,33,36,.1);color:#5f6368">
            &#128269;<div style="flex:1"></div><span style="color:#4285f4">&#127908;</span>
            <span style="color:#4285f4">&#128247;</span>
          </div>
          <div style="display:flex;gap:12px;margin-top:28px">
            <span class="btn ghost" style="background:#f8f9fa;border-color:#f8f9fa;color:#3c4043">Google Search</span>
            <span class="btn ghost" style="background:#f8f9fa;border-color:#f8f9fa;color:#3c4043">I'm Feeling Lucky</span>
          </div>
          <div class="meta" style="margin-top:26px">Google offered in: Espa&ntilde;ol</div>
        </div>
        <div style="background:#f2f2f2;border-top:1px solid #e4e4e4;padding:12px 26px;
          font-size:13px;color:#70757a;display:flex;gap:26px;flex-wrap:wrap">
          <span>About</span><span>Advertising</span><span>Business</span><span>How Search works</span>
          <div class="grow"></div>
          <span>Privacy</span><span>Terms</span><span>Settings</span>
        </div>
      </div>`,

    wikipedia: `<div style="background:#fff;min-height:100%;font-family:Georgia,"Times New Roman",serif">
        <div style="border-bottom:1px solid #a2a9b1;padding:12px 22px;display:flex;
          align-items:center;gap:18px;font-family:system-ui,sans-serif">
          <div style="font-size:19px;font-weight:700">WIKIPEDIA</div>
          <div class="grow"></div>
          <div style="width:340px;height:34px;border:1px solid #a2a9b1;border-radius:2px;
            display:flex;align-items:center;padding:0 10px;color:#72777d;font-size:13px">
            &#128269;&nbsp;Search Wikipedia</div>
        </div>
        <div style="display:flex;max-width:1200px;margin:0 auto">
          <div style="width:180px;flex:0 0 180px;padding:18px 12px;font:13px/2 system-ui,sans-serif;
            color:#3366cc">
            <div style="color:#54595d;font-weight:600;margin-bottom:6px;
              border-bottom:1px solid #eaecf0;padding-bottom:6px">Contents</div>
            <div>Main page</div><div>Contents</div><div>Current events</div>
            <div>Random article</div><div>About Wikipedia</div><div>Contact us</div>
            <div style="color:#54595d;font-weight:600;margin:14px 0 6px;
              border-bottom:1px solid #eaecf0;padding-bottom:6px">Contribute</div>
            <div>Help</div><div>Learn to edit</div><div>Community portal</div>
            <div style="color:#54595d;font-weight:600;margin:14px 0 6px;
              border-bottom:1px solid #eaecf0;padding-bottom:6px">Tools</div>
            <div>What links here</div><div>Related changes</div>
          </div>
          <div style="flex:1;padding:18px 26px 60px;min-width:0">
            <h1 style="font:400 30px/1.3 Georgia,serif;border-bottom:1px solid #a2a9b1;
              padding-bottom:6px;margin-bottom:14px">Photosynthesis</h1>
            <div style="font:12.5px/1.6 system-ui,sans-serif;color:#54595d;margin-bottom:16px">
              From Wikipedia, the free encyclopedia</div>
            <p style="font:15px/1.65 Georgia,serif;margin-bottom:14px">
              <b>Photosynthesis</b> is a system of biological processes by which
              photosynthetic organisms convert light energy into chemical energy, which is
              stored as sugar. The process is carried out by green plants, algae and
              cyanobacteria, and is the primary source of energy for nearly all life on Earth.
            </p>
            <p style="font:15px/1.65 Georgia,serif;margin-bottom:14px">
              Photosynthesis releases oxygen as a by-product, which is essential for the
              respiration of most living organisms. The overall reaction is often summarised as
              six molecules of carbon dioxide and six molecules of water producing one molecule
              of glucose and six molecules of oxygen.
            </p>
            <div style="font:19px/1.3 Georgia,serif;font-weight:400;border-bottom:1px solid #a2a9b1;
              padding-bottom:5px;margin:26px 0 12px">Light-dependent reactions</div>
            <p style="font:15px/1.65 Georgia,serif;margin-bottom:14px">
              In the light-dependent reactions, one molecule of the pigment chlorophyll absorbs
              one photon and loses one electron. This electron is passed down an electron
              transport chain, and the energy released is used to pump protons across the
              thylakoid membrane.
            </p>
            <p style="font:15px/1.65 Georgia,serif;color:#54595d">
              This article is a stub. You can help Wikipedia by expanding it.
            </p>
          </div>
        </div>
      </div>`,

    schoology: `<div class="top" style="background:#fff;border-bottom:1px solid #d8d8d8">
        <div class="brand" style="color:#0f7dbf;font-weight:700">Schoology</div>
        <div class="grow"></div>
        <div style="display:flex;gap:18px;font-size:13px;color:#333">
          <span>Courses</span><span>Groups</span><span>Resources</span><span>Calendar</span>
        </div>
        <div class="grow"></div>
        <div class="av" style="background:#0f7dbf">JD</div>
      </div>
      <div class="shell">
        <div class="side">
          <div class="it on"><i>&#9638;</i> Home</div>
          <div class="it"><i>&#128218;</i> Courses</div>
          <div class="it"><i>&#128197;</i> Calendar</div>
          <div class="it"><i>&#9993;</i> Messages</div>
        </div>
        <div class="main">
          <div class="h1" style="color:#0f7dbf">Recent activity</div>
          <div class="meta">Last updated today at 9:41 AM</div>
          <div class="grid" style="grid-template-columns:1fr;max-width:760px">
            ${[
              ["Algebra II &mdash; Period 3", "Ms. Alvarez posted a new assignment", "Unit 6 Practice Set &middot; due Friday"],
              ["AP Biology &mdash; Period 5", "Dr. Nakamura updated the lab rubric", "Osmosis Lab &middot; grading rubric attached"],
              ["World History &mdash; Period 1", "Mr. Okafor added a discussion", "Causes of the Great Depression"],
            ]
              .map(
                ([c, a, d]) => `<div class="card" style="padding:14px 18px">
                  <div style="font-size:12.5px;color:#0f7dbf;font-weight:600">${c}</div>
                  <div style="font-size:13.5px;font-weight:500;margin:3px 0">${a}</div>
                  <div class="meta">${d}</div></div>`
              )
              .join("")}
          </div>
        </div>
      </div>`,
  };

  const DEFAULT_DECOY = "classroom";
  const DEFAULT_TITLE = "Classes";

  /* ---------------------------------------------------------------- engine */

  const cloak = () => window.AFCloak;

  function autoEnabled() {
    const c = cloak();
    if (!c || typeof c.getAuto !== "function") return true;
    try {
      return c.getAuto() !== false;
    } catch (error) {
      return true;
    }
  }

  function presetId() {
    const c = cloak();
    const active = c && c.current && c.current();
    return (active && DECOYS[active.id] && active.id) || DEFAULT_DECOY;
  }

  function presetTitle() {
    const c = cloak();
    const active = c && c.current && c.current();
    return (active && active.title) || DEFAULT_TITLE;
  }

  function decoyHtml() {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <title>${esc(presetTitle())}</title><style>${BASE_CSS}</style></head>
      <body>${DECOYS[presetId()]}</body></html>`;
  }

  function iconHref() {
    const c = cloak();
    const active = c && c.current && c.current();
    if (!active) return "";
    try {
      return c.iconFor(active);
    } catch (error) {
      return "";
    }
  }

  function mute() {
    const audio = document.getElementById("audioEngine");
    if (!audio) return;
    mutedBefore = !audio.muted;
    audio.muted = true;
  }

  function unmute() {
    const audio = document.getElementById("audioEngine");
    if (!audio) return;
    audio.muted = !mutedBefore;
  }

  function buildLayer() {
    const node = document.createElement("div");
    node.id = "afGuardLayer";
    node.setAttribute("aria-hidden", "true");
    node.style.cssText = [
      "position:fixed",
      "inset:0",
      "z-index:2147483646",
      "background:#f8f9fa",
      "overflow:auto",
      "margin:0",
      "padding:0",
    ].join(";");
    const frame = document.createElement("iframe");
    // srcdoc keeps the decoy in its own document, so an extension walking the
    // host document's DOM finds one blank iframe and nothing else.
    frame.setAttribute("title", "Classes");
    frame.setAttribute("tabindex", "-1");
    frame.style.cssText = "border:0;width:100%;height:100%;display:block;background:#f8f9fa";
    frame.srcdoc = decoyHtml();
    node.appendChild(frame);
    return node;
  }

  function engage() {
    if (engaged) return;
    engaged = true;

    const c = cloak();
    savedTitle = document.title;
    const link = document.querySelector('link[rel~="icon"]');
    savedIcon = link ? link.href : "";
    try {
      savedPreset = (c && c.current && c.current()) || null;
    } catch (error) {
      savedPreset = null;
    }
    savedPresetKnown = true;

    if (savedPreset) {
      document.title = presetTitle();
      try {
        c.apply(savedPreset, { persist: false });
      } catch (error) {
        /* preset already painted */
      }
    } else {
      document.title = DEFAULT_TITLE;
    }

    layer = buildLayer();
    document.body.appendChild(layer);
    document.documentElement.setAttribute(GUARD_ATTR, "on");

    // Hide the real UI from anything that reads rendered text. innerText on a
    // display:none subtree comes back empty, which is what the classroom tools
    // actually collect.
    document.querySelectorAll("body > *:not(#afGuardLayer)").forEach((node) => {
      node.setAttribute("data-af-guard-hidden", node.style.display || "");
      node.style.display = "none";
    });
    document.body.style.overflow = "hidden";
    document.body.style.background = "#f8f9fa";
    mute();
  }

  function release() {
    if (!engaged) return;
    engaged = false;

    document.querySelectorAll("[data-af-guard-hidden]").forEach((node) => {
      node.style.display = node.getAttribute("data-af-guard-hidden") || "";
      node.removeAttribute("data-af-guard-hidden");
    });
    if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
    layer = null;
    document.documentElement.removeAttribute(GUARD_ATTR);
    document.body.style.overflow = "";
    document.body.style.background = "";

    const c = cloak();
    // Put the disguise the user actually picked back on the tab. engage() stored
    // it before the auto path repainted the tab with the panic preset.
    if (savedPresetKnown) {
      if (savedPreset) {
        try {
          c.apply(savedPreset, { persist: false });
        } catch (error) {
          document.title = savedTitle;
        }
      } else {
        document.title = savedTitle || document.title;
        if (savedIcon) {
          const link = document.querySelector('link[rel~="icon"]');
          if (link) link.href = savedIcon;
        }
        try {
          if (window.AF && window.AF.applyTabAppearance) window.AF.applyTabAppearance();
        } catch (error) {
          /* shell not mounted yet */
        }
      }
      savedPresetKnown = false;
      savedPreset = null;
    }
    unmute();
  }

  function panicPreset() {
    const c = cloak();
    if (!c || typeof c.find !== "function") return null;
    try {
      return c.find(c.getPanic()) || c.find("classroom");
    } catch (error) {
      return null;
    }
  }

  function engageAuto() {
    // Capture the disguise the user chose first, so returning restores their tab
    // rather than leaving it on the panic preset. engage() stores it; the panic
    // repaint happens afterwards and rebuilds the decoy through
    // af-cloak-change.
    engage();
    const c = cloak();
    const preset = panicPreset();
    if (preset && c && typeof c.apply === "function") {
      try {
        c.apply(preset, { persist: false });
      } catch (error) {
        /* preset store unavailable */
      }
    }
  }

  function toggleLock(on) {
    locked = !!on;
    clearTimeout(lockTimer);
    if (locked) {
      engage();
      lockTimer = setTimeout(() => {
        locked = false;
        if (document.hasFocus() && !document.hidden) release();
      }, PANIC_HOLD_MS);
    } else if (document.hasFocus() && !document.hidden) {
      release();
    }
  }

  /* ------------------------------------------------------------- cover tab */

  function coverDocument(title, body) {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <title>${esc(title)}</title><style>${BASE_CSS}</style></head><body>${body}</body></html>`;
  }

  function openCoverTab() {
    const win = window.open("about:blank", "_blank");
    if (!win) return null;
    const id = presetId();
    const title = presetTitle();
    try {
      win.document.open();
      win.document.write(coverDocument(title, DECOYS[id] || DECOYS[DEFAULT_DECOY]));
      win.document.close();
    } catch (error) {
      try {
        win.document.title = title;
      } catch (inner) {
        /* cross-origin about:blank is not writable */
      }
    }
    try {
      const c = cloak();
      const active = c && c.current && c.current();
      if (active) {
        const link = win.document.createElement("link");
        link.rel = "icon";
        link.type = "image/svg+xml";
        link.href = c.iconFor(active);
        win.document.head.appendChild(link);
      }
    } catch (error) {
      /* head not reachable */
    }
    try {
      win.focus();
    } catch (error) {
      /* popup already foregrounded */
    }
    coverWin = win;
    // The hub must not steal focus back. It stays in the background from here,
    // which is the whole point: the monitored tab is the blank decoy.
    return win;
  }

  /* -------------------------------------------------------------- watchdog */

  function shouldEngage() {
    return !document.hidden || document.visibilityState === "hidden";
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      clearTimeout(blurTimer);
      if (autoEnabled() || locked) engageAuto();
    } else if (!locked) {
      release();
    }
  });

  // Clicking into a proxied iframe fires blur on the host window even though the
  // user is still looking at the hub. A pointerdown on an iframe arms a short
  // suppression window so the guard does not flash mid-click.
  document.addEventListener(
    "pointerdown",
    (event) => {
      const target = event.target;
      if (target && target.tagName === "IFRAME") iframeGuardUntil = Date.now() + 2500;
      const frame = target && target.closest ? target.closest("iframe") : null;
      if (frame) iframeGuardUntil = Date.now() + 2500;
    },
    true
  );

  window.addEventListener("blur", () => {
    clearTimeout(blurTimer);
    blurTimer = setTimeout(() => {
      if (locked) {
        engageAuto();
        return;
      }
      if (!autoEnabled()) return;
      if (Date.now() < iframeGuardUntil) return;
      if (document.hasFocus()) return;
      engageAuto();
    }, ENTER_MS);
  });

  window.addEventListener("focus", () => {
    clearTimeout(blurTimer);
    if (locked) return;
    release();
  });

  window.addEventListener("pagehide", () => {
    // A bfcache snapshot is taken here; make sure it holds the decoy.
    engage();
  });

  window.addEventListener("pageshow", (event) => {
    // Restored from bfcache: the document comes back exactly as it left, which is
    // mid-decoy. Drop it unless the user asked for the panic to stay up.
    if (!event.persisted) return;
    if (locked) return;
    release();
  });

  window.addEventListener("beforeprint", () => engage());

  document.addEventListener("keydown", (event) => {
    if (!event.altKey || event.ctrlKey || event.metaKey) return;
    const key = (event.key || "").toLowerCase();

    if (key === "x" && !event.shiftKey) {
      event.preventDefault();
      if (engaged || locked) {
        locked = false;
        clearTimeout(lockTimer);
        release();
      } else {
        // Panic is two moves at once: repaint the tab as the panic disguise and
        // put the decoy over the screen, so a screenshot taken right now lands
        // on a school page instead of the hub.
        try {
          const c = cloak();
          if (c && c.panic) c.panic();
        } catch (error) {
          /* preset store unavailable */
        }
        toggleLock(true);
      }
      return;
    }
    if (event.shiftKey && key === "c") {
      event.preventDefault();
      openCoverTab();
      return;
    }
    if (event.shiftKey && key === "g") {
      event.preventDefault();
      if (engaged) {
        locked = false;
        release();
      } else {
        toggleLock(true);
      }
    }
  });

  // Keep the guard consistent if the disguise changes while it is up.
  document.addEventListener("af-cloak-change", () => {
    if (!engaged) return;
    document.title = presetTitle();
    if (layer && layer.firstChild) layer.firstChild.srcdoc = decoyHtml();
  });

  window.AFGuard = {
    engage,
    release,
    lock: toggleLock,
    coverTab: openCoverTab,
    isEngaged: () => engaged,
    isLocked: () => locked,
    lastCover: () => coverWin,
    decoys: Object.keys(DECOYS),
    preview(id) {
      const key = DECOYS[id] ? id : DEFAULT_DECOY;
      return coverDocument(id ? findTitle(key) : DEFAULT_TITLE, DECOYS[key]);
    },
  };

  function findTitle(id) {
    const c = cloak();
    const preset = c && c.find && c.find(id);
    return (preset && preset.title) || DEFAULT_TITLE;
  }
})();
