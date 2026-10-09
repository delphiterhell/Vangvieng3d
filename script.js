// Mostra la scena solo quando tutti i piani sono caricati,
// così la composizione appare già completa
const stage = document.querySelector(".stage");
Promise.all(
  [...stage.querySelectorAll("img")].map((img) => img.decode().catch(() => {}))
).then(() => stage.classList.add("is-ready"));

gsap.registerPlugin(ScrollTrigger);

/* ---------- Regia: tutti i valori da ritoccare stanno qui ---------- */

// Movimento della camera, applicato all'intero paesaggio come blocco unico
// (sfondo e montagna non si muovono mai l'uno rispetto all'altra).
// zoom = scala finale, pan = deriva in % del mondo.
const CAMERA = { zoom: 1.04, panX: -0.6, panY: 0.2 };

// Volo della mongolfiera (spostamenti in % del mondo, near = scala finale relativa alla partenza)
const BALLOON = {
  wide:     { driftX: -12, driftY: -3, near: 1.5 },
  portrait: { driftX: -8,  driftY: -3, near: 1.45 }
};

// Sulla timeline, lunga 10: la camera e l'avvicinamento partono qui
const PHASE = { advance: 2, end: 10 };

/* ---------- Scena ---------- */

const mm = gsap.matchMedia();

mm.add(
  {
    motion: "(prefers-reduced-motion: no-preference)",
    portrait: "(max-aspect-ratio: 4/5)"
  },
  (context) => {
    // Con prefers-reduced-motion resta la composizione statica definita nel CSS
    if (!context.conditions.motion) return;

    const balloon = context.conditions.portrait ? BALLOON.portrait : BALLOON.wide;

    gsap.set(".balloon-sway", { rotation: -1, xPercent: -1.5, yPercent: 1 });

    // Tutta la scena è una sola timeline legata allo scroll: nessuna animazione automatica.
    // "scrub" aggiunge un'inerzia che ammorbidisce la rotella del mouse.
    const flight = gsap.timeline({
      defaults: { ease: "sine.inOut" },
      scrollTrigger: {
        trigger: ".flight",
        start: "top top",
        end: "bottom bottom",
        scrub: 1.6
      }
    });

    const cameraTime = 9.4 - PHASE.advance;
    const approach = PHASE.end - PHASE.advance;

    flight
      // FASE 1 — composizione originale: si muove solo la mongolfiera, nel vento.
      // Beccheggio, deriva e galleggiamento hanno periodi diversi, così
      // l'oscillazione non appare mai meccanica.
      .to(".balloon-sway", { rotation: 1, duration: 10 / 5, repeat: 4, yoyo: true }, 0)
      .to(".balloon-sway", { xPercent: 1.5, duration: 10 / 3, repeat: 2, yoyo: true }, 0)
      .to(".balloon-sway", { yPercent: -1, duration: 10 / 4, repeat: 3, yoyo: true }, 0)
      .to(".scroll-hint", { autoAlpha: 0, duration: 0.6, ease: "none" }, 0)

      // FASE 2 — la camera avanza appena: un solo movimento per tutto il paesaggio.
      // L'ease parte piano e in FASE 3 rallenta fino a fermarsi.
      .to(".landscape", { scale: CAMERA.zoom, xPercent: CAMERA.panX, yPercent: CAMERA.panY, duration: cameraTime }, PHASE.advance)
      .to(".haze", { opacity: 0.6, duration: cameraTime }, PHASE.advance)
      .to(".sunglow", { opacity: 0.72, duration: cameraTime }, PHASE.advance)

      // La mongolfiera segue la corrente attraverso la valle...
      .to(".balloon-layer", { xPercent: balloon.driftX, duration: 9.2 }, 0.8)
      .to(".balloon-layer", { yPercent: balloon.driftY, duration: 8 }, PHASE.advance)
      // ...e viene gradualmente verso la camera, uscendo dalla foschia,
      // finché in FASE 3 la scena si stabilizza
      .to(".balloon-path", { scale: balloon.near, duration: approach }, PHASE.advance)
      .to(".balloon", { filter: "saturate(1) contrast(1) brightness(1)", duration: approach }, PHASE.advance);
  }
);
