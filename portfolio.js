(() => {
  const root = document.documentElement;
  const body = document.body;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isTouch = window.matchMedia("(hover: none), (pointer: coarse)").matches;

  root.classList.add("portfolio-enhanced");
  if (reduceMotion) return;
  body.classList.add("has-motion");

  // Progressive enhancement: the original content stays visible if JS is unavailable.
  const revealTargets = body.classList.contains("portfolio-home")
    ? Array.from(document.querySelectorAll(".summary-card, .section-title, .footer"))
    : Array.from(document.querySelectorAll(".detail-hero, .detail-section, .detail-media, .footer"));

  revealTargets.forEach((element, index) => {
    element.classList.add("reveal-on-scroll");
    element.style.setProperty("--reveal-delay", \`\${Math.min(index % 4, 3) * 85}ms\`);
  });

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-revealed");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -5% 0px" });

    revealTargets.forEach((element) => observer.observe(element));
  } else {
    revealTargets.forEach((element) => element.classList.add("is-revealed"));
  }

  // Gentle pointer parallax on the illustrated cover. No extra rendering loop.
  const hero = document.querySelector(".portfolio-home .hero");
  if (hero && !isTouch) {
    let frame = 0;
    hero.addEventListener("pointermove", (event) => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = hero.getBoundingClientRect();
        const nx = (event.clientX - rect.left) / rect.width - 0.5;
        const ny = (event.clientY - rect.top) / rect.height - 0.5;
        hero.style.setProperty("--scene-x", \`\${(-nx * 9).toFixed(2)}px\`);
        hero.style.setProperty("--scene-y", \`\${(-ny * 6).toFixed(2)}px\`);
      });
    }, { passive: true });
    hero.addEventListener("pointerleave", () => {
      hero.style.setProperty("--scene-x", "0px");
      hero.style.setProperty("--scene-y", "0px");
    }, { passive: true });
  }

  // Subtle card tilt on desktop only. Keep it restrained so text remains easy to read.
  if (!isTouch && body.classList.contains("portfolio-home")) {
    document.querySelectorAll(".summary-card").forEach((card) => {
      let frame = 0;
      card.addEventListener("pointermove", (event) => {
        if (frame) cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          const rect = card.getBoundingClientRect();
          const x = (event.clientX - rect.left) / rect.width - 0.5;
          const y = (event.clientY - rect.top) / rect.height - 0.5;
          card.style.setProperty("--card-rx", \`\${(-y * 1.6).toFixed(2)}deg\`);
          card.style.setProperty("--card-ry", \`\${(x * 1.8).toFixed(2)}deg\`);
        });
      }, { passive: true });
      card.addEventListener("pointerleave", () => {
        card.style.setProperty("--card-rx", "0deg");
        card.style.setProperty("--card-ry", "0deg");
      }, { passive: true });
    });
  }

  // Mark the active page section for assistive tooling and future navigation enhancements.
  const cards = document.querySelectorAll(".summary-card");
  cards.forEach((card, index) => card.style.setProperty("--project-index", String(index + 1)));
})();