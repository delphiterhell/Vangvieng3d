import { createFlight } from "./scene.js";

gsap.registerPlugin(ScrollTrigger);

/* ---------- Regia dello scroll ---------- */

// La durata di volo e transizione è in style.css (--flight-length, --cut-length).
// Qui ci sono i tempi interni, come frazioni di quelle due durate.

// Il titolo sfuma quando la telecamera comincia ad avanzare (frazioni del volo)
const TITLE = { start: 0.02, end: 0.13 };

// Transizione dal panorama 3D a "Come inizia" (frazioni della transizione):
// la fotografia dissolve sul panorama mentre il volo finisce di rallentare, poi la
// sua maschera si restringe fino alla cornice, la carta appare attorno ed entra il testo.
const CUT = {
  flightTail: 0.35, // il volo si arresta qui, sotto la dissolvenza
  dissolve: [0, 0.42],
  settle: { until: 0.88, scale: 1.06 }, // la fotografia si assesta mentre entra
  mask: [0.44, 0.9],
  motif: [0.6, 0.92],
  title: [0.64, 0.9],
  text: [0.72, 0.94],
  header: 0.68 // da qui l'header è sopra la carta
};

/* ---------- Elementi ---------- */

const journey = document.querySelector("[data-journey]");
const stage = journey.querySelector(".stage");
const header = document.querySelector("[data-header]");
const loader = journey.querySelector(".loader");
const opening = journey.querySelector(".opening");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Tempo corrente della regia e momento in cui l'header passa sulla carta: li imposta startJourney
let direction = null;

/* ---------- Header e navigazione ---------- */

// L'header è crema sopra immagini e footer, inchiostro sopra la carta
function updateHeader() {
  const line = header.offsetHeight / 2;
  let paper;
  if (direction) {
    paper = direction.time() >= direction.paperAt && stage.getBoundingClientRect().bottom > line;
  } else {
    const rect = opening.getBoundingClientRect();
    paper = rect.top <= line && rect.bottom > line;
  }
  header.classList.toggle("is-paper", paper);
  // Nella pagina statica il contenuto scorre sotto l'header: gli serve un fondo
  header.classList.toggle("is-solid", paper && !direction);
}

window.addEventListener("scroll", updateHeader, { passive: true });
window.addEventListener("resize", updateHeader);
updateHeader();

// "Esperienza": con il volo attivo la sezione è l'ultima inquadratura del palco,
// quindi si scorre fino alla fine del viaggio invece che all'ancora
document.querySelectorAll('[data-goto="valley"]').forEach((link) => {
  link.addEventListener("click", (event) => {
    if (!journey.classList.contains("is-3d")) return;
    event.preventDefault();
    const top = journey.getBoundingClientRect().top + window.scrollY + journey.offsetHeight - window.innerHeight;
    window.scrollTo({ top, behavior: "smooth" });
    document.getElementById("opening-title").focus({ preventScroll: true });
  });
});

/* ---------- Viaggio ---------- */

function startJourney(flight) {
  journey.classList.add("is-3d");
  flight.resize();

  const length = (name) => parseFloat(getComputedStyle(journey).getPropertyValue(name));
  const L = length("--flight-length");
  const C = length("--cut-length");
  const cut = (fraction) => L + fraction * C;
  const span = ([from, to]) => (to - from) * C;

  const figure = opening.querySelector(".opening__figure");
  const frame = opening.querySelector(".opening__frame");
  // Distanza della cornice dai bordi del palco: dove va a fermarsi la maschera
  const inset = (side) => () => {
    const s = stage.getBoundingClientRect();
    const f = frame.getBoundingClientRect();
    return { t: f.top - s.top, r: s.right - f.right, b: s.bottom - f.bottom, l: f.left - s.left }[side] + "px";
  };

  // Tutto il viaggio è una sola timeline legata allo scroll, in avanti e all'indietro.
  // "scrub" aggiunge un'inerzia che ammorbidisce la rotella del mouse.
  const timeline = gsap.timeline({
    defaults: { ease: "none" },
    scrollTrigger: {
      trigger: journey,
      start: "top top",
      end: "bottom bottom",
      scrub: 1.2,
      invalidateOnRefresh: true
    }
  });

  timeline
    // FLYBY — lo scroll muove la telecamera; i tempi delle scene sono in scene.js
    // (sempre fromTo: al ridimensionamento la timeline viene ricalcolata, e i valori
    // di partenza devono restare quelli scritti qui, non quelli del momento)
    .fromTo(flight.state, { progress: 0 }, { progress: 1, duration: cut(CUT.flightTail) }, 0)
    .fromTo(".scroll-hint", { autoAlpha: 1 }, { autoAlpha: 0, duration: 0.04 * L }, 0)
    .fromTo(".hero__content, .hero__coords", { autoAlpha: 1, y: 0 }, {
      autoAlpha: 0, y: -48, duration: (TITLE.end - TITLE.start) * L, ease: "power1.in"
    }, TITLE.start * L)
    .fromTo(".hero__shade", { autoAlpha: 1 }, {
      autoAlpha: 0, duration: (TITLE.end - TITLE.start) * L
    }, TITLE.start * L)

    // CAMBIO DI INQUADRATURA — la fotografia dissolve sul panorama finale...
    .fromTo(figure, { autoAlpha: 0 }, { autoAlpha: 1, duration: span(CUT.dissolve), ease: "sine.inOut" }, cut(CUT.dissolve[0]))
    .fromTo(figure.querySelector("img"), { scale: CUT.settle.scale }, {
      scale: 1, duration: CUT.settle.until * C, ease: "sine.out"
    }, cut(0))
    // ...poi la maschera si restringe fino alla cornice e scopre la carta
    .fromTo(".opening__paper", { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.001 }, cut(CUT.dissolve[1]))
    .fromTo(figure, { "--clip-t": "0px", "--clip-r": "0px", "--clip-b": "0px", "--clip-l": "0px" }, {
      "--clip-t": inset("t"), "--clip-r": inset("r"), "--clip-b": inset("b"), "--clip-l": inset("l"),
      duration: span(CUT.mask), ease: "power2.inOut"
    }, cut(CUT.mask[0]))

    // COME INIZIA — il testo entra mentre la fotografia trova il suo posto
    .fromTo(".opening__text .motif", { clipPath: "inset(0 100% 0 0)" }, {
      clipPath: "inset(0 0% 0 0)", duration: span(CUT.motif), ease: "power1.inOut"
    }, cut(CUT.motif[0]))
    .fromTo(".opening__title span", { yPercent: 110 }, {
      yPercent: 0, duration: span(CUT.title), ease: "power3.out"
    }, cut(CUT.title[0]))
    .fromTo(".opening__lead, .opening__body p", { autoAlpha: 0, y: 26 }, {
      autoAlpha: 1, y: 0, duration: span(CUT.text) * 0.7, stagger: span(CUT.text) * 0.15, ease: "power2.out"
    }, cut(CUT.text[0]))
    .set({}, {}, cut(1));

  direction = { time: () => timeline.time(), paperAt: cut(CUT.header) };
  timeline.eventCallback("onUpdate", updateHeader);

  // Mongolfiera, foschia e telecamera respirano anche a scroll fermo, quindi si
  // disegna a ogni fotogramma: ma solo finché il canvas è visibile
  gsap.ticker.add(() => {
    const covered = timeline.time() >= cut(CUT.dissolve[1]);
    if (!covered && stage.getBoundingClientRect().bottom > 0) flight.render();
  });

  window.addEventListener("resize", flight.resize);
  updateHeader();
}

async function init() {
  // prefers-reduced-motion: resta la pagina statica, il modello non viene nemmeno scaricato
  if (reducedMotion) return;

  // Il viaggio comincia sempre dall'inizio, anche ricaricando la pagina a metà
  history.scrollRestoration = "manual";

  let flight;
  try {
    loader.textContent = "Caricamento";
    flight = await createFlight({
      canvas: journey.querySelector(".gl"),
      stage,
      onProgress: (percent) => { loader.textContent = `Caricamento ${percent}%`; }
    });
  } catch (error) {
    // Senza WebGL o senza modello resta visibile la pagina statica
    console.error("Scena 3D non disponibile; resta la pagina statica.", error);
    loader.textContent = "";
    return;
  }
  loader.textContent = "";

  // Se nel frattempo si è già scesi oltre la hero, non si cambia la pagina sotto gli occhi
  if (window.scrollY > window.innerHeight * 0.5) return;

  startJourney(flight);
}

init();
