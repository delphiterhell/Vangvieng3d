import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

gsap.registerPlugin(ScrollTrigger);

/* ---------- Regia: tutti i valori da ritoccare stanno qui ---------- */

const ASSETS = {
  photo: "../depth-version/images/landscape.jpg",
  model: "../depth-version/models/balloon.optimized.glb",
  width: 2752,
  height: 1536
};

// Spazio della scena: 1 unità = altezza della mongolfiera.
// La telecamera guarda verso -z; x positivo è a destra, y è l'alto.
//
// Ogni scena è un punto chiave del percorso:
//   at      = punto dello scroll (0–1) in cui la telecamera ci arriva
//   pos     = posizione della telecamera
//   yaw     = gradi verso destra, pitch = gradi verso l'alto, roll = inclinazione
//   balloon = posizione della mongolfiera (qui resta ferma nell'origine)
// Tra i punti passano tre CatmullRomCurve3: posizione, orientamento, mongolfiera.
//
// La telecamera passa a sinistra della mongolfiera (x negativo): l'involucro ha
// raggio 0.38, non ridurre |x| dei punti 3 e 4 sotto 0.8. Controlla sempre con ?verify.
const SHOTS = {
  wide: {
    aspect: 1.5, // da questo rapporto larghezza/altezza in su vale la regia "wide"
    fov: 40,
    keys: [
      { at: 0, pos: [-1.9, -0.6, 12.5], yaw: 0.5, pitch: 0, roll: 0 },      // 1 — introduzione
      { at: 0.38, pos: [-1.25, -0.2, 4.6], yaw: 6, pitch: 0.5, roll: 0 },   // 2 — avvicinamento
      { at: 0.62, pos: [-0.85, 0.12, 1.3], yaw: 18, pitch: 2, roll: -2 },   // 3 — momento wow
      { at: 0.8, pos: [-0.85, 0.3, -0.9], yaw: 6, pitch: 1.5, roll: 0 },    // 4 — superamento
      { at: 1, pos: [-0.5, 0.55, -2.6], yaw: 0, pitch: 0.5, roll: 0 }       // 5 — panorama
    ]
  },
  portrait: {
    aspect: 0.62, // da questo rapporto in giù vale la regia "portrait"; in mezzo si sfuma
    fov: 55,
    keys: [
      { pos: [-0.75, -0.75, 10.5], yaw: 1, pitch: 0, roll: 0 },
      { pos: [-0.8, -0.3, 4.2], yaw: 7, pitch: 0.5, roll: 0 },
      { pos: [-0.85, 0.1, 1.5], yaw: 24, pitch: 2, roll: -1.5 },
      { pos: [-0.85, 0.3, -0.9], yaw: 8, pitch: 1.5, roll: 0 },
      { pos: [-0.5, 0.55, -2.6], yaw: 0, pitch: 0.5, roll: 0 }
    ]
  }
};

// Respiro della telecamera a scroll fermo, come una ripresa aerea:
// spostamento in altezze della mongolfiera, rotazione in gradi. 0 = immobile.
const DRIFT = { position: 0.008, angle: 0.08 };

// La fotografia è un piano lontano, mai deformato e mai attraversato.
// La sua dimensione viene calcolata dal percorso (vedi buildShot): copre sempre
// l'inquadratura, quindi i bordi non possono entrare in campo.
const BACKDROP = { distance: 40, margin: 0.02 };

const CAMERA = { near: 0.05, far: 200 };

const BALLOON = {
  yaw: 0.12, // orientamento iniziale, radianti
  spin: 0.5, // rotazione sul proprio asse lungo tutto il volo, radianti
  bob: 0.012, // galleggiamento, in altezze della mongolfiera
  tilt: 0.8 // oscillazione nel vento, gradi
};

// Luce dell'alba: il sole è basso a sinistra, dietro la mongolfiera, come nella fotografia.
// Il cielo già chiaro illumina il lato rivolto alla telecamera.
const LIGHT = {
  sun: { color: 0xffb37a, intensity: 2.2, position: [-6, 1.2, -5] },
  sky: { color: 0xffe6d6, ground: 0x56627a, intensity: 1.5 },
  fill: { color: 0xffe1cf, intensity: 1.1, position: [-3, 2.5, 6] }
};

// Foschia sulla mongolfiera: più è lontana, più si vela.
const HAZE = { color: 0xcdd3e2, near: 2, far: 38 };

// Banchi di foschia tra la telecamera e il panorama: scorrendo accanto alla
// telecamera danno la misura della velocità. count: 0 li disattiva.
const MIST = {
  count: { desktop: 26, mobile: 14 },
  color: 0xf1ded8,
  opacity: [0.07, 0.18],
  size: [3, 6.5],
  box: { x: [-7, 7], y: [-2.6, 1.2], z: [-10, 11] },
  fadeNear: [0.8, 3.5], // svaniscono avvicinandosi alla telecamera: niente tagli netti
  fadeFar: [14, 22],
  clear: 2.2 // raggio libero attorno alla mongolfiera
};

/* ---------- Percorso della telecamera ---------- */

const rad = THREE.MathUtils.degToRad;
const photoAspect = ASSETS.width / ASSETS.height;

// Curva morbida e sempre crescente attraverso i punti (xs, ys), ferma agli estremi:
// la telecamera parte e si arresta dolcemente e non torna mai indietro.
function monotone(xs, ys) {
  const n = xs.length;
  const secants = [];
  for (let i = 0; i < n - 1; i++) secants.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const slopes = [0];
  for (let i = 1; i < n - 1; i++) slopes.push((secants[i - 1] + secants[i]) / 2);
  slopes.push(0);
  for (let i = 0; i < n - 1; i++) {
    const a = slopes[i] / secants[i];
    const b = slopes[i + 1] / secants[i];
    const length = Math.hypot(a, b);
    if (length > 3) {
      slopes[i] = (3 / length) * a * secants[i];
      slopes[i + 1] = (3 / length) * b * secants[i];
    }
  }
  return (x) => {
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = THREE.MathUtils.clamp((x - xs[i]) / h, 0, 1);
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * slopes[i]
      + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * slopes[i + 1];
  };
}

// Costruisce percorso, orientamento e piano della fotografia per un dato schermo.
// Non tocca il DOM: ?verify la usa per controllare anche altri formati.
function buildShot(aspect, focus) {
  const mix = THREE.MathUtils.smoothstep(aspect, SHOTS.portrait.aspect, SHOTS.wide.aspect);
  const lerp = THREE.MathUtils.lerp;
  const fov = lerp(SHOTS.portrait.fov, SHOTS.wide.fov, mix);
  const tanV = Math.tan(rad(fov / 2));
  const tanH = tanV * aspect;
  const vector = (array) => new THREE.Vector3().fromArray(array || [0, 0, 0]);

  const points = [];
  const angles = [];
  const balloonPoints = [];
  SHOTS.wide.keys.forEach((wide, i) => {
    const portrait = SHOTS.portrait.keys[i];
    points.push(vector(portrait.pos).lerp(vector(wide.pos), mix));
    balloonPoints.push(vector(portrait.balloon || wide.balloon).lerp(vector(wide.balloon), mix));
    angles.push(new THREE.Vector3(
      lerp(portrait.yaw, wide.yaw, mix),
      lerp(portrait.pitch, wide.pitch, mix),
      lerp(portrait.roll, wide.roll, mix)
    ));
  });

  const path = new THREE.CatmullRomCurve3(points, false, "centripetal");
  const orientation = new THREE.CatmullRomCurve3(angles, false, "centripetal");
  const balloonPath = new THREE.CatmullRomCurve3(balloonPoints, false, "centripetal");
  const timing = monotone(
    SHOTS.wide.keys.map((key) => key.at),
    SHOTS.wide.keys.map((key, i) => i / (SHOTS.wide.keys.length - 1))
  );

  // Posa della scena a un certo punto dello scroll (0–1): dipende solo dallo scroll,
  // quindi scorrendo all'indietro il volo si riavvolge identico.
  // angles: x = yaw, y = pitch, z = roll, in gradi.
  function pose(progress, out) {
    out.flight = timing(progress);
    path.getPoint(out.flight, out.position);
    orientation.getPoint(out.flight, out.angles);
    balloonPath.getPoint(out.flight, out.balloon);
    return out;
  }

  // Area della fotografia che la telecamera inquadra lungo tutto il percorso:
  // i quattro angoli dell'inquadratura (più il respiro) proiettati sul piano lontano.
  const sample = newPose();
  const euler = new THREE.Euler();
  const ray = new THREE.Vector3();
  const seen = new THREE.Box2();
  const start = new THREE.Box2();
  const breath = Math.tan(rad(DRIFT.angle));
  for (let i = 0; i <= 320; i++) {
    pose(i / 320, sample);
    setEuler(euler, sample.angles);
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      ray.set(sx * (tanH + breath), sy * (tanV + breath), -1).applyEuler(euler);
      const reach = (-BACKDROP.distance - sample.position.z) / ray.z;
      ray.multiplyScalar(reach).add(sample.position);
      seen.expandByPoint(ray);
      if (i === 0) start.expandByPoint(ray);
    }
  }

  // Il piano più piccolo, con le proporzioni della fotografia, che contiene quell'area.
  const margin = 1 + BACKDROP.margin;
  const seenW = (seen.max.x - seen.min.x) * margin;
  const seenH = (seen.max.y - seen.min.y) * margin;
  const halfW = Math.max(seenW, seenH * photoAspect) / 2;
  const halfH = halfW / photoAspect;
  const midX = (seen.min.x + seen.max.x) / 2;
  const midY = (seen.min.y + seen.max.y) / 2;
  // Dove avanza spazio, il fuoco sceglie quale parte della fotografia mostrare
  const slackX = halfW - seenW / 2;
  const slackY = halfH - seenH / 2;

  return {
    fov,
    path,
    pose,
    backdrop: {
      x: midX + slackX * (1 - 2 * focus.x),
      y: midY - slackY * (1 - 2 * focus.y),
      width: halfW * 2,
      height: halfH * 2
    },
    // quanta parte della fotografia è inquadrata all'inizio (1 = tutta la larghezza o l'altezza)
    startCrop: Math.max((start.max.x - start.min.x) / (halfW * 2), (start.max.y - start.min.y) / (halfH * 2))
  };
}

function newPose() {
  return { position: new THREE.Vector3(), angles: new THREE.Vector3(), balloon: new THREE.Vector3(), flight: 0 };
}

function setEuler(euler, angles) {
  return euler.set(rad(angles.y), -rad(angles.x), rad(angles.z), "YXZ");
}

/* ---------- Scena ---------- */

const flightSection = document.querySelector(".flight");
const stage = document.querySelector(".stage");
const loaderNotice = document.querySelector(".loader");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const mobile = window.innerWidth < 768;

// ?p=0.6 blocca il volo in quel punto (0–1), ?verify controlla il percorso in console
const params = new URLSearchParams(location.search);
const fixedProgress = params.has("p") ? THREE.MathUtils.clamp(parseFloat(params.get("p")) || 0, 0, 1) : null;

const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Immagine non trovata: " + src));
    img.src = src;
  });

function createScene(canvas, photo) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobile ? 1.25 : 1.75));

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(HAZE.color, HAZE.near, HAZE.far);
  const camera = new THREE.PerspectiveCamera(SHOTS.wide.fov, 1, CAMERA.near, CAMERA.far);

  scene.add(new THREE.HemisphereLight(LIGHT.sky.color, LIGHT.sky.ground, LIGHT.sky.intensity));
  for (const light of [LIGHT.sun, LIGHT.fill]) {
    const directional = new THREE.DirectionalLight(light.color, light.intensity);
    directional.position.fromArray(light.position);
    scene.add(directional);
  }

  // Panorama: materiale non illuminato e senza foschia, così i colori
  // restano identici alla fotografia
  const map = new THREE.Texture(photo);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = renderer.capabilities.getMaxAnisotropy();
  map.needsUpdate = true;
  const backdrop = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map, fog: false, depthWrite: false })
  );
  backdrop.renderOrder = -1;
  scene.add(backdrop);

  let shot;
  function resize() {
    const style = getComputedStyle(document.documentElement);
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    shot = buildShot(width / height, {
      x: parseFloat(style.getPropertyValue("--focus-x")),
      y: parseFloat(style.getPropertyValue("--focus-y"))
    });

    renderer.setSize(width, height, false);
    camera.fov = shot.fov;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    backdrop.position.set(shot.backdrop.x, shot.backdrop.y, -BACKDROP.distance);
    backdrop.scale.set(shot.backdrop.width, shot.backdrop.height, 1);
  }

  const state = { progress: fixedProgress || 0 };
  const current = newPose();
  const beforeRender = [];
  function render() {
    // Fermo immagine (prefers-reduced-motion, ?p=): nessun movimento legato al tempo
    const still = reducedMotion || fixedProgress !== null;
    const time = still ? 0 : performance.now() / 1000;
    shot.pose(state.progress, current);
    camera.position.copy(current.position);
    setEuler(camera.rotation, current.angles);
    if (!still) {
      // Periodi diversi su ogni asse: il respiro non si ripete mai uguale
      camera.position.x += Math.sin(time * 0.31) * DRIFT.position;
      camera.position.y += Math.sin(time * 0.43 + 2) * DRIFT.position;
      camera.rotation.x += Math.sin(time * 0.37 + 1) * rad(DRIFT.angle);
      camera.rotation.y += Math.sin(time * 0.29 + 4) * rad(DRIFT.angle);
    }
    beforeRender.forEach((update) => update(current, time, camera));
    renderer.render(scene, camera);
  }

  return {
    state,
    scene,
    render,
    resize,
    beforeRender,
    maxAnisotropy: renderer.capabilities.getMaxAnisotropy(),
    dispose() {
      backdrop.geometry.dispose();
      map.dispose();
      backdrop.material.dispose();
      renderer.dispose();
    }
  };
}

/* ---------- Mongolfiera GLB ---------- */

// Sui telefoni riduce le texture già caricate: il file GLB non viene modificato.
function limitTexture(texture, max) {
  const image = texture.image;
  if (!image || Math.max(image.width, image.height) <= max) return;
  const ratio = max / Math.max(image.width, image.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.width * ratio);
  canvas.height = Math.round(image.height * ratio);
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  if (image.close) image.close();
  texture.image = canvas;
}

function createBalloon(view, gltf) {
  const model = gltf.scene;
  const meshes = [];
  const textures = new Set();
  const mapProperties = ["map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap", "aoMap"];

  model.traverse((object) => {
    if (!object.isMesh) return;
    meshes.push(object);
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      for (const property of mapProperties) {
        if (material && material[property] && material[property].isTexture) textures.add(material[property]);
      }
    }
  });
  if (!meshes.length) throw new Error("Il GLB non contiene mesh.");

  textures.forEach((texture) => {
    if (mobile) limitTexture(texture, 2048);
    texture.anisotropy = Math.min(view.maxAnisotropy, mobile ? 2 : 8);
    texture.needsUpdate = true;
  });

  // Altezza 1, centro nell'origine: la scala non cambia più.
  // È la prospettiva a far crescere la mongolfiera mentre la telecamera si avvicina.
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  if (!Number.isFinite(size.y) || size.y <= 0) {
    throw new Error("Impossibile determinare l'altezza del modello GLB.");
  }
  const center = bounds.getCenter(new THREE.Vector3());
  model.scale.setScalar(1 / size.y);
  model.position.copy(center).multiplyScalar(-1 / size.y);

  const rig = new THREE.Group();
  rig.add(model);
  view.scene.add(rig);

  // Galleggiamento e vento hanno periodi diversi, così l'oscillazione non appare meccanica
  view.beforeRender.push((pose, time) => {
    rig.position.copy(pose.balloon);
    rig.position.y += Math.sin(time * 0.6) * BALLOON.bob;
    rig.rotation.set(
      Math.sin(time * 0.37 + 1) * rad(BALLOON.tilt * 0.6),
      BALLOON.yaw + BALLOON.spin * pose.flight,
      Math.sin(time * 0.45) * rad(BALLOON.tilt)
    );
  });

  console.info(`Mongolfiera GLB caricata: ${meshes.length} mesh, ${textures.size} texture.`);
  return { rig, meshes };
}

/* ---------- Foschia ---------- */

// Sbuffo morbido e irregolare, disegnato una volta sola
function mistTexture(random) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d");
  for (let i = 0; i < 14; i++) {
    const x = 128 + (random() - 0.5) * 130;
    const y = 128 + (random() - 0.5) * 60;
    const r = 40 + random() * 50;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, "rgba(255, 255, 255, 0.16)");
    gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 256);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createMist(view) {
  // Sequenza fissa: la foschia è identica a ogni caricamento
  let seed = 7;
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const range = ([min, max]) => min + random() * (max - min);

  // Il tragitto della mongolfiera resta sgombro
  const route = new THREE.CatmullRomCurve3(
    SHOTS.wide.keys.map((key) => new THREE.Vector3().fromArray(key.balloon || [0, 0, 0])), false, "centripetal"
  ).getPoints(24);

  const map = mistTexture(random);
  const puffs = [];
  const count = mobile ? MIST.count.mobile : MIST.count.desktop;
  while (puffs.length < count) {
    const position = new THREE.Vector3(range(MIST.box.x), range(MIST.box.y), range(MIST.box.z));
    if (route.some((point) => point.distanceTo(position) < MIST.clear)) continue;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map, color: MIST.color, transparent: true, depthWrite: false, fog: false
    }));
    const size = range(MIST.size);
    sprite.position.copy(position);
    sprite.scale.set(size * 2, size, 1);
    view.scene.add(sprite);
    puffs.push({ sprite, x: position.x, opacity: range(MIST.opacity), phase: random() * Math.PI * 2 });
  }

  const { smoothstep } = THREE.MathUtils;
  view.beforeRender.push((pose, time, camera) => {
    for (const puff of puffs) {
      puff.sprite.position.x = puff.x + Math.sin(time * 0.08 + puff.phase) * 0.4;
      const distance = puff.sprite.position.distanceTo(camera.position);
      puff.sprite.material.opacity = puff.opacity
        * smoothstep(distance, MIST.fadeNear[0], MIST.fadeNear[1])
        * (1 - smoothstep(distance, MIST.fadeFar[0], MIST.fadeFar[1]));
    }
  });
}

/* ---------- Verifica del percorso (?verify) ---------- */

// Per vari formati di schermo controlla che la telecamera non tocchi la geometria
// reale del modello, che il movimento non abbia scatti e quanta fotografia serve
// a coprire l'inquadratura.
function verify(balloon) {
  balloon.rig.position.set(0, 0, 0);
  balloon.rig.rotation.set(0, 0, 0);
  balloon.rig.updateMatrixWorld(true);
  const vertices = [];
  const vertex = new THREE.Vector3();
  for (const mesh of balloon.meshes) {
    const positions = mesh.geometry.attributes.position;
    for (let i = 0; i < positions.count; i += 23) {
      vertices.push(vertex.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld).clone());
    }
  }

  const steps = 400;
  const sample = newPose();
  const previous = newPose();
  const relative = new THREE.Vector3();
  const formats = { "21:9": 21 / 9, "16:9": 16 / 9, "16:10": 1.6, "4:3": 4 / 3, "1:1": 1, "3:4": 0.75, "9:16": 9 / 16, "9:19.5": 9 / 19.5 };
  for (const [name, aspect] of Object.entries(formats)) {
    const shot = buildShot(aspect, { x: 0.5, y: 0.45 });
    let clearance = Infinity;
    let clearanceAt = 0;
    let turn = 0; // rotazione massima della telecamera per 1% di scroll, gradi
    let step = 0; // spostamento massimo per 1% di scroll
    let backwards = false;
    for (let i = 0; i <= steps; i++) {
      shot.pose(i / steps, sample);
      relative.copy(sample.position).sub(sample.balloon);
      for (const point of vertices) {
        const distance = point.distanceTo(relative);
        if (distance < clearance) {
          clearance = distance;
          clearanceAt = i / steps;
        }
      }
      if (i > 0) {
        turn = Math.max(turn, sample.angles.distanceTo(previous.angles) * steps / 100);
        step = Math.max(step, sample.position.distanceTo(previous.position) * steps / 100);
        if (sample.flight < previous.flight) backwards = true;
      }
      previous.position.copy(sample.position);
      previous.angles.copy(sample.angles);
      previous.flight = sample.flight;
    }
    const ok = clearance > CAMERA.near * 4 && !backwards;
    console.info(
      `VERIFY ${name}: ${ok ? "OK" : "PROBLEMA"} — distanza minima dal modello ${clearance.toFixed(2)} (scroll ${clearanceAt.toFixed(2)}), ` +
      `near ${CAMERA.near}, per 1% di scroll: rotazione max ${turn.toFixed(2)}°, spostamento max ${step.toFixed(2)}, ` +
      `fov ${shot.fov.toFixed(0)}°, inquadratura iniziale ${(shot.startCrop * 100).toFixed(0)}% della fotografia`
    );
  }
}

/* ---------- Avvio ---------- */

async function init() {
  // Senza WebGL o senza modello resta visibile la composizione statica.
  let view;
  let balloon;
  try {
    loaderNotice.textContent = "Caricamento";
    const photo = await loadImage(ASSETS.photo);
    view = createScene(document.querySelector(".gl"), photo);
    const gltf = await new GLTFLoader().loadAsync(ASSETS.model, (event) => {
      if (event.total) loaderNotice.textContent = `Caricamento ${Math.round((event.loaded / event.total) * 100)}%`;
    });
    balloon = createBalloon(view, gltf);
    createMist(view);
  } catch (error) {
    console.error("Scena 3D non disponibile; resta visibile il fallback statico.", error);
    if (view) view.dispose();
    flightSection.classList.add("is-failed");
    const notice = document.querySelector(".scene-error");
    notice.textContent = `Impossibile caricare la scena 3D: ${error.message || error}`;
    notice.hidden = false;
    return;
  }

  if (params.has("verify")) verify(balloon);

  view.resize();
  window.addEventListener("resize", () => {
    view.resize();
    view.render();
  });

  // prefers-reduced-motion (o ?p=): un fotogramma fisso, niente da scorrere
  if (reducedMotion || fixedProgress !== null) {
    view.render();
    flightSection.classList.add("is-3d-static");
    if (!reducedMotion) gsap.ticker.add(view.render);
    return;
  }

  flightSection.classList.add("is-3d");

  // Lo scroll sposta la scena lungo il percorso, in avanti e all'indietro; "scrub"
  // aggiunge un'inerzia che ammorbidisce la rotella del mouse. I tempi sono in SHOTS.
  gsap.to(view.state, {
    progress: 1,
    ease: "none",
    scrollTrigger: { trigger: ".flight", start: "top top", end: "bottom bottom", scrub: 1.4 }
  });
  gsap.to(".scroll-hint", {
    autoAlpha: 0,
    ease: "none",
    scrollTrigger: { trigger: ".flight", start: "top top", end: "+=300", scrub: true }
  });

  // Mongolfiera, foschia e telecamera respirano anche a scroll fermo: si disegna a ogni fotogramma
  gsap.ticker.add(view.render);
}

init();
