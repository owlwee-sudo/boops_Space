// face-tracker.js: find the face, place the skin patches, read their colour.
//
// Uses MediaPipe FaceLandmarker, loaded from /web/vendor so it works with no
// internet. Frames are read in memory only: nothing is stored or uploaded.
//
// Prototype. Not a medical device.

// ----------------------------------------------------------------------------
// Config
// ----------------------------------------------------------------------------
export const TRACKER_CONFIG = {
  VENDOR_DIR: new URL("../vendor/mediapipe/", import.meta.url).href,
  MODEL_FILE: "face_landmarker.task",
  // Skin patches, measured in "eye widths" (distance between the two outer
  // eye corners = 1). x runs along the eye line, y runs down towards the chin.
  // They sit on the forehead and both cheeks and stay clear of eyes and mouth.
  PATCHES: [
    { name: "forehead", cx: 0.0, cy: -0.5, halfW: 0.36, halfH: 0.13 },
    { name: "left cheek", cx: -0.37, cy: 0.42, halfW: 0.16, halfH: 0.14 },
    { name: "right cheek", cx: 0.37, cy: 0.42, halfW: 0.16, halfH: 0.14 },
  ],
  // Pixels darker or brighter than this carry no pulse information ("clipped").
  PIXEL_MIN: 20,
  PIXEL_MAX: 250,
  PIXEL_STEP: 2, // read every 2nd pixel in each direction: 4x faster, same average
};

// MediaPipe face-mesh landmark numbers we rely on.
const LM = { EYE_OUTER_A: 33, EYE_OUTER_B: 263, NOSE_TIP: 1, CHIN: 152 };

// ----------------------------------------------------------------------------
// Face landmarker (MediaPipe)
// ----------------------------------------------------------------------------
/**
 * Load the face model from local files.
 * @param {{blendshapes?: boolean}} options  blendshapes are only needed by the
 *        opt-in facial-behaviour feature (H2), so they are off by default.
 * @returns {Promise<{detect(frame, tMs): {landmarks, blendshapes}|null, close(): void}>}
 */
export async function createFaceTracker(options = {}) {
  const { FaceLandmarker } = await import(TRACKER_CONFIG.VENDOR_DIR + "vision_bundle.mjs");
  const fileset = {
    wasmLoaderPath: TRACKER_CONFIG.VENDOR_DIR + "wasm/vision_wasm_internal.js",
    wasmBinaryPath: TRACKER_CONFIG.VENDOR_DIR + "wasm/vision_wasm_internal.wasm",
  };
  const make = (delegate) =>
    FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: TRACKER_CONFIG.VENDOR_DIR + TRACKER_CONFIG.MODEL_FILE, delegate },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: Boolean(options.blendshapes),
    });
  let landmarker;
  try {
    landmarker = await make("GPU");
  } catch (err) {
    console.warn("Face model: GPU not available, using CPU.", err);
    landmarker = await make("CPU");
  }
  let lastT = -1;
  return {
    detect(frame, tMs) {
      // MediaPipe needs strictly increasing timestamps.
      const t = Math.max(Math.round(tMs), lastT + 1);
      lastT = t;
      const res = landmarker.detectForVideo(frame, t);
      if (!res.faceLandmarks || res.faceLandmarks.length === 0) return null;
      return {
        landmarks: res.faceLandmarks[0],
        blendshapes: res.faceBlendshapes && res.faceBlendshapes[0] ? res.faceBlendshapes[0].categories : null,
      };
    },
    close() {
      landmarker.close();
    },
  };
}

// ----------------------------------------------------------------------------
// Geometry: where is the face, where are the skin patches
// ----------------------------------------------------------------------------
/**
 * Face position, size and tilt in pixels, from the landmarks.
 * @returns {{cx, cy, size, ax, ay, bx, by}} centre between the eyes, eye width
 *          in pixels, unit vector along the eyes (a) and down the face (b)
 */
export function facePose(landmarks, width, height) {
  const p = (i) => ({ x: landmarks[i].x * width, y: landmarks[i].y * height });
  const e1 = p(LM.EYE_OUTER_A);
  const e2 = p(LM.EYE_OUTER_B);
  const chin = p(LM.CHIN);
  const cx = (e1.x + e2.x) / 2;
  const cy = (e1.y + e2.y) / 2;
  const size = Math.hypot(e2.x - e1.x, e2.y - e1.y);
  if (!(size > 1)) return null;
  const ax = (e2.x - e1.x) / size;
  const ay = (e2.y - e1.y) / size;
  // "Down the face" is at right angles to the eye line, on the chin side.
  let bx = -ay;
  let by = ax;
  if (bx * (chin.x - cx) + by * (chin.y - cy) < 0) {
    bx = -bx;
    by = -by;
  }
  return { cx, cy, size, ax, ay, bx, by };
}

/** The three skin patches as tilted rectangles in pixel coordinates. */
export function skinPatches(pose) {
  return TRACKER_CONFIG.PATCHES.map((d) => {
    const cx = pose.cx + (d.cx * pose.ax + d.cy * pose.bx) * pose.size;
    const cy = pose.cy + (d.cx * pose.ay + d.cy * pose.by) * pose.size;
    const hw = d.halfW * pose.size;
    const hh = d.halfH * pose.size;
    const corner = (su, sv) => ({
      x: cx + su * hw * pose.ax + sv * hh * pose.bx,
      y: cy + su * hw * pose.ay + sv * hh * pose.by,
    });
    return { name: d.name, cx, cy, hw, hh, pose, corners: [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)] };
  });
}

// ----------------------------------------------------------------------------
// Colour: average the skin pixels inside the patches
// ----------------------------------------------------------------------------
/**
 * @param ctx      2D context that already holds the current frame
 * @param patches  from skinPatches()
 * @returns {{r,g,b, luma, clipped, pixels}|null} mean colour of usable skin
 *          pixels, mean brightness of the whole patch, share of clipped pixels.
 *          null if the patches are off-screen.
 */
export function samplePatches(ctx, patches, width, height) {
  const step = TRACKER_CONFIG.PIXEL_STEP;
  let sr = 0, sg = 0, sb = 0, used = 0, clipped = 0, seen = 0, lumaAll = 0;
  for (const patch of patches) {
    const xs = patch.corners.map((c) => c.x);
    const ys = patch.corners.map((c) => c.y);
    const x0 = Math.max(0, Math.floor(Math.min(...xs)));
    const y0 = Math.max(0, Math.floor(Math.min(...ys)));
    const x1 = Math.min(width, Math.ceil(Math.max(...xs)));
    const y1 = Math.min(height, Math.ceil(Math.max(...ys)));
    if (x1 - x0 < 2 || y1 - y0 < 2) continue;
    const data = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
    const { ax, ay, bx, by } = patch.pose;
    for (let y = y0; y < y1; y += step) {
      for (let x = x0; x < x1; x += step) {
        // Is this pixel inside the tilted rectangle?
        const dx = x - patch.cx;
        const dy = y - patch.cy;
        if (Math.abs(dx * ax + dy * ay) > patch.hw || Math.abs(dx * bx + dy * by) > patch.hh) continue;
        const i = ((y - y0) * (x1 - x0) + (x - x0)) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        seen++;
        lumaAll += 0.299 * r + 0.587 * g + 0.114 * b;
        const hi = Math.max(r, g, b);
        const lo = Math.min(r, g, b);
        if (hi > TRACKER_CONFIG.PIXEL_MAX || lo < TRACKER_CONFIG.PIXEL_MIN) {
          clipped++;
          continue;
        }
        sr += r; sg += g; sb += b;
        used++;
      }
    }
  }
  if (seen === 0) return null;
  const luma = lumaAll / seen; // brightness of the whole patch, clipped pixels included
  if (used === 0) return { r: 0, g: 0, b: 0, luma, clipped: 1, pixels: 0 };
  return { r: sr / used, g: sg / used, b: sb / used, luma, clipped: clipped / seen, pixels: used };
}

// ----------------------------------------------------------------------------
// Motion: how fast the head moves, in eye-widths per second
// ----------------------------------------------------------------------------
export function createMotionMeter() {
  let prev = null;
  let smooth = null; // lightly smoothed pose, so landmark jitter is not counted as motion
  let sum = 0;
  let count = 0;
  let recent = 0; // smoothed, for live feedback
  return {
    /** Call once per frame with a face. Returns the smoothed live motion. */
    update(rawPose, tS) {
      const k = 0.35;
      smooth = smooth
        ? {
            cx: smooth.cx + k * (rawPose.cx - smooth.cx),
            cy: smooth.cy + k * (rawPose.cy - smooth.cy),
            size: smooth.size + k * (rawPose.size - smooth.size),
          }
        : { cx: rawPose.cx, cy: rawPose.cy, size: rawPose.size };
      const pose = smooth;
      if (prev && tS > prev.tS) {
        const dt = tS - prev.tS;
        // Movement of the face centre plus change of size (moving closer/away),
        // both measured against the face size so distance to camera cancels.
        const shift = Math.hypot(pose.cx - prev.cx, pose.cy - prev.cy) / pose.size;
        const zoom = Math.abs(pose.size - prev.size) / pose.size;
        const speed = (shift + zoom) / dt;
        if (dt < 0.5) {
          sum += speed;
          count++;
          recent = recent === 0 ? speed : 0.85 * recent + 0.15 * speed;
        }
      }
      prev = { cx: pose.cx, cy: pose.cy, size: pose.size, tS };
      return recent;
    },
    /** A lost face breaks the chain: do not measure across the gap. */
    lostFace() {
      prev = null;
      smooth = null;
    },
    mean() {
      return count ? sum / count : 0;
    },
    recent() {
      return recent;
    },
  };
}
