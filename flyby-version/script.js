import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

gsap.registerPlugin(ScrollTrigger);

/* ---------- Regia: tutti i valori da ritoccare stanno qui ---------- */

const ASSETS = {
  photo: "../depth-version/images/landscape.jpg",
  model: "../depth-version/models/balloon.glb",
  width: 2752,
  height: 1536
};

// Spazio della scena: 1 unità = altezza della mongolfiera, che sta ferma nell'origine.
// La telecamera guarda verso -z; x positivo è a destra, y è l'alto.
//
// Il percorso ha quattro punti chiave, uno per scena. Per ognuno:
//   pos   = posizione della telecamera
//   yaw   = gradi verso destra, pitch = gradi verso l'alto, roll = inclinazione
// Tra i punti passano due CatmullRomCurve3: una per la posizione, una per l'orientamento.
//
// La telecamera passa a sinistra della mongolfiera (x negativo): non ridurre |x| del
// punto 3 sotto 0.8, l'involucro ha raggio 0.38. Controlla sempre con ?verify.
const SHOTS = {
  wide: {
    aspect: 1.5, // da questo rapporto larghezza/altezza in su vale la regia "wide"
    fov: 40,
    keys: [
      { pos: [-1.9, -0.6, 12.5], yaw: 0.5, pitch: 0, roll: 0 },    // 1 — introduzione
      { pos: [-1.3, -0.2, 4.6], yaw: 6, pitch: 0.5, roll: 0 },     // 2 — avvicinamento
      { pos: [-1.05, 0.1, 1.55], yaw: 11, pitch: 1.5, roll: -1.5 }, // 3 — flyby
      { pos: [-0.7, 0.4, -1.4], yaw: 0, pitch: 1, roll: 0 }        // 4 — uscita
    ]
  },
  portrait: {
    aspect: 0.62, // da questo rapporto in giù vale la regia "portrait"; in mezzo si sfuma
    fov: 55,
    keys: [
      { pos: [-0.75, -0.75, 10.5], yaw: 1, pitch: 0, roll: 0 },
      { pos: [-0.8, -0.3, 4.2], yaw: 7, pitch: 0.5, roll: 0 },
      { pos: [-0.95, 0.1, 1.7], yaw: 20, pitch: 2, roll: -1.5 },
      { pos: [-0.65, 0.4, -1.4], yaw: 0, pitch: 1, roll: 0 }
    ]
  }
};

// Andatura lungo il percorso: scroll 0–1 → distanza percorsa 0–1.
// in > 1 fa partire piano, out > 1 allunga la frenata finale.
const PACE = { in: 1.2, out: 1.9 };

// La fotografia è un piano lontano, mai deformato e mai attraversato.
// La sua dimensione viene calcolata dal percorso (vedi buildShot): copre sempre
// l'inquadratura, quindi i bordi non possono entrare in campo.
const BACKDROP = { distance: 30, margin: 0.02 };

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

// Banchi di foschia tra la telecamera e il panorama: danno la misura della velocità.
// count: 0 li disattiva.
const MIST = {
  count: { desktop: 22, mobile: 12 },
  color: 0xf1ded8,
  opacity: [0.05, 0.14],
  size: [3, 6.5],
  fadeNear: [0.8, 3.5], // svaniscono avvicinandosi alla telecamera: niente tagli netti
  fadeFar: [14, 22],
  clear: 2.2 // raggio libero attorno alla mongolfiera
};

/* ---------- Percorso della telecamera ---------- */

const rad = THREE.MathUtils.degToRad;
const pace = (progress) => 1 - Math.pow(1 - Math.pow(progress, PACE.in), PACE.out);
const photoAspect = ASSETS.width / ASSETS.height;

// Costruisce percorso, orientamento e piano della fotografia per un dato schermo.
// Non tocca il DOM: ?verify la usa per controllare anche altri formati.
function buildShot(aspect, focus) {
  const mix = THREE.MathUtils.smoothstep(aspect, SHOTS.portrait.aspect, SHOTS.wide.aspect);
  const lerp = THREE.MathUtils.lerp;
  const fov = lerp(SHOTS.portrait.fov, SHOTS.wide.fov, mix);
  const tanV = Math.tan(rad(fov / 2));
  const tanH = tanV * aspect;

  const points = [];
  const angles = [];
  SHOTS.wide.keys.forEach((wide, i) => {
    const portrait = SHOTS.portrait.keys[i];
    points.push(new THREE.Vector3().fromArray(portrait.pos).lerp(new THREE.Vector3().fromArray(wide.pos), mix));
    angles.push(new THREE.Vector3(
      lerp(portrait.yaw, wide.yaw, mix),
      lerp(portrait.pitch, wide.pitch, mix),
      lerp(portrait.roll, wide.roll, mix)
    ));
  });

  const path = new THREE.CatmullRomCurve3(points, false, "centripetal");
  const orientation = new THREE.CatmullRomCurve3(angles, false, "centripetal");

  // Posa della telecamera a un certo punto dello scroll (0–1).
  // angles: x = yaw, y = pitch, z = roll, in gradi.
  function pose(progress, out) {
    out.travel = pace(progress);
    const t = path.getUtoTmapping(out.travel);
    path.getPoint(t, out.position);
    orientation.getPoint(t, out.angles);
    return out;
  }

  // Area della fotografia che la telecamera inquadra lungo tutto il percorso:
  // i quattro angoli dell'inquadratura proiettati sul piano lontano.
  const sample = { position: new THREE.Vector3(), angles: new THREE.Vector3(), travel: 0 };
  const euler = new THREE.Euler();
  const ray = new THREE.Vector3();
  const seen = new THREE.Box2();
  const start = new THREE.Box2();
  for (let i = 0; i <= 240; i++) {
    pose(i / 240, sample);
    setEuler(euler, sample.angles);
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      ray.set(sx * tanH, sy * tanV, -1).applyEuler(euler);
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

  // Panorama: materiale non illuminato e senza foschia, così i colori restano identici alla fotografia
  const map = new THREE.Texture(photo);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = renderer.capabilities.getMaxAnisotropy();
  map.needsUpdate = true;
  const backdrop = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map, fog: false, toneMapped: false, depthWrite: false })
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
  const current = { position: new THREE.Vector3(), angles: new THREE.Vector3(), travel: 0 };
  const beforeRender = [];
  function render() {
    // Fermo immagine (prefers-reduced-motion, ?p=): nessun movimento legato al tempo
    const time = reducedMotion || fixedProgress !== null ? 0 : performance.now() / 1000;
    shot.pose(state.progress, current);
    camera.position.copy(current.position);
    setEuler(camera.rotation, current.angles);
    beforeRender.forEach((update) => update(current.travel, time, camera));
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
  view.beforeRender.push((travel, time) => {
    rig.position.y = Math.sin(time * 0.6) * BALLOON.bob;
    rig.rotation.set(
      Math.sin(time * 0.37 + 1) * rad(BALLOON.tilt * 0.6),
      BALLOON.yaw + BALLOON.spin * travel,
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

  const map = mistTexture(random);
  const puffs = [];
  const count = mobile ? MIST.count.mobile : MIST.count.desktop;
  while (puffs.length < count) {
    const position = new THREE.Vector3(range([-7, 7]), range([-2.6, 1.2]), range([-9, 11]));
    if (position.length() < MIST.clear) continue;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map, color: MIST.color, transparent: true, depthWrite: false, fog: false    }));
    const size = range(MIST.size);
    sprite.position.copy(position);
    sprite.scale.set(size * 2, size, 1);
    view.scene.add(sprite);
    puffs.push({ sprite, x: position.x, opacity: range(MIST.opacity), phase: random() * Math.PI * 2 });
  }

  const { smoothstep } = THREE.MathUtils;
  view.beforeRender.push((travel, time, camera) => {
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
// reale del modello e riporta quanto della fotografia serve a coprire l'inquadratura.
function verify(balloon) {
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

  const sample = { position: new THREE.Vector3(), angles: new THREE.Vector3(), travel: 0 };
  const formats = { "21:9": 21 / 9, "16:9": 16 / 9, "16:10": 1.6, "4:3": 4 / 3, "1:1": 1, "3:4": 0.75, "9:16": 9 / 16, "9:19.5": 9 / 19.5 };
  for (const [name, aspect] of Object.entries(formats)) {
    const shot = buildShot(aspect, { x: 0.5, y: 0.45 });
    let clearance = Infinity;
    let clearanceAt = 0;
    let yaw = 0;
    for (let i = 0; i <= 300; i++) {
      shot.pose(i / 300, sample);
      yaw = Math.max(yaw, Math.abs(sample.angles.x));
      for (const point of vertices) {
        const distance = point.distanceTo(sample.position);
        if (distance < clearance) {
          clearance = distance;
          clearanceAt = i / 300;
        }
      }
    }
    const ok = clearance > CAMERA.near * 4;
    console.info(
      `VERIFY ${name}: ${ok ? "OK" : "COLLISIONE"} — distanza minima dal modello ${clearance.toFixed(2)} (scroll ${clearanceAt.toFixed(2)}), ` +
      `near ${CAMERA.near}, yaw max ${yaw.toFixed(1)}°, fov ${shot.fov.toFixed(0)}°, ` +
      `inquadratura iniziale ${(shot.startCrop * 100).toFixed(0)}% della fotografia, percorso ${shot.path.getLength().toFixed(1)}`
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

  // Lo scroll sposta solo la telecamera lungo il percorso; "scrub" aggiunge
  // un'inerzia che ammorbidisce la rotella del mouse. L'andatura è in PACE.
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

  // Mongolfiera e foschia si muovono anche a scroll fermo: si disegna a ogni fotogramma
  gsap.ticker.add(view.render);
}

init();
