import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

gsap.registerPlugin(ScrollTrigger);

/* ---------- Regia: tutti i valori da ritoccare stanno qui ---------- */

const IMAGE = {
  photo: "images/landscape.jpg",
  depth: "images/depth.png", // Depth Anything V2: bianco = vicino, nero = lontano
  width: 2752,
  height: 1536
};

// La griglia piu' leggera riduce il costo della depth map sui dispositivi mobili.
const GRID = {
  desktop: { x: 384, y: 216 },
  mobile: { x: 192, y: 108 }
};

// Traduzione della depth map in distanze dalla camera.
// far = distanza del cielo, near = distanza del punto più vicino a intensità 1.
// blur ammorbidisce la mappa (in celle di griglia) per evitare strappi sui contorni.
// intensity: 0 = piatta, 0.5 = leggera, 1 = media (quella scelta).
const DEPTH = { far: 10, near: 4.5, blur: 2, intensity: 1 };

// Movimento della camera, nelle stesse unita' di DEPTH.
const CAMERA = { fov: 30, advance: 0.45, shiftX: 0.14, shiftY: 0.03 };

// Profondita' e composizione iniziale in continuita' con il fallback statico.
const BALLOON = {
  model: "models/balloon.optimized.glb",
  pivot: 0.38, // perno dell'oscillazione, dall'alto: il centro dell'involucro
  startDepth: 5,
  wide:     { x: 52, y: 37, depth: 7.4 },
  portrait: { x: 47, y: 36, depth: 7.4 },
  sway: { rotation: 1, x: 0.015, y: 0.01 }, // gradi, frazione della larghezza, frazione dell'altezza
  haze: { color: 0xcfd8e6, near: 3, far: 16 } // foschia: più è lontana, più si vela
};

// Sulla timeline, lunga 10: la camera e l'allontanamento partono qui
const PHASE = { advance: 2, end: 10 };

/* ---------- Paesaggio 3D ---------- */

const stage = document.querySelector(".stage");
const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Immagine non trovata: " + src));
    img.src = src;
  });

// Legge la depth map alla risoluzione della griglia e la ammorbidisce.
// Restituisce un valore 0–1 per vertice (1 = vicino).
function readDepth(img) {
  const grid = window.innerWidth < 768 ? GRID.mobile : GRID.desktop;
  const w = grid.x + 1;
  const h = grid.y + 1;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, w, h);
  const rgba = ctx.getImageData(0, 0, w, h).data;

  let depth = new Float32Array(w * h);
  for (let i = 0; i < depth.length; i++) depth[i] = rgba[i * 4] / 255;

  // sfocatura separabile (due passate ≈ gaussiana)
  const r = DEPTH.blur;
  for (let pass = 0; pass < 2 && r > 0; pass++) {
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const out = new Float32Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let sum = 0;
          let n = 0;
          for (let k = -r; k <= r; k++) {
            const xx = x + k * dx;
            const yy = y + k * dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            sum += depth[yy * w + xx];
            n++;
          }
          out[y * w + x] = sum / n;
        }
      }
      depth = out;
    }
  }
  return depth;
}

function createLandscape(canvas, photo, depthImage) {
  const mobile = window.innerWidth < 768;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobile });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobile ? 1.25 : 1.75));

  const aspect = IMAGE.width / IMAGE.height;
  const tanV = Math.tan(THREE.MathUtils.degToRad(CAMERA.fov / 2));
  const tanH = tanV * aspect;
  const grid = mobile ? GRID.mobile : GRID.desktop;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAMERA.fov, aspect, 0.1, 100);
  scene.add(new THREE.HemisphereLight(0xffd8b2, 0x43536d, 1.15));

  const sunrise = new THREE.DirectionalLight(0xffbb78, 1.8);
  sunrise.position.set(-3, 5, 2);
  scene.add(sunrise);

  const skyFill = new THREE.DirectionalLight(0xa8c8f0, 0.55);
  skyFill.position.set(4, 2, -5);
  scene.add(skyFill);

  const texture = (img) => {
    const map = new THREE.Texture(img);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = renderer.capabilities.getMaxAnisotropy();
    map.needsUpdate = true;
    return map;
  };

  // Materiale non illuminato: i colori restano identici alla fotografia
  const material = new THREE.MeshBasicMaterial({ map: texture(photo), fog: false });
  const geometry = new THREE.PlaneGeometry(1, 1, grid.x, grid.y);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  scene.add(mesh);

  const depth = readDepth(depthImage);
  const positions = geometry.attributes.position;
  const uvs = geometry.attributes.uv;

  // Ogni vertice viene spinto lungo il raggio che parte dalla camera iniziale:
  // dal punto di partenza l'immagine è quindi identica alla fotografia,
  // qualunque sia l'intensità. La profondità emerge solo quando la camera si muove.
  function setIntensity(intensity) {
    const invFar = 1 / DEPTH.far;
    const invRange = 1 / DEPTH.near - invFar;
    for (let i = 0; i < positions.count; i++) {
      const u = uvs.getX(i);
      const v = uvs.getY(i);
      const col = Math.round(u * grid.x);
      const row = Math.round((1 - v) * grid.y);
      const z = 1 / (invFar + intensity * depth[row * (grid.x + 1) + col] * invRange);
      positions.setXYZ(i, (2 * u - 1) * tanH * z, (2 * v - 1) * tanV * z, -z);
    }
    positions.needsUpdate = true;
  }

  // Inquadra la scena come "cover", con lo stesso ritaglio del mondo in CSS
  function resize() {
    const style = getComputedStyle(document.documentElement);
    const focusX = parseFloat(style.getPropertyValue("--focus-x"));
    const focusY = parseFloat(style.getPropertyValue("--focus-y"));
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    const fullWidth = Math.max(window.innerWidth, height * aspect);
    const fullHeight = fullWidth / aspect;

    renderer.setSize(width, height, false);
    camera.setViewOffset(fullWidth, fullHeight, (fullWidth - width) * focusX, (fullHeight - height) * focusY, width, height);
  }

  // Posizione della camera lungo il suo percorso (progress 0 → 1)
  const cameraAt = (progress, target = new THREE.Vector3()) =>
    target.set(CAMERA.shiftX * progress, CAMERA.shiftY * progress, -CAMERA.advance * progress);

  // Punto dello spazio che, visto dalla camera a un certo progress, cade
  // in (x, y) % dell'inquadratura alla profondità indicata
  function frameToWorld(x, y, depth, progress) {
    const point = cameraAt(progress);
    const distance = depth + point.z;
    point.x += (2 * x / 100 - 1) * tanH * distance;
    point.y += (1 - 2 * y / 100) * tanV * distance;
    point.z = -depth;
    return point;
  }

  // rig: avanzamento 0 → 1 della camera lungo il suo percorso
  const rig = { progress: 0 };
  const beforeRender = [];
  function render() {
    cameraAt(rig.progress, camera.position);
    beforeRender.forEach((update) => update(camera));
    renderer.render(scene, camera);
  }

  setIntensity(DEPTH.intensity);

  return {
    rig,
    render,
    resize,
    dispose() {
      geometry.dispose();
      material.map.dispose();
      material.dispose();
      renderer.dispose();
    },
    scene,
    texture,
    frameToWorld,
    beforeRender,
    tanV,
    maxAnisotropy: renderer.capabilities.getMaxAnisotropy()
  };
}

/* ---------- Mongolfiera GLB ---------- */

function createBalloon(landscape, gltf) {
  const model = gltf.scene;
  const meshes = [];
  const materials = new Set();
  const textures = new Set();
  const mapProperties = [
    "map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap",
    "aoMap", "alphaMap", "bumpMap", "displacementMap"
  ];

  model.traverse((object) => {
    if (!object.isMesh) return;
    meshes.push(object);
    if (!object.geometry || !object.geometry.attributes.position) {
      throw new Error("Il GLB contiene una mesh senza geometria posizionale.");
    }
    const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of meshMaterials) {
      if (!material) continue;
      materials.add(material);
      for (const property of mapProperties) {
        if (material[property] && material[property].isTexture) textures.add(material[property]);
      }
    }
  });

  if (!meshes.length || !materials.size || !textures.size) {
    throw new Error(
      `Risorse GLB incomplete: ${meshes.length} mesh, ${materials.size} materiali, ${textures.size} texture.`
    );
  }

  const mobile = window.innerWidth < 768;
  const maxAnisotropy = Math.min(landscape.maxAnisotropy, mobile ? 2 : 4);
  textures.forEach((texture) => {
    texture.anisotropy = maxAnisotropy;
    texture.needsUpdate = true;
  });

  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  if (!Number.isFinite(size.y) || size.y <= 0) {
    throw new Error("Impossibile determinare l'altezza del modello GLB.");
  }

  const center = bounds.getCenter(new THREE.Vector3());
  const height = (parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--balloon-h")) / 100)
    * 2 * landscape.tanV * BALLOON.startDepth;
  const scale = height / size.y;
  const anchorY = bounds.min.y + (1 - BALLOON.pivot) * size.y;
  model.scale.setScalar(scale);
  model.position.set(-center.x, -anchorY, -center.z);

  const rig = new THREE.Group();
  rig.add(model);
  landscape.scene.add(rig);
  landscape.scene.fog = new THREE.Fog(BALLOON.haze.color, BALLOON.haze.near, BALLOON.haze.far);

  const path = new THREE.Vector3(); // posizione lungo la traiettoria
  const sway = { rotation: 0, x: 0, y: 0 }; // oscillazione del vento, da -1 a 1
  const pose = { yaw: 0.12, pitch: 0, roll: 0 };

  landscape.beforeRender.push(() => {
    rig.position.set(
      path.x + sway.x * BALLOON.sway.x * height,
      path.y + sway.y * BALLOON.sway.y * height,
      path.z
    );
    rig.rotation.set(
      pose.pitch + sway.y * 0.012,
      pose.yaw,
      pose.roll + THREE.MathUtils.degToRad(sway.rotation * BALLOON.sway.rotation)
    );
  });

  // Colloca il perno del modello nella stessa posizione del PNG di fallback.
  function place(end) {
    const style = getComputedStyle(document.documentElement);
    const css = (name) => parseFloat(style.getPropertyValue(name));

    const toPivot = (point) => {
      point.y += (0.5 - BALLOON.pivot) * height;
      return point;
    };
    path.copy(toPivot(landscape.frameToWorld(css("--balloon-x"), css("--balloon-y"), BALLOON.startDepth, 0)));
    Object.assign(sway, { rotation: -1, x: -1, y: -1 });
    Object.assign(pose, { yaw: 0.12, pitch: 0, roll: 0 });
    return toPivot(landscape.frameToWorld(end.x, end.y, end.depth, 1));
  }

  console.info(
    `Mongolfiera GLB caricata: ${meshes.length} mesh, ${materials.size} materiali, ${textures.size} texture.`
  );

  return { path, pose, sway, place };
}

/* ---------- Scena ---------- */

const flightSection = document.querySelector(".flight");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

async function init() {
  stage.classList.add("is-ready");

  // Anche senza WebGL o senza depth map resta visibile la composizione statica.
  let landscape;
  let balloon;
  try {
    const [photo, depthImage] = await Promise.all([
      loadImage(IMAGE.photo),
      loadImage(IMAGE.depth)
    ]);
    landscape = createLandscape(document.querySelector(".gl"), photo, depthImage);
    const gltf = await new GLTFLoader().loadAsync(BALLOON.model);
    balloon = createBalloon(landscape, gltf);
  } catch (error) {
    console.error("Scena 3D non disponibile; resta visibile il fallback statico.", error);
    if (landscape) landscape.dispose();
    const notice = document.querySelector(".scene-error");
    notice.textContent = `Impossibile caricare la mongolfiera 3D: ${error.message || error}`;
    notice.hidden = false;
    return;
  }

  landscape.resize();
  if (reducedMotion) {
    const portrait = window.matchMedia("(max-aspect-ratio: 4/5)").matches;
    balloon.place(portrait ? BALLOON.portrait : BALLOON.wide);
    landscape.render();
    flightSection.classList.add("is-3d-static");
    return;
  }

  window.addEventListener("resize", () => {
    landscape.resize();
    landscape.render();
  });
  flightSection.classList.add("is-3d");

  const mm = gsap.matchMedia();
  mm.add({ portrait: "(max-aspect-ratio: 4/5)", wide: "(min-aspect-ratio: 4/5)" }, (context) => {
    const end = balloon.place(context.conditions.portrait ? BALLOON.portrait : BALLOON.wide);

    // Tutta la scena è una sola timeline legata allo scroll: nessuna animazione automatica.
    // "scrub" aggiunge un'inerzia che ammorbidisce la rotella del mouse.
    const flight = gsap.timeline({
      defaults: { ease: "sine.inOut" },
      onUpdate: landscape.render,
      scrollTrigger: {
        trigger: ".flight",
        start: "top top",
        end: "bottom bottom",
        scrub: 1.6
      }
    });

    const cameraTime = 9.4 - PHASE.advance;

    flight
      // FASE 1 — composizione originale: si muove solo la mongolfiera, nel vento.
      // Beccheggio, deriva e galleggiamento hanno periodi diversi, così
      // l'oscillazione non appare mai meccanica.
      .to(balloon.sway, { rotation: 1, duration: 10 / 5, repeat: 4, yoyo: true }, 0)
      .to(balloon.sway, { x: 1, duration: 10 / 3, repeat: 2, yoyo: true }, 0)
      .to(balloon.sway, { y: 1, duration: 10 / 4, repeat: 3, yoyo: true }, 0)
      .to(balloon.pose, { yaw: 0.48, pitch: 0.035, duration: PHASE.end }, 0)
      .to(".scroll-hint", { autoAlpha: 0, duration: 0.6, ease: "none" }, 0)

      // FASE 2 — la camera avanza e deriva dentro il paesaggio 3D.
      // L'ease parte piano e in FASE 3 rallenta fino a fermarsi.
      .to(landscape.rig, { progress: 1, duration: cameraTime }, PHASE.advance)
      .to(".sunglow", { opacity: 0.72, duration: cameraTime }, PHASE.advance)

      // La mongolfiera segue la corrente attraverso la valle...
      .to(balloon.path, { x: end.x, duration: 9.2 }, 0.8)
      .to(balloon.path, { y: end.y, duration: 8 }, PHASE.advance)
      // ...e si allontana in profondità verso le montagne lontane,
      // finché in FASE 3 la scena si stabilizza
      .to(balloon.path, { z: end.z, duration: PHASE.end - PHASE.advance }, PHASE.advance);

    landscape.render();
  });
}

init();
