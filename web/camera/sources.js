// sources.js: where the frames come from.
//
//   createCameraSource()     the real webcam (getUserMedia)
//   createSimulatedSource()  a drawn "face" with a known pulse, for demos and
//                            tests on machines with no camera. Always labelled
//                            "Simulated" in the UI and never saved as a camera reading.
//
// Both give the same small interface, so the rest of the code does not care:
//   { el, width, height, simulated, start(), stop(), onFrame(callback), landmarks? }

// ----------------------------------------------------------------------------
// Real camera
// ----------------------------------------------------------------------------
export function createCameraSource(video) {
  let stream = null;
  let running = false;
  return {
    el: video,
    simulated: false,
    get width() {
      return video.videoWidth;
    },
    get height() {
      return video.videoHeight;
    },
    async start() {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
      });
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await video.play();
      running = true;
    },
    stop() {
      running = false;
      if (stream) stream.getTracks().forEach((t) => t.stop()); // camera light goes off
      stream = null;
      video.srcObject = null;
    },
    /** Calls back once per NEW camera frame with a timestamp in milliseconds. */
    onFrame(callback) {
      const useVideoFrames = typeof video.requestVideoFrameCallback === "function";
      const tick = (now) => {
        if (!running) return;
        callback(now);
        if (useVideoFrames) video.requestVideoFrameCallback(tick);
        else requestAnimationFrame(tick);
      };
      if (useVideoFrames) video.requestVideoFrameCallback(tick);
      else requestAnimationFrame(tick);
    },
  };
}

// ----------------------------------------------------------------------------
// Simulated face (no camera needed)
// ----------------------------------------------------------------------------
export const SIM_CONFIG = {
  WIDTH: 640,
  HEIGHT: 480,
  BPM: 72,
  PULSE_AMP: 0.006, // pulse size as a share of skin brightness
  SKIN: [182, 128, 104],
  PULSE_VECTOR: [0.33, 0.77, 0.53], // how strongly each colour shows the pulse
};

/**
 * @param canvas  a <canvas> shown in place of the video
 * @param mode    "steady" | "shake" (head shaking) | "cover" (face hidden half the time) | "dark"
 */
export function createSimulatedSource(canvas, mode = "steady") {
  const W = SIM_CONFIG.WIDTH;
  const H = SIM_CONFIG.HEIGHT;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  let running = false;
  let face = { cx: W / 2, cy: H / 2 - 10, eye: 150, visible: true };
  const faceBox = { w: 300, h: 400 };
  const image = ctx.createImageData(faceBox.w, faceBox.h);

  function draw(nowMs) {
    const t = nowMs / 1000;
    const dim = mode === "dark" ? 0.18 : 1;
    // Head position: still, or shaking side to side twice a second.
    face.cx = W / 2 + (mode === "shake" ? 45 * Math.sin(2 * Math.PI * 2 * t) : 0);
    face.visible = mode === "cover" ? Math.floor(t / 1.5) % 2 === 0 : true;

    ctx.fillStyle = "#3a3a3a";
    ctx.fillRect(0, 0, W, H);
    // Skin colour with a tiny pulse. Random rounding per pixel keeps the
    // AVERAGE colour exact even though each pixel is a whole number 0-255.
    const wave = Math.cos((2 * Math.PI * SIM_CONFIG.BPM * t) / 60) + 0.25 * Math.cos((4 * Math.PI * SIM_CONFIG.BPM * t) / 60 + 0.6);
    const c = SIM_CONFIG.SKIN.map((base, i) => dim * base * (1 - SIM_CONFIG.PULSE_AMP * SIM_CONFIG.PULSE_VECTOR[i] * wave));
    const d = image.data;
    const rx = faceBox.w / 2;
    const ry = faceBox.h / 2;
    for (let y = 0; y < faceBox.h; y++) {
      for (let x = 0; x < faceBox.w; x++) {
        const i = (y * faceBox.w + x) * 4;
        const inside = ((x - rx) / rx) ** 2 + ((y - ry) / ry) ** 2 <= 1;
        if (inside && face.visible) {
          d[i] = Math.floor(c[0] + Math.random());
          d[i + 1] = Math.floor(c[1] + Math.random());
          d[i + 2] = Math.floor(c[2] + Math.random());
        } else {
          d[i] = d[i + 1] = d[i + 2] = 58;
        }
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(image, Math.round(face.cx - rx), Math.round(face.cy - ry));
    if (face.visible) {
      // Eyes and mouth, only so it reads as a face on screen.
      ctx.fillStyle = "#2b2b2b";
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(face.cx + side * 50, face.cy, 20, 9, 0, 0, 2 * Math.PI);
        ctx.fill();
      }
      ctx.fillRect(face.cx - 34, face.cy + 108, 68, 7);
    }
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = "600 14px system-ui, sans-serif";
    ctx.fillText("SIMULATED SIGNAL", 14, 24);
  }

  return {
    el: canvas,
    simulated: true,
    mode,
    width: W,
    height: H,
    truthBpm: SIM_CONFIG.BPM,
    async start() {
      running = true;
      draw(performance.now());
    },
    stop() {
      running = false;
    },
    onFrame(callback) {
      const tick = (now) => {
        if (!running) return;
        draw(now);
        callback(now);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
    /** Stands in for the face model: where the drawn face is right now. */
    landmarks() {
      if (!face.visible) return null;
      const lm = [];
      const set = (i, x, y) => {
        lm[i] = { x: x / W, y: y / H, z: 0 };
      };
      set(33, face.cx - face.eye / 2, face.cy);
      set(263, face.cx + face.eye / 2, face.cy);
      set(1, face.cx, face.cy + 55);
      set(152, face.cx, face.cy + 195);
      // Mouth and brow points, and simple blendshapes with a blink every 4 s,
      // so the opt-in facial-behaviour check (H2) can run on the simulation too.
      set(61, face.cx - 34, face.cy + 110);
      set(291, face.cx + 34, face.cy + 110);
      set(13, face.cx, face.cy + 106);
      set(14, face.cx, face.cy + 114);
      set(105, face.cx - 50, face.cy - 28);
      set(334, face.cx + 50, face.cy - 28);
      const t = performance.now() / 1000;
      const blink = t % 4 < 0.2 ? 0.9 : 0.05;
      const blendshapes = [
        { categoryName: "eyeBlinkLeft", score: blink },
        { categoryName: "eyeBlinkRight", score: blink },
        { categoryName: "browDownLeft", score: 0.1 },
        { categoryName: "browDownRight", score: 0.1 },
      ];
      return { landmarks: lm, blendshapes };
    },
  };
}
