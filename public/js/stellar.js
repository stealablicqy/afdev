/* Stellar backdrop v2 — the animated sky the whole hub sits on.
   Layers, back to front:
     1. nebula plate   pre-rendered offscreen, drifting and slowly rotating
     2. aurora ribbons three additive sine bands, hue-cycled
     3. star field     3D projected star tunnel with depth and pointer parallax
     4. constellations pulsing links between the brightest anchors
     5. shooting stars with spark trails
     6. pointer lens   a soft gravitational brightening under the cursor
   Route changes fire a hyperspace pulse. Everything is decoration: no app state
   is read or written, and it shuts off for reduced motion or a hidden tab. */
(function () {
  "use strict";

  if (document.getElementById("afStarfield")) return;

  const canvas = document.createElement("canvas");
  canvas.id = "afStarfield";
  canvas.setAttribute("aria-hidden", "true");
  document.body.insertBefore(canvas, document.body.firstChild);

  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return;

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

  let width = 0;
  let height = 0;
  let dpr = 1;
  let focal = 700;
  let stars = [];
  let anchors = [];
  let links = [];
  let shooting = [];
  let nebula = null;
  let nebulaAngle = 0;
  let warp = 0;
  let lens = 0;
  let running = false;
  let last = 0;
  let phase = 0;
  let pointer = { x: 0, y: 0 };
  let target = { x: 0, y: 0 };
  let fpsAcc = 0;
  let fpsFrames = 0;
  let quality = 1;

  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);

  /* ------------------------------------------------------------- nebula plate */

  function buildNebula() {
    const size = 512;
    const plate = document.createElement("canvas");
    plate.width = size;
    plate.height = size;
    const g = plate.getContext("2d");
    g.globalCompositeOperation = "lighter";
    const blobs = [
      [0.28, 0.34, 0.36, 268, 0.5],
      [0.7, 0.28, 0.3, 300, 0.42],
      [0.54, 0.66, 0.42, 208, 0.34],
      [0.18, 0.72, 0.26, 332, 0.3],
      [0.84, 0.78, 0.22, 186, 0.26],
      [0.48, 0.46, 0.5, 246, 0.2],
    ];
    for (const [x, y, r, hue, a] of blobs) {
      const grad = g.createRadialGradient(x * size, y * size, 0, x * size, y * size, r * size);
      grad.addColorStop(0, `hsla(${hue},88%,62%,${a})`);
      grad.addColorStop(0.55, `hsla(${hue + 14},85%,52%,${a * 0.42})`);
      grad.addColorStop(1, "hsla(0,0%,0%,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, size, size);
    }
    // Static film grain keeps the wash from banding on cheap panels.
    const grain = g.getImageData(0, 0, size, size);
    const data = grain.data;
    for (let i = 0; i < data.length; i += 4) {
      const n = (Math.random() - 0.5) * 9;
      data[i] += n;
      data[i + 1] += n;
      data[i + 2] += n;
    }
    g.putImageData(grain, 0, 0);
    nebula = plate;
  }

  /* ---------------------------------------------------------------- geometry */

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    focal = Math.max(520, Math.min(width, height) * 1.15);
    build();
  }

  function build() {
    const area = width * height;
    const density = Math.max(120, Math.min(720, Math.round(area / 2600)));
    const total = Math.round(density * quality);

    stars = [];
    for (let i = 0; i < total; i += 1) {
      stars.push({
        // Cartesian coordinates kept near the origin; z is the depth axis and
        // drives both scale and fade, so the field reads as a tunnel not a sheet.
        x: rand(-width, width) * 1.6,
        y: rand(-height, height) * 1.6,
        z: rand(120, 1400),
        r: rand(0.35, 1.5),
        hue: Math.random() < 0.16 ? rand(292, 336) : Math.random() < 0.22 ? rand(188, 216) : 0,
        tw: rand(0.5, 2.2),
        seed: rand(0, TAU),
      });
    }

    // Anchors are the brightest few: constellation endpoints and the lens core.
    anchors = stars
      .filter(() => Math.random() < 0.18)
      .slice(0, 42)
      .map((s) => ({ star: s, r: rand(1.2, 2.2) }));

    links = [];
    for (let i = 0; i < anchors.length; i += 1) {
      let best = -1;
      let bestDist = Infinity;
      for (let j = i + 1; j < anchors.length; j += 1) {
        const dx = anchors[i].star.x - anchors[j].star.x;
        const dy = anchors[i].star.y - anchors[j].star.y;
        const d = dx * dx + dy * dy;
        if (d < bestDist) {
          bestDist = d;
          best = j;
        }
      }
      if (best > -1) links.push({ a: i, b: best, seed: rand(0, TAU) });
    }
  }

  /* ------------------------------------------------------------------ drawing */

  function drawNebula(now) {
    if (!nebula) return;
    const scale = Math.max(width, height) / 512 * 1.35;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.5;
    ctx.translate(width * 0.5, height * 0.42);
    ctx.rotate(nebulaAngle);
    ctx.translate(-pointer.x * 18, -pointer.y * 18);
    ctx.scale(scale, scale);
    ctx.drawImage(nebula, -256, -256);
    ctx.restore();
  }

  function drawAurora() {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let band = 0; band < 3; band += 1) {
      const baseY = height * (0.28 + band * 0.13);
      const amp = 40 + band * 26;
      const speed = 0.00022 * (1 + band * 0.45);
      const hue = 258 + band * 26 + Math.sin(phase * 0.4 + band) * 18;
      ctx.beginPath();
      ctx.moveTo(-40, height);
      for (let x = -40; x <= width + 40; x += 34) {
        const y =
          baseY +
          Math.sin(x * 0.0032 + phase * speed * 1000 + band) * amp +
          Math.sin(x * 0.0011 - phase * speed * 640 + band * 2) * amp * 0.7;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(width + 40, height);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, baseY - amp, 0, height);
      grad.addColorStop(0, `hsla(${hue},86%,64%,0.055)`);
      grad.addColorStop(0.45, `hsla(${hue + 30},82%,56%,0.035)`);
      grad.addColorStop(1, "hsla(0,0%,0%,0)");
      ctx.fillStyle = grad;
      ctx.fill();
    }
    ctx.restore();
  }

  function project(star) {
    const z = star.z;
    const k = focal / z;
    return {
      x: width * 0.5 + star.x * k - pointer.x * (1400 - z) * 0.045,
      y: height * 0.5 + star.y * k - pointer.y * (1400 - z) * 0.045,
      k,
    };
  }

  function drawStars() {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const drawn = [];
    for (const star of stars) {
      const p = project(star);
      if (p.x < -60 || p.x > width + 60 || p.y < -60 || p.y > height + 60) continue;
      const depthFade = Math.max(0, Math.min(1, (1500 - star.z) / 1500));
      const flicker = 0.68 + 0.32 * Math.sin(phase * star.tw + star.seed);
      const alpha = Math.min(1, (0.16 + depthFade * 0.78) * flicker + warp * 0.35);
      const radius = star.r * (0.5 + depthFade * 1.9) * (1 + warp * 1.1);
      if (alpha < 0.02) continue;
      ctx.fillStyle = star.hue
        ? `hsla(${star.hue},88%,80%,${alpha})`
        : `rgba(235,240,255,${alpha})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, TAU);
      ctx.fill();
      if (star.r > 1.15) {
        ctx.globalAlpha = alpha * 0.16;
        ctx.fillStyle = "#cfd8ff";
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius * 4.2, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      drawn.push({ p, star, depthFade });
    }

    // Constellation web — only links whose endpoints are both on screen.
    const byIndex = new Map();
    for (const item of drawn) {
      const idx = anchors.findIndex((a) => a.star === item.star);
      if (idx > -1) byIndex.set(idx, item.p);
    }
    ctx.lineWidth = 0.7;
    for (const link of links) {
      const a = byIndex.get(link.a);
      const b = byIndex.get(link.b);
      if (!a || !b) continue;
      const pulse = 0.35 + 0.65 * Math.abs(Math.sin(phase * 0.35 + link.seed));
      ctx.strokeStyle = `rgba(150,170,255,${0.055 * pulse + warp * 0.12})`;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // Hyperspace streaks on a route change.
    if (warp > 0.015) {
      const cx = width * 0.5 - pointer.x * 30;
      const cy = height * 0.5 - pointer.y * 30;
      for (const item of drawn) {
        const dx = item.p.x - cx;
        const dy = item.p.y - cy;
        const len = Math.hypot(dx, dy) || 1;
        const tail = warp * 90 * item.depthFade;
        ctx.strokeStyle = `rgba(178,196,255,${warp * 0.42 * item.depthFade})`;
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(item.p.x, item.p.y);
        ctx.lineTo(item.p.x + (dx / len) * tail, item.p.y + (dy / len) * tail);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawLens() {
    if (lens < 0.01) return;
    const cx = width * 0.5 + pointer.x * width * 0.5;
    const cy = height * 0.5 + pointer.y * height * 0.5;
    const radius = 150 + lens * 90;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    grad.addColorStop(0, `rgba(140,170,255,${0.05 * lens})`);
    grad.addColorStop(0.55, `rgba(120,140,255,${0.022 * lens})`);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawShooting(t) {
    for (let i = shooting.length - 1; i >= 0; i -= 1) {
      const s = shooting[i];
      s.x += Math.cos(s.angle) * s.speed * t;
      s.y += Math.sin(s.angle) * s.speed * t;
      s.life -= 0.0055 * t;
      const tailX = s.x - Math.cos(s.angle) * s.len;
      const tailY = s.y - Math.sin(s.angle) * s.len;
      const grad = ctx.createLinearGradient(s.x, s.y, tailX, tailY);
      const life = Math.max(0, s.life);
      grad.addColorStop(0, `rgba(255,255,255,${life})`);
      grad.addColorStop(0.25, `rgba(196,214,255,${life * 0.6})`);
      grad.addColorStop(1, "rgba(120,140,255,0)");
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = grad;
      ctx.lineWidth = s.width;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(tailX, tailY);
      ctx.stroke();
      ctx.fillStyle = `rgba(255,255,255,${life})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.width * 1.1, 0, TAU);
      ctx.fill();
      ctx.restore();
      if (s.life <= 0 || s.y > height + 160 || s.x > width + 200 || s.x < -200) shooting.splice(i, 1);
    }
  }

  function spawnShooting() {
    if (shooting.length >= 3) return;
    const fromLeft = Math.random() > 0.4;
    shooting.push({
      x: fromLeft ? rand(-140, width * 0.4) : rand(width * 0.6, width + 140),
      y: rand(-80, height * 0.45),
      len: rand(120, 300),
      speed: rand(7, 15),
      angle: fromLeft ? rand(0.3, 0.6) : rand(1.9, 2.3),
      life: 1,
      width: rand(1.1, 2.1),
    });
  }

  /* ------------------------------------------------------------------- loop */

  function frame(now) {
    if (!running) return;
    const delta = Math.min(48, now - last || 16);
    last = now;
    const t = delta / 16.67;
    phase += 0.012 * t;

    pointer.x += (target.x - pointer.x) * 0.05 * t;
    pointer.y += (target.y - pointer.y) * 0.05 * t;
    warp *= Math.pow(0.935, t);
    lens += ((document.hasFocus() ? 1 : 0.35) - lens) * 0.03 * t;
    nebulaAngle += 0.00012 * t;

    ctx.clearRect(0, 0, width, height);
    drawNebula(now);
    drawAurora();
    drawStars();
    drawLens();
    drawShooting(t);

    // Cheap adaptive quality: if the frame budget slips, thin the field once.
    fpsAcc += delta;
    fpsFrames += 1;
    if (fpsFrames >= 90) {
      const avg = fpsAcc / fpsFrames;
      fpsAcc = 0;
      fpsFrames = 0;
      if (avg > 26 && quality > 0.45) {
        quality *= 0.75;
        build();
      }
    }

    requestAnimationFrame(frame);
  }

  let shootTimer = 0;
  function scheduleShooting() {
    clearTimeout(shootTimer);
    shootTimer = setTimeout(() => {
      if (running && !reduced.matches) spawnShooting();
      scheduleShooting();
    }, rand(2400, 6800));
  }

  function start() {
    if (running || reduced.matches || document.body.classList.contains("no-background")) return;
    running = true;
    last = 0;
    requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
  }

  /* --------------------------------------------------------------- controls */

  window.addEventListener(
    "pointermove",
    (event) => {
      target.x = (event.clientX / Math.max(1, width) - 0.5) * 2;
      target.y = (event.clientY / Math.max(1, height) - 0.5) * 2;
      // neon.css reads these for the cursor bloom and card tilt highlights.
      document.documentElement.style.setProperty("--mx", event.clientX + "px");
      document.documentElement.style.setProperty("--my", event.clientY + "px");
    },
    { passive: true }
  );

  window.addEventListener("resize", resize, { passive: true });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else start();
  });

  window.addEventListener("af:route", () => {
    warp = reduced.matches ? 0 : 1;
    if (!reduced.matches && Math.random() > 0.45) spawnShooting();
  });

  // The shell toggles body.no-background from settings; honour it live.
  new MutationObserver(() => {
    if (document.body.classList.contains("no-background")) {
      stop();
      canvas.style.display = "none";
    } else {
      canvas.style.display = "";
      start();
    }
  }).observe(document.body, { attributes: true, attributeFilter: ["class"] });

  buildNebula();
  resize();
  if (reduced.matches) {
    // One static frame so the page still has depth, then stop.
    drawNebula(0);
    drawAurora();
    pointer.x = 0;
    pointer.y = 0;
    drawStars();
  } else {
    start();
    scheduleShooting();
  }

  window.AFStellar = {
    pulse() {
      warp = reduced.matches ? 0 : 1;
    },
    toggle(on) {
      if (on) {
        canvas.style.display = "";
        start();
      } else {
        stop();
        canvas.style.display = "none";
      }
    },
    setQuality(value) {
      quality = Math.max(0.3, Math.min(1, Number(value) || 1));
      build();
    },
  };
})();
