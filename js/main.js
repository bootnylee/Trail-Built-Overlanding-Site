// Trail Built — main.js

// Mobile menu toggle
const toggle = document.querySelector('.menu-toggle');
const nav = document.querySelector('header nav');
if (toggle && nav) {
  toggle.addEventListener('click', () => nav.classList.toggle('open'));
  document.addEventListener('click', (e) => {
    if (!e.target.closest('header')) nav.classList.remove('open');
  });
}

// Active nav link
const links = document.querySelectorAll('nav a');
links.forEach(link => {
  if (link.href === location.href) link.classList.add('active');
});

// Smooth affiliate link tracking (console only — replace with real analytics)
document.querySelectorAll('a[href*="amazon"]').forEach(link => {
  link.addEventListener('click', () => {
    const label = link.closest('[data-product]')?.dataset.product || link.textContent.trim();
    console.info('Affiliate click:', label);
  });
});
