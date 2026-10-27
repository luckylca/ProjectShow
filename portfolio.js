(() => {
  const root = document.documentElement;
  const body = document.body;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isTouch = window.matchMedia("(hover: none), (pointer: coarse)").matches;

  root.classList.add("portfolio-enhanced");
  if (reduceMotion) return;
  body.classList.add("has-motion");

  // Reveal original content progressively; nothing is removed or rewritten.
  const revealTargets = body.classList.contains("portfolio-home")
    ? Array.from(document.querySelectorAll(".summary-card, .section-title, .footer"))
    : Array.from(document.querySelectorAll(".detail-hero, .detail-section, .detail-media, .footer"));

  revealTargets.forEach((element, index) => {
    element.classList.add("reveal-on-scroll");
    element.style.setProperty("--reveal-delay", String(Math.min(index % 4, 3) * 85) + "ms");
  });

  if ("IntersectionObserver" in window) {
    const revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-revealed");
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -5% 0px" });
    revealTargets.forEach((element) => revealObserver.observe(element));

    // The quadruped video is a decorative preview: only play while it is near the viewport.
    const videoObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const video = entry.target;
        if (entry.isIntersecting) {
          const promise = video.play();
          if (promise && typeof promise.catch === "function") promise.catch(() => {});
        } else {
          video.pause();
        }
      });
    }, { threshold: 0.2, rootMargin: "120px 0px" });
    document.querySelectorAll("video[data-motion-preview]").forEach((video) => videoObserver.observe(video));
  } else {
    revealTargets.forEach((element) => element.classList.add("is-revealed"));
  }

  // A small, low-cost parallax shift on the illustrated cover.
  const hero = document.querySelector(".portfolio-home .hero");
  if (hero && !isTouch) {
    let frame = 0;
    hero.addEventListener("pointermove", (event) => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = hero.getBoundingClientRect();
        const nx = (event.clientX - rect.left) / rect.width - 0.5;
        const ny = (event.clientY - rect.top) / rect.height - 0.5;
        hero.style.setProperty("--scene-x", String(-nx * 9) + "px");
        hero.style.setProperty("--scene-y", String(-ny * 6) + "px");
      });
    }, { passive: true });
    hero.addEventListener("pointerleave", () => {
      hero.style.setProperty("--scene-x", "0px");
      hero.style.setProperty("--scene-y", "0px");
    }, { passive: true });
  }

  // Gentle card tilt on desktop only.
  if (!isTouch && body.classList.contains("portfolio-home")) {
    document.querySelectorAll(".summary-card").forEach((card) => {
      let frame = 0;
      card.addEventListener("pointermove", (event) => {
        if (frame) cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          const rect = card.getBoundingClientRect();
          const x = (event.clientX - rect.left) / rect.width - 0.5;
          const y = (event.clientY - rect.top) / rect.height - 0.5;
          card.style.setProperty("--card-rx", String(-y * 1.6) + "deg");
          card.style.setProperty("--card-ry", String(x * 1.8) + "deg");
        });
      }, { passive: true });
      card.addEventListener("pointerleave", () => {
        card.style.setProperty("--card-rx", "0deg");
        card.style.setProperty("--card-ry", "0deg");
      }, { passive: true });
    });
  }
})();