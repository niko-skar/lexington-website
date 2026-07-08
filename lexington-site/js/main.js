// Mobile nav toggle
document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.querySelector('.nav-toggle');
  const nav = document.querySelector('.primary-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    nav.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
      nav.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    }));
  }

  // Building elevation floor selector
  const floorBtns = document.querySelectorAll('.floor-btn');
  const panels = document.querySelectorAll('.floor-panel');
  floorBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-floor');
      floorBtns.forEach(b => b.classList.toggle('active', b === btn));
      panels.forEach(p => p.classList.toggle('active', p.getAttribute('data-floor') === target));
    });
  });
});
