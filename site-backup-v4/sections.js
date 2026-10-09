// Sezioni dopo il viaggio: menu, scelta alba/tramonto, comparse allo scroll,
// finestre fotografiche e mappa della rotta. Il flyby è in main.js e scene.js.

gsap.registerPlugin(ScrollTrigger);

const root = document.documentElement;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

document.querySelectorAll("[data-year]").forEach((node) => {
  node.textContent = new Date().getFullYear();
});

/* ---------- Menu mobile ---------- */

const menuToggle = document.querySelector("[data-menu-toggle]");
const menu = document.querySelector("[data-menu]");

function setMenu(open) {
  menu.hidden = !open;
  menuToggle.setAttribute("aria-expanded", String(open));
  menuToggle.querySelector(".menu-toggle__text").textContent = open ? "Chiudi" : "Menu";
  root.classList.toggle("menu-open", open);
}

menuToggle.addEventListener("click", () => setMenu(menu.hidden));
menu.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => setMenu(false)));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !menu.hidden) {
    setMenu(false);
    menuToggle.focus();
  }
});
window.matchMedia("(min-width: 901px)").addEventListener("change", () => setMenu(false));

/* ---------- Alba / Tramonto ---------- */

// La scelta cambia fotografia, velo e colori. --night va da 0 (alba) a 1 (tramonto):
// il tramonto scende dall'alto con un bordo sfumato, l'alba lo fa risalire.
const SKY = { duration: 2.4, ease: "power2.inOut" };

const skies = document.querySelector(".skies");
const skiesMedia = skies.querySelector(".skies__media");
skiesMedia.style.setProperty("--night", 0);

function setSky(value) {
  skies.dataset.sky = value;
  skies.querySelectorAll("[data-sky-panel]").forEach((panel) => {
    panel.setAttribute("aria-hidden", String(panel.dataset.skyPanel !== value));
  });
  const night = value === "tramonto" ? 1 : 0;
  if (reducedMotion) skiesMedia.style.setProperty("--night", night);
  else gsap.to(skiesMedia, { "--night": night, duration: SKY.duration, ease: SKY.ease, overwrite: true });
}

// Radio veri: frecce da tastiera e tocco funzionano senza altro codice
skies.querySelectorAll('input[name="sky"]').forEach((input) => {
  input.addEventListener("change", () => setSky(input.value));
});

/* ---------- Movimento ---------- */

function setupMotion() {
  // Da qui in poi gli elementi [data-reveal] partono nascosti (vedi sections.css)
  root.classList.add("js-motion");

  // Comparse: le voci vicine entrano una dopo l'altra
  const reveals = document.querySelectorAll("[data-reveal]");
  reveals.forEach((element) => {
    const siblings = [...element.parentElement.children].filter((child) => child.hasAttribute("data-reveal"));
    element.style.setProperty("--d", `${siblings.indexOf(element) * 130}ms`);
  });
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("is-in");
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.2, rootMargin: "0px 0px -8% 0px" });
  reveals.forEach((element) => observer.observe(element));

  // Finestre fotografiche: entrando, la fotografia si apre da un riquadro
  // sulla carta fino a tutto schermo (alba/tramonto)
  document.querySelectorAll("[data-window]").forEach((media) => {
    gsap.fromTo(media, { "--window-y": "16%", "--window-x": "12%" }, {
      "--window-y": "0%",
      "--window-x": "0%",
      ease: "none",
      scrollTrigger: { trigger: media.parentElement, start: "top 92%", end: "top 8%", scrub: true }
    });
  });

  // Chi siamo: la fotografia della valle si svela da sinistra
  document.querySelectorAll("[data-unveil]").forEach((photo) => {
    gsap.fromTo(photo, { "--unveil": "100%" }, {
      "--unveil": "0%",
      ease: "none",
      scrollTrigger: { trigger: photo, start: "top 88%", end: "top 30%", scrub: true }
    });
  });

  setupRoute();

  // Le fotografie caricate dopo cambiano le altezze: le posizioni vanno ricalcolate
  window.addEventListener("load", () => ScrollTrigger.refresh());
}

/* ---------- Rotta ---------- */

// Lo scroll disegna la rotta indicativa: prima il campo di decollo, poi la linea
// lungo il Nam Song con la mongolfiera che la percorre, infine l'atterraggio.
// Su schermi larghi la sezione resta ferma mentre succede; su mobile scorre normalmente.
function setupRoute() {
  const map = document.querySelector("[data-map]");
  const guide = map.querySelector("[data-route]");
  const mask = map.querySelector("[data-route-mask]");
  const balloon = map.querySelector("[data-map-balloon]");
  const length = guide.getTotalLength();
  const flight = { along: 0 };

  mask.style.strokeDasharray = length;
  const place = () => {
    mask.style.strokeDashoffset = length * (1 - flight.along);
    const point = guide.getPointAtLength(length * flight.along);
    balloon.setAttribute("transform", `translate(${point.x} ${point.y})`);
  };

  gsap.matchMedia().add({ wide: "(min-width: 901px)", narrow: "(max-width: 900px)" }, (context) => {
    const timeline = gsap.timeline({
      defaults: { ease: "none" },
      scrollTrigger: context.conditions.wide
        ? { trigger: ".route", start: "top top", end: "bottom bottom", scrub: 1 }
        : { trigger: map, start: "top 78%", end: "bottom 72%", scrub: 1 }
    });

    timeline
      .fromTo('[data-map="launch"], [data-map="launch-label"]', { opacity: 0.15 }, { opacity: 1, duration: 1 }, 0)
      .fromTo('[data-legend="launch"]', { opacity: 0.3 }, { opacity: 1, duration: 1 }, 0)
      .fromTo(balloon, { opacity: 0 }, { opacity: 1, duration: 0.6 }, 0.9)
      .fromTo(flight, { along: 0 }, { along: 1, duration: 7, ease: "sine.inOut", onUpdate: place }, 1.2)
      .fromTo('[data-legend="route"]', { opacity: 0.3 }, { opacity: 1, duration: 1 }, 1.2)
      .fromTo('[data-map="river-label"]', { opacity: 0.25 }, { opacity: 1, duration: 1.2 }, 3.4)
      .fromTo('[data-legend="river"]', { opacity: 0.3 }, { opacity: 1, duration: 1.2 }, 3.4)
      .fromTo('[data-map="landing"], [data-map="landing-label"]', { opacity: 0 }, { opacity: 1, duration: 1 }, 8.2)
      .set({}, {}, 10);

    place();
  });
}

// prefers-reduced-motion: tutto resta visibile e fermo, la rotta è già disegnata
if (!reducedMotion) setupMotion();
