/* Touchdown pop-ups for the redesign, a prototype (2026-09-27): four takes
   on the touchdown card with no portrait disc, the player's own cut-out
   (Sleeper's full-size photo is a transparent PNG) and a particle layer
   on one canvas. Chosen with ?tdstyle=1..4 (app.js):

     1 Embers   sparks rise and gather into the player; they blow off upward
     2 Smoke    he sweeps in trailing smoke in the team's colours
     3 Pylon    a beam of light, stardust spiralling in, the points counting up
     4 Chalk    yard lines streak past and freeze; chalk dust hangs

   TdFx.play(style, host, opts) starts one on a `.tdx` element app.js has
   rendered and returns { exit(), stop() }. Particles are drawn from soft
   round sprites made once per colour (a drawImage is far cheaper than a
   shadowBlur per particle, and a blur filter stutters on phones). Under
   reduced motion nothing runs: the CSS lands the final frame. */
const TdFx = (() => {
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (xs) => xs[(Math.random() * xs.length) | 0];
  const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
  const outCubic = (t) => 1 - (1 - t) ** 3;
  const inCubic = (t) => t * t * t;

  // Any CSS colour to [r, g, b], read back off a 1px canvas.
  const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  function rgbOf(color) {
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = "#000"; probe.fillStyle = color;
    probe.fillRect(0, 0, 1, 1);
    const d = probe.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  }
  // A soft disc in one colour, 64px, alpha falling from the centre; `core`
  // is how far the solid middle reaches (0 for smoke, higher for sparks).
  const sprites = new Map();
  function sprite(color, core = 0.25) {
    const key = `${color}|${core}`;
    if (sprites.has(key)) return sprites.get(key);
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    const [r, gg, b] = rgbOf(color);
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, `rgba(${r},${gg},${b},1)`);
    grad.addColorStop(core, `rgba(${r},${gg},${b},${core ? 0.9 : 0.55})`);
    grad.addColorStop(1, `rgba(${r},${gg},${b},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    sprites.set(key, c);
    return c;
  }

  // Points inside the player's silhouette, sampled from the photo's alpha at
  // the size it shows; `edge` are the ones with nothing above them (the top
  // of the helmet and shoulders), where embers leave from. An image the
  // canvas may not read (no CORS) falls back to an ellipse.
  function silhouette(img, w, h, max = 1100) {
    const pts = [], edge = [];
    const step = Math.max(3, Math.round(Math.sqrt((w * h) / 2600)));
    try {
      const c = document.createElement("canvas");
      c.width = Math.round(w); c.height = Math.round(h);
      const g = c.getContext("2d", { willReadFrequently: true });
      g.drawImage(img, 0, 0, c.width, c.height);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      const a = (x, y) => (x < 0 || y < 0 || x >= c.width || y >= c.height ? 0 : d[(y * c.width + x) * 4 + 3]);
      for (let y = 0; y < c.height; y += step) {
        for (let x = 0; x < c.width; x += step) {
          if (a(x, y) < 140) continue;
          pts.push([x, y]);
          if (a(x, y - step * 2) < 60) edge.push([x, y]);
        }
      }
    } catch { /* tainted canvas: fall through to the ellipse */ }
    if (pts.length < 40) {
      for (let i = 0; i < 700; i++) {
        const t = rand(0, TAU), r = Math.sqrt(Math.random());
        const x = w / 2 + Math.cos(t) * r * w * 0.28, y = h * 0.55 + Math.sin(t) * r * h * 0.42;
        pts.push([x, y]);
        if (r > 0.9 && Math.sin(t) < 0) edge.push([x, y]);
      }
    }
    for (let i = pts.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [pts[i], pts[j]] = [pts[j], pts[i]]; }
    return { pts: pts.slice(0, max), edge: edge.length ? edge : pts.slice(0, 60) };
  }

  function play(style, host, o) {
    const canvas = host.querySelector(".tdx-fx");
    const ctx = canvas.getContext("2d");
    const stage = host.querySelector(".tdx-stage");
    const shot = host.querySelector(".tdx-shot");
    const ptsEl = host.querySelector(".tdx-pts b");
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let W = 0, H = 0, S = { x: 0, y: 0, w: 0, h: 0 };   // the canvas in CSS px, and the stage in canvas space
    function measure() {
      const hr = host.getBoundingClientRect(), sr = stage.getBoundingClientRect();
      W = hr.width; H = hr.height;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      S = { x: sr.left - hr.left, y: sr.top - hr.top, w: sr.width, h: sr.height };
    }
    measure();

    const accent = o.over ? "#9aa3ad" : o.accent || "#4fe3c1";
    const ground = o.over ? "#5a626b" : o.ground || "#0b2a3a";
    const css = getComputedStyle(document.documentElement);
    const league = o.over ? ["#9aa3ad", "#c9cfd3", "#ffffff"]
      : [css.getPropertyValue("--accent").trim() || "#4fe3c1", "#5b8cff", css.getPropertyValue("--violet").trim() || "#8c6eff", "#ffffff"];

    const parts = [];
    let raf = 0, t0 = performance.now(), last = t0, exitAt = null, dead = false;
    const now = () => (performance.now() - t0) / 1000;
    const since = () => (exitAt == null ? 0 : now() - exitAt);

    const S1 = style === 1 ? setup1() : null;
    const S2 = style === 2 ? setup2() : null;
    const S3 = style === 3 ? setup3() : null;
    const S4 = style === 4 ? setup4() : null;

    function frame() {
      if (dead) return;
      const tn = performance.now();
      const dt = Math.min(0.05, (tn - last) / 1000); last = tn;
      const t = (tn - t0) / 1000;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      if (S1) S1(t, dt); else if (S2) S2(t, dt); else if (S3) S3(t, dt); else if (S4) S4(t, dt);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    // Moves and draws the free particles: velocity, drag, gravity, a curl,
    // alpha by age. Returns nothing; spent ones are dropped.
    function stepFree(dt, mode = "lighter") {
      ctx.globalCompositeOperation = mode;
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        if (p.delay > 0) { p.delay -= dt; continue; }
        p.age += dt;
        if (p.age >= p.life) { parts.splice(i, 1); continue; }
        const k = p.age / p.life;
        if (p.drag) { const f = Math.exp(-p.drag * dt); p.vx *= f; p.vy *= f; }
        p.vy += (p.g || 0) * dt;
        if (p.curl) p.vx += Math.sin(p.age * p.curlF + p.ph) * p.curl * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.size += (p.grow || 0) * dt;
        let a = p.a * (p.fadeIn ? clamp01(p.age / p.fadeIn) : 1) * (1 - k) ** (p.fadePow || 1);
        if (p.flicker) a *= 0.55 + 0.45 * Math.sin(p.age * p.flicker + p.ph);
        if (exitAt != null && p.exitFade) a *= 1 - clamp01(since() / p.exitFade);
        if (a <= 0.003) continue;
        ctx.globalAlpha = Math.min(1, a);
        const s = p.size;
        ctx.drawImage(p.spr, p.x - s, p.y - s, s * 2, s * 2);
      }
      ctx.globalAlpha = 1;
    }
    const spark = (x, y, extra) => ({ x, y, vx: 0, vy: 0, age: 0, life: 1, size: 2, a: 1, delay: 0, ph: rand(0, TAU), ...extra });

    /* ---------- 1. Embers ---------- */
    function setup1() {
      const sil = silhouette(shot, S.w, S.h);
      const cols = [accent, accent, accent, "#ffffff", "#ffd27a"];
      // The gathering: each target point gets an ember from under the screen.
      const gather = sil.pts.map(([x, y]) => ({
        tx: S.x + x, ty: S.y + y,
        sx: S.x + x + rand(-0.45, 0.45) * W, sy: H + rand(10, 220),
        delay: rand(0, 0.45) + (1 - y / S.h) * 0.25, dur: rand(0.75, 1.15),
        wob: rand(-60, 60), size: rand(1.2, 2.6), spr: sprite(pick(cols), 0.3),
      }));
      let emitAcc = 0, burst = false;
      return (t, dt) => {
        ctx.globalCompositeOperation = "lighter";
        for (const g of gather) {
          const k = clamp01((t - g.delay) / g.dur);
          if (k <= 0) continue;
          const e = outCubic(k);
          const x = g.sx + (g.tx - g.sx) * e + Math.sin(k * Math.PI) * g.wob;
          const y = g.sy + (g.ty - g.sy) * e;
          const a = k < 1 ? 1 : 1 - clamp01((t - g.delay - g.dur) / 0.5);   // landed: it becomes the photo
          if (a <= 0 || exitAt != null) continue;
          ctx.globalAlpha = a;
          const s = g.size * (k < 1 ? 1.4 : 1);
          ctx.drawImage(g.spr, x - s, y - s, s * 2, s * 2);
        }
        ctx.globalAlpha = 1;
        // Holding: embers keep lifting off the top of him.
        if (t > 1.1 && exitAt == null) {
          emitAcc += dt * 55;
          while (emitAcc >= 1) {
            emitAcc--;
            const [x, y] = pick(sil.edge);
            parts.push(spark(S.x + x, S.y + y, { vx: rand(-14, 14), vy: -rand(25, 70), life: rand(1.2, 2.4), size: rand(1.2, 2.8), curl: 30, curlF: rand(2, 4), flicker: rand(12, 24), spr: sprite(pick(cols), 0.3), exitFade: 0.4 }));
          }
        }
        // Leaving: he comes apart into embers that blow off up and away.
        if (exitAt != null && !burst) {
          burst = true;
          for (const [x, y] of sil.pts.slice(0, 900)) {
            parts.push(spark(S.x + x, S.y + y, { vx: rand(-40, 90), vy: -rand(60, 260), drag: 1.2, g: -40, life: rand(0.5, 0.95), size: rand(1.2, 2.6), delay: (1 - y / S.h) * 0.18, spr: sprite(pick(cols), 0.3) }));
          }
        }
        stepFree(dt);
      };
    }

    /* ---------- 2. Smoke trail ---------- */
    function setup2() {
      const cols = [accent, accent, accent, "#ffffff", "#ffffff", ground];
      const inDur = 0.75, outDur = 0.55;
      let emitAcc = 0, prevX = -W;
      const offsetAt = (t) => {
        if (exitAt != null) return W * 1.05 * inCubic(clamp01(since() / outDur));
        return -(S.x + S.w * 0.9) * (1 - outCubic(clamp01(t / inDur)));   // from just off the left edge
      };
      const puff = (x, y, fast) => parts.push(spark(x, y, {
        vx: fast ? rand(-160, -40) : rand(-12, 12), vy: fast ? rand(-50, 15) : -rand(22, 55),
        drag: fast ? 1.4 : 0.3, life: fast ? rand(1.8, 3) : rand(2.2, 3.4),
        size: fast ? rand(9, 20) : rand(12, 24), grow: fast ? rand(40, 70) : rand(18, 30),
        a: fast ? 0.42 : 0.2, fadeIn: 0.12, fadePow: 1.3, curl: fast ? 40 : 70, curlF: rand(1.4, 2.6),
        spr: sprite(pick(cols), 0), exitFade: fast ? 0 : 0.5,
      }));
      return (t, dt) => {
        const off = offsetAt(t);
        const skew = exitAt != null ? -14 * clamp01(since() / outDur) : -14 * (1 - outCubic(clamp01(t / inDur)));
        shot.style.transform = `translateX(${off}px) skewX(${skew}deg)`;
        // Trail: puffs off his back edge, as many as his speed asks for.
        const speed = Math.abs(off - prevX) / Math.max(dt, 1e-3); prevX = off;
        if (speed > 40) {
          emitAcc += dt * Math.min(520, speed / 4);
          while (emitAcc >= 1) {
            emitAcc--;
            // Off his back: the left edge of him running in, the left edge again running out.
            const back = S.x + off + S.w * 0.14;
            puff(back + rand(-24, 8), S.y + S.h * rand(0.1, 0.9), true);
          }
        } else if (exitAt == null && t > inDur) {
          // Holding: a plume curls up behind him.
          emitAcc += dt * 44;
          // Holding: a plume curls up past his shoulders on both sides (behind him it would be hidden).
          while (emitAcc >= 1) { emitAcc--; const side = Math.random() < 0.5 ? rand(0.02, 0.24) : rand(0.76, 0.98); puff(S.x + S.w * side, S.y + S.h * rand(0.45, 1), false); }
        }
        stepFree(dt, "screen");
      };
    }

    /* ---------- 3. Stardust pylon ---------- */
    function setup3() {
      const cx = S.x + S.w / 2;
      const orbit = [];
      for (let i = 0; i < 300; i++) {
        orbit.push({
          th: rand(0, TAU), r0: rand(0.35, 0.8) * Math.max(W, H) * 0.6, rEnd: rand(14, S.w * 0.36),
          y: S.y + S.h * rand(-0.1, 1.05), delay: rand(0, 0.4), dur: rand(0.9, 1.3),
          turns: rand(2.5, 4.5) * (Math.random() < 0.5 ? -1 : 1), w: rand(0.35, 0.9),
          size: rand(1, 2.4), spr: sprite(pick(league), 0.35), tw: rand(6, 14), ph: rand(0, TAU),
        });
      }
      const target = o.pts, countFrom = 1.0, countDur = 1.0;
      let burst = false;
      return (t, dt) => {
        ctx.globalCompositeOperation = "lighter";
        const fade = exitAt == null ? 1 : 1 - clamp01(since() / 0.4);
        for (const p of orbit) {
          const k = clamp01((t - p.delay) / p.dur);
          if (k <= 0) continue;
          const e = outCubic(k);
          const r = p.r0 * (1 - e) + p.rEnd * e;
          const th = p.th + p.turns * TAU * e + (k >= 1 ? (t - p.delay - p.dur) * p.w : 0);
          const x = cx + Math.cos(th) * r, y = p.y + Math.sin(th) * r * 0.28 * (1 - e) + Math.sin(th) * 6 * e;
          const a = (k < 1 ? 1 : 0.35 + 0.35 * Math.sin(t * p.tw + p.ph)) * fade;
          if (a <= 0) continue;
          ctx.globalAlpha = a;
          // Behind him on the far side of the orbit, in front on the near side: dimmer when behind.
          if (k >= 1 && Math.sin(th) < 0) ctx.globalAlpha = a * 0.5;
          const s = p.size;
          ctx.drawImage(p.spr, x - s, y - s, s * 2, s * 2);
        }
        ctx.globalAlpha = 1;
        // The points count up, and burst once when they land.
        if (ptsEl && !o.over) {
          const k = clamp01((t - countFrom) / countDur);
          ptsEl.textContent = o.fmt(k >= 1 ? target : target * outCubic(k));
          if (k >= 1 && !burst) {
            burst = true;
            const pr = ptsEl.getBoundingClientRect(), hr = host.getBoundingClientRect();
            const bx = pr.left - hr.left + pr.width / 2, by = pr.top - hr.top + pr.height / 2;
            for (let i = 0; i < 240; i++) {
              const a = rand(0, TAU), v = rand(90, 420);
              parts.push(spark(bx + rand(-pr.width / 3, pr.width / 3), by, { vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.7, drag: 2.4, g: 70, life: rand(0.7, 1.5), size: rand(1, 2.4), flicker: rand(10, 20), spr: sprite(pick(league), 0.35), exitFade: 0.3 }));
            }
          }
        }
        stepFree(dt);
      };
    }

    /* ---------- 4. Chalk dust ---------- */
    function setup4() {
      const cx = S.x + S.w / 2, horizon = S.y + S.h * 0.9;
      const gap = Math.max(90, W / 7);
      let scroll = 0, dusted = false, slide = 0;
      const speedAt = (t) => (exitAt != null ? 2800 * inCubic(clamp01(since() / 0.5)) : 2800 * (1 - outCubic(clamp01(t / 0.8))));
      const dustCols = ["#ffffff", "#ffffff", "#ffffff", "#e9efe6", "#9fd48b", accent];
      // A yard line in perspective: narrow at the horizon, wide at the bottom edge.
      const line = (X, a) => {
        const top = cx + (X - cx) * 0.55, bot = cx + (X - cx) * 1.5;
        ctx.globalAlpha = a;
        ctx.beginPath(); ctx.moveTo(top, horizon); ctx.lineTo(bot, H); ctx.stroke();
      };
      return (t, dt) => {
        const v = speedAt(t);
        scroll = (scroll + v * dt) % gap;
        ctx.globalCompositeOperation = "source-over";
        // The ground: a faint band from the horizon down, and the lines on it.
        const gr = ctx.createLinearGradient(0, horizon, 0, H);
        gr.addColorStop(0, "rgba(255,255,255,0)"); gr.addColorStop(1, "rgba(255,255,255,0.06)");
        ctx.fillStyle = gr; ctx.fillRect(0, horizon, W, H - horizon);
        // The lines fade out down the screen, so the facts under him sit on clear ground.
        const ink = ctx.createLinearGradient(0, horizon, 0, horizon + (H - horizon) * 0.55);
        ink.addColorStop(0, "#ffffff"); ink.addColorStop(1, "rgba(255,255,255,0)");
        ctx.strokeStyle = ink; ctx.lineWidth = 2;
        const fade = exitAt == null ? 1 : 1 - clamp01(since() / 0.55);
        for (let X = -gap * 4 - scroll; X < W + gap * 4; X += gap) {
          line(X, 0.3 * fade);
          // Motion streaks while it moves: ghost lines trailing each one.
          if (v > 200) for (let g = 1; g <= 3; g++) line(X + (v * 0.012) * g, (0.12 / g) * clamp01(v / 1400) * fade);
        }
        ctx.globalAlpha = 1;
        // Freeze: the dust bursts from his feet as the field stops.
        if (!dusted && t > 0.72) {
          dusted = true;
          const feet = S.y + S.h * 0.97;
          for (let i = 0; i < 520; i++) {
            const dir = Math.random() < 0.5 ? -1 : 1;
            parts.push(spark(cx + rand(-S.w * 0.22, S.w * 0.22), feet + rand(-6, 6), {
              vx: dir * rand(20, 420), vy: -rand(30, 360), drag: rand(2.6, 3.6), g: 9,
              life: rand(3.2, 5), size: rand(0.9, 2.6), a: rand(0.5, 0.95), curl: 6, curlF: rand(0.6, 1.4),
              spr: sprite(pick(dustCols), 0.45), exitFade: 0.5,
            }));
          }
          for (let i = 0; i < 50; i++) {
            parts.push(spark(cx + rand(-S.w * 0.35, S.w * 0.35), feet - rand(0, 40), {
              vx: rand(-120, 120), vy: -rand(10, 90), drag: 2, life: rand(3, 4.6), size: rand(18, 36), grow: 8,
              a: 0.08, fadeIn: 0.2, spr: sprite("#ffffff", 0), exitFade: 0.5,
            }));
          }
        }
        // Leaving: the field runs on and takes him with it.
        if (exitAt != null) { slide = -W * inCubic(clamp01(since() / 0.5)); shot.style.transform = `translateX(${slide}px)`; }
        stepFree(dt, "source-over");
      };
    }

    const onResize = () => measure();
    window.addEventListener("resize", onResize);
    return {
      exit() { if (exitAt == null) exitAt = now(); },
      stop() { dead = true; cancelAnimationFrame(raf); window.removeEventListener("resize", onResize); parts.length = 0; },
    };
  }

  return { play, STYLES: { 1: "Embers", 2: "Smoke", 3: "Pylon", 4: "Chalk", 5: "Embers bare" } };
})();
