import { createFlight } from "./scene.js";

gsap.registerPlugin(ScrollTrigger);

/* ---------- Regia dello scroll ---------- */

// La durata di volo e transizione è in style.css (--flight-length, --cut-length).
// Qui ci sono i tempi interni.

// Il titolo sfuma quando la telecamera comincia ad avanzare (frazioni del volo)
const TITLE = { start: 0.02, end: 0.13 };

// SCIA — la fotografia entra dietro la mongolfiera che attraversa l'inquadratura:
// il suo bordo sfumato resta agganciato al profilo sinistro del pallone e lo segue
// fuori campo. from/to sono punti del volo (0–1, gli stessi "at" di scene.js): tra
// i due il bordo parte dal margine dello schermo e raggiunge la mongolfiera.
// feather = larghezza della sfumatura, gap = distanza dal pallone (frazioni dello schermo).
const WAKE = { from: 0.56, to: 0.65, feather: 0.2, gap: 0.03 };

// Dalla fotografia a tutto schermo a "Come inizia" (frazioni della transizione):
// la fotografia si ridimensiona fino alla cornice e solo allora entra il testo.
const CUT = {
  resize: [0.1, 0.68],
  motif: [0.68, 0.9],
  title: [0.7, 0.92],
  text: [0.78, 1],
  header: 0.4 // da qui l'header è sopra la carta
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

// Sul palco del viaggio l'header è trasparente: crema sulle immagini, inchiostro
// sulla carta, e durante il flyby lascia solo "Salta il volo" e "Prenota".
// Dopo il viaggio è una fascia di carta che si ritira scendendo e torna risalendo.
let lastScroll = window.scrollY;
function updateHeader() {
  const line = header.offsetHeight / 2;
  const scroll = window.scrollY;
  let onStage;
  let paper = false;
  let flying = false;
  if (direction) {
    const time = direction.time();
    // il palco conta finché è fermo in alto: quando scorre via torna la fascia di carta
    const rect = stage.getBoundingClientRect();
    onStage = rect.bottom > line && rect.top > -2;
    paper = time >= direction.paperAt;
    flying = onStage && time > direction.flyFrom && time < direction.flyTo;
  } else {
    // pagina statica: il palco è la sola hero
    onStage = journey.querySelector(".hero").getBoundingClientRect().bottom > line;
  }
  header.classList.toggle("is-paper", !onStage || paper);
  header.classList.toggle("is-solid", !onStage);
  header.classList.toggle("is-flying", flying);
  if (onStage) {
    header.classList.remove("is-hidden");
  } else if (Math.abs(scroll - lastScroll) > 6) {
    header.classList.toggle("is-hidden", scroll > lastScroll);
  }
  if (Math.abs(scroll - lastScroll) > 6) lastScroll = scroll;
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

  const style = (name) => parseFloat(getComputedStyle(journey).getPropertyValue(name));
  const L = style("--flight-length");
  const C = style("--cut-length");
  const cut = (fraction) => L + fraction * C;
  const span = ([from, to]) => (to - from) * C;

  const figure = opening.querySelector(".opening__figure");
  const frame = opening.querySelector(".opening__frame");
  // Distanza della cornice dai bordi del palco: dove va a fermarsi la fotografia
  const inset = (side) => () => {
    const s = stage.getBoundingClientRect();
    const f = frame.getBoundingClientRect();
    return { t: f.top - s.top, r: s.right - f.right, b: s.bottom - f.bottom, l: f.left - s.left }[side] + "px";
  };

  // Posizione del bordo della fotografia a un certo punto del volo, in frazioni
  // dello schermo: sotto 0 la fotografia non si vede, a "covered" lo copre tutto.
  const lerp = (from, to, amount) => from + (to - from) * amount;
  const smoothstep = (value, min, max) => {
    const amount = Math.min(1, Math.max(0, (value - min) / (max - min)));
    return amount * amount * (3 - 2 * amount);
  };
  const covered = 1 + WAKE.feather + 0.02;
  const wakeAt = (progress) => {
    const left = flight.balloonLeft(progress);
    if (left === Infinity) return covered;
    return Math.min(covered, lerp(-0.02, left - WAKE.gap, smoothstep(progress, WAKE.from, WAKE.to)));
  };
  // Punto del volo in cui la fotografia copre tutto lo schermo: lì finisce il volo visibile
  const coverAt = () => {
    for (let progress = WAKE.from; progress < 1; progress += 0.002) {
      if (wakeAt(progress) >= covered) return progress;
    }
    return 1;
  };

  function updateWake() {
    const wake = timeline.time() >= L ? covered : wakeAt(flight.state.progress);
    figure.style.visibility = wake > 0 ? "visible" : "hidden";
    figure.style.setProperty("--wake", wake.toFixed(4));
    figure.classList.toggle("is-covering", wake >= covered);
  }
  figure.style.setProperty("--feather", WAKE.feather);

  // Tutto il viaggio è una sola timeline legata allo scroll, in avanti e all'indietro:
  // telecamera, scia e testi leggono lo stesso tempo e non possono disallinearsi.
  // "scrub" aggiunge un'inerzia che ammorbidisce la rotella del mouse.
  const timeline = gsap.timeline({
    defaults: { ease: "none" },
    onUpdate() {
      updateWake();
      updateHeader();
    },
    scrollTrigger: {
      trigger: journey,
      start: "top top",
      end: "bottom bottom",
      scrub: 1.2,
      invalidateOnRefresh: true
    }
  });

  timeline
    // FLYBY — lo scroll muove la telecamera; i tempi delle scene sono in scene.js.
    // Il volo dura fino a quando la fotografia, entrata nella scia, copre lo schermo.
    // (sempre fromTo: al ridimensionamento la timeline viene ricalcolata, e i valori
    // di partenza devono restare quelli scritti qui, non quelli del momento)
    .fromTo(flight.state, { progress: 0 }, { progress: coverAt, duration: L }, 0)
    .fromTo(".scroll-hint", { autoAlpha: 1 }, { autoAlpha: 0, duration: 0.04 * L }, 0)
    .fromTo(".hero__content, .hero__coords", { autoAlpha: 1, y: 0 }, {
      autoAlpha: 0, y: -48, duration: (TITLE.end - TITLE.start) * L, ease: "power1.in"
    }, TITLE.start * L)
    .fromTo(".hero__shade", { autoAlpha: 1 }, {
      autoAlpha: 0, duration: (TITLE.end - TITLE.start) * L
    }, TITLE.start * L)

    // DALLA FOTOGRAFIA ALLA PAGINA — a tutto schermo per un respiro, poi la fotografia
    // si ridimensiona fino alla cornice e la carta appare attorno
    .fromTo(".opening__paper", { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.001 }, cut(0))
    .fromTo(figure, { "--box-t": "0px", "--box-r": "0px", "--box-b": "0px", "--box-l": "0px" }, {
      "--box-t": inset("t"), "--box-r": inset("r"), "--box-b": inset("b"), "--box-l": inset("l"),
      duration: span(CUT.resize), ease: "power2.inOut"
    }, cut(CUT.resize[0]))
    .fromTo(figure, { "--photo-x": () => style("--photo-x-wide") }, {
      "--photo-x": () => style("--photo-x-framed"), duration: span(CUT.resize), ease: "power2.inOut"
    }, cut(CUT.resize[0]))

    // COME INIZIA — il testo entra solo quando la fotografia è al suo posto
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

  direction = {
    time: () => timeline.time(),
    paperAt: cut(CUT.header),
    flyFrom: TITLE.start * L,
    flyTo: L
  };

  // L'altezza della pagina è cambiata: le sezioni dopo ricalcolano le loro posizioni
  ScrollTrigger.refresh();

  // Mongolfiera, foschia e telecamera respirano anche a scroll fermo, quindi si
  // disegna a ogni fotogramma: ma solo finché il canvas è visibile
  gsap.ticker.add(() => {
    if (timeline.time() < L && stage.getBoundingClientRect().bottom > 0) flight.render();
  });

  window.addEventListener("resize", () => {
    flight.resize();
    updateWake();
  });
  updateWake();
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
