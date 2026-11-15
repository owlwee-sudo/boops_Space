/*
 * BOOPS landing page: 3D body-systems map (Day 97, Crew A1, Simulated).
 *
 * Draws the risk engine's driver weights as a small 3D graph on a <canvas>.
 * No libraries, no network: a hand-rolled perspective projection, flat colours,
 * drag to rotate, slow auto-rotate (off when the user prefers reduced motion).
 */
(function () {
  "use strict";

  const canvas = document.getElementById("systems3d");
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext("2d");

  // ---- Config -------------------------------------------------------------
  const INK = "#111827";
  const MUTED = "#94a3b8";
  const LINE = "#cbd5e1";
  const LEVEL = { act: "#dc2626", watch: "#d97706", normal: "#0fb869" };
  const AUTO_SPEED = 0.0035; // radians per frame
  const TILT = 0.38; // default pitch (radians)
  const CAMERA = 5.2; // camera distance from origin
  const FLOOR = -0.8; // y of the dashed floor rings
  const Y_SHIFT = 0.1; // nudges the whole model so it sits centred

  // Outcomes sit on an inner ring; inputs on an outer ring at varied heights.
  // `on` marks a driver that is elevated on Day 97 for Crew A1 (Simulated).
  const nodes = [
    { id: "immune", label: "Immune 88", level: "act", outcome: true, a: 90, r: 1.0, y: 0.0 },
    { id: "cardio", label: "Heart 49", level: "watch", outcome: true, a: 210, r: 1.0, y: 0.15 },
    { id: "bone", label: "Bone & muscle 15", level: "normal", outcome: true, a: 330, r: 1.0, y: -0.1 },

    { id: "stress", label: "Stress (HRV)", on: true, a: 20, r: 1.85, y: 0.55 },
    { id: "sleep", label: "Sleep deficit", on: true, a: 75, r: 1.9, y: -0.5 },
    { id: "rhr", label: "Resting HR jump", on: true, a: 135, r: 1.85, y: 0.6 },
    { id: "rad", label: "Radiation (SPE)", on: true, a: 185, r: 1.9, y: -0.45 },
    { id: "eva", label: "EVA, last 3 days", on: false, a: 245, r: 1.85, y: 0.5 },
    { id: "time", label: "Time in flight", on: false, a: 295, r: 1.9, y: -0.55 },
    { id: "resist", label: "Resistance exercise", on: false, a: 345, r: 1.85, y: 0.45 },
  ];

  // Immune weights match the risk engine (AGENTS.md section 5).
  const edges = [
    ["stress", "immune", 0.30],
    ["sleep", "immune", 0.25],
    ["eva", "immune", 0.15],
    ["rad", "immune", 0.10],
    ["time", "immune", 0.10],
    ["rhr", "immune", 0.10],
    ["stress", "cardio", 0.20],
    ["sleep", "cardio", 0.15],
    ["rhr", "cardio", 0.20],
    ["resist", "bone", 0.30],
    ["stress", "bone", 0.15],
    ["time", "bone", 0.15],
  ];

  const byId = {};
  nodes.forEach((n) => {
    const rad = (n.a * Math.PI) / 180;
    n.x = Math.cos(rad) * n.r;
    n.z = Math.sin(rad) * n.r;
    byId[n.id] = n;
  });

  function linked(a, b) {
    return edges.some((e) => (e[0] === a && e[1] === b) || (e[1] === a && e[0] === b));
  }

  // ---- State --------------------------------------------------------------
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let yaw = 0.6;
  let pitch = TILT;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let hover = null;
  let visible = true;
  let width = 0;
  let height = 0;
  let projected = [];

  // ---- Geometry -----------------------------------------------------------
  function project(x, y, z) {
    y += Y_SHIFT;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const x1 = x * cy - z * sy;
    const z1 = x * sy + z * cy;
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const y2 = y * cp - z1 * sp;
    const z2 = y * sp + z1 * cp;
    const base = Math.min(width * 0.32, height * 0.62);
    const scale = (base * CAMERA) / (CAMERA - z2) / 1.9;
    return { sx: width / 2 + x1 * scale, sy: height / 2 - y2 * scale, depth: z2, scale };
  }

  function depthAlpha(depth) {
    // depth is roughly -2..2; the front is opaque, the back fades.
    return Math.max(0.3, Math.min(1, 0.64 + depth * 0.2));
  }

  function radius(n, p) {
    return (n.outcome ? 0.15 : 0.08) * p.scale;
  }

  // ---- Drawing ------------------------------------------------------------
  function drawRing(r) {
    ctx.beginPath();
    for (let i = 0; i <= 72; i++) {
      const t = (i / 72) * Math.PI * 2;
      const p = project(Math.cos(t) * r, FLOOR, Math.sin(t) * r);
      if (i === 0) ctx.moveTo(p.sx, p.sy);
      else ctx.lineTo(p.sx, p.sy);
    }
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function draw() {
    if (!width || !height) return;
    ctx.clearRect(0, 0, width, height);
    drawRing(1.88);
    drawRing(1.0);

    projected = nodes.map((n) => ({ n, p: project(n.x, n.y, n.z) }));
    const P = {};
    projected.forEach((o) => (P[o.n.id] = o.p));

    // Floor shadows first: a flat depth cue, no gradients.
    projected.forEach(({ n, p }) => {
      const f = project(n.x, FLOOR, n.z);
      const r = radius(n, p);
      ctx.beginPath();
      ctx.ellipse(f.sx, f.sy, r * 0.9, r * 0.3, 0, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(15, 23, 42, 0.07)";
      ctx.fill();
    });

    // Edges, back to front.
    edges
      .map(([from, to, w]) => ({ from, to, w, d: (P[from].depth + P[to].depth) / 2 }))
      .sort((a, b) => a.d - b.d)
      .forEach((e) => {
        const a = P[e.from], b = P[e.to];
        const live = byId[e.from].on;
        const focus = hover && (hover.id === e.from || hover.id === e.to);
        const dim = hover && !focus;
        ctx.beginPath();
        ctx.moveTo(a.sx, a.sy);
        ctx.lineTo(b.sx, b.sy);
        ctx.strokeStyle = live ? LEVEL[byId[e.to].level] : MUTED;
        ctx.globalAlpha = (dim ? 0.1 : live ? 0.8 : 0.4) * depthAlpha(e.d);
        ctx.lineWidth = 0.8 + e.w * 9;
        ctx.lineCap = "round";
        ctx.stroke();
      });
    ctx.globalAlpha = 1;

    // Nodes and labels, back to front.
    projected
      .slice()
      .sort((a, b) => a.p.depth - b.p.depth)
      .forEach(({ n, p }) => {
        const alpha = depthAlpha(p.depth);
        const dim = hover && hover !== n && !linked(hover.id, n.id);
        ctx.globalAlpha = dim ? alpha * 0.3 : alpha;
        const r = radius(n, p);

        ctx.beginPath();
        ctx.arc(p.sx, p.sy, r, 0, Math.PI * 2);
        ctx.fillStyle = n.outcome ? LEVEL[n.level] : n.on ? INK : "#ffffff";
        ctx.fill();
        ctx.lineWidth = n.outcome ? 3 : 1.5;
        ctx.strokeStyle = n.outcome ? "#ffffff" : n.on ? INK : MUTED;
        ctx.stroke();

        // Only label what faces the viewer (and, on narrow screens, only live drivers),
        // so labels never pile up. Hover always shows the label.
        const narrow = width < 420;
        const showLabel =
          n === hover ||
          (n.outcome && (!narrow || p.depth > -0.2)) ||
          (!n.outcome && p.depth > -0.35 && (!narrow || n.on));
        if (!showLabel) return;
        const size = n.outcome ? 13 : narrow ? 11 : 12;
        ctx.font = `${n.outcome ? 700 : 500} ${size}px Inter, system-ui, sans-serif`;
        ctx.textBaseline = "middle";
        let tx, ty;
        if (n.outcome) {
          // outcome labels sit under their node, centred
          ctx.textAlign = "center";
          tx = p.sx;
          ty = p.sy + r + 11;
        } else {
          const w = ctx.measureText(n.label).width;
          let right = p.sx >= width / 2;
          if (right && p.sx + r + 6 + w > width - 4) right = false;
          if (!right && p.sx - r - 6 - w < 4) right = true;
          ctx.textAlign = right ? "left" : "right";
          tx = p.sx + (right ? r + 6 : -r - 6);
          ty = p.sy;
        }
        // white halo keeps text readable over the lines
        ctx.lineJoin = "round";
        ctx.lineWidth = 4;
        ctx.strokeStyle = "#ffffff";
        ctx.strokeText(n.label, tx, ty);
        ctx.fillStyle = n.outcome || n.on ? INK : "#64748b";
        ctx.fillText(n.label, tx, ty);
      });
    ctx.globalAlpha = 1;
  }

  // ---- Loop ---------------------------------------------------------------
  function frame() {
    if (visible && !dragging && !hover && !reduceMotion) {
      yaw += AUTO_SPEED;
      draw();
    }
    requestAnimationFrame(frame);
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = rect.width;
    height = rect.height;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  // ---- Input --------------------------------------------------------------
  function pick(x, y) {
    let best = null;
    let bestD = Infinity;
    projected.forEach(({ n, p }) => {
      const d = Math.hypot(p.sx - x, p.sy - y);
      if (d < radius(n, p) + 6 && d < bestD) {
        best = n;
        bestD = d;
      }
    });
    return best;
  }

  canvas.addEventListener("pointerdown", (e) => {
    dragging = true;
    hover = null;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = "grabbing";
  });
  canvas.addEventListener("pointermove", (e) => {
    if (dragging) {
      yaw += (e.clientX - lastX) * 0.01;
      pitch = Math.max(-0.1, Math.min(1.1, pitch + (e.clientY - lastY) * 0.006));
      lastX = e.clientX;
      lastY = e.clientY;
      draw();
      return;
    }
    if (e.pointerType !== "mouse") return;
    const rect = canvas.getBoundingClientRect();
    const hit = pick(e.clientX - rect.left, e.clientY - rect.top);
    if (hit !== hover) {
      hover = hit;
      canvas.style.cursor = hit ? "pointer" : "grab";
      draw();
    }
  });
  function release() {
    dragging = false;
    canvas.style.cursor = "grab";
  }
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  canvas.addEventListener("pointerleave", () => {
    if (!dragging && hover) {
      hover = null;
      draw();
    }
  });

  if ("IntersectionObserver" in window) {
    new IntersectionObserver((entries) => {
      visible = entries[0].isIntersecting;
    }).observe(canvas);
  }
  if ("ResizeObserver" in window) new ResizeObserver(resize).observe(canvas);
  else window.addEventListener("resize", resize);

  canvas.style.cursor = "grab";
  resize();
  requestAnimationFrame(frame);
})();
