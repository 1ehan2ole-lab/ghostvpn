/* GhostVPN - landing page dynamics */
(function () {
  'use strict';

  const PLANS = [
    { id: '1m', name: '1 месяц', note: 'Попробовать' },
    { id: '3m', name: '3 месяца', note: 'Оптимально', featured: true },
    { id: '6m', name: '6 месяцев', note: 'Выгодно' },
    { id: '12m', name: '12 месяцев', note: 'Максимум', featured: true },
  ];

  function renderPricing(cfg) {
    const grid = document.getElementById('pricingGrid');
    if (!grid) return;
    const prices = (cfg.site && cfg.site.prices) || {};
    const currency = (cfg.site && cfg.site.currency) || '$';
    grid.innerHTML = PLANS.map(function (plan) {
      const price = prices[plan.id];
      return (
        '<div class="price-card' + (plan.featured ? ' featured' : '') + '">' +
        (plan.featured ? '<span class="tag">хит</span>' : '') +
        '<h3 class="mb-0">' + plan.name + '</h3>' +
        '<div class="price">' + currency + (price === undefined ? '—' : price) +
        '<small> / мес</small></div>' +
        '<p class="small mb-0">' + plan.note + '</p>' +
        '<a class="btn ' + (plan.featured ? '' : 'btn-ghost') + ' btn-block" href="/register">Купить</a>' +
        '</div>'
      );
    }).join('');
  }

  function renderStats(info) {
    const s = (info && info.stats) || {};
    const map = {
      users: s.users,
      active: s.activeUsers,
      online: s.online,
    };
    Object.keys(map).forEach(function (key) {
      document.querySelectorAll('[data-stat="' + key + '"]').forEach(function (el) {
        el.textContent = map[key] === undefined ? '—' : map[key];
      });
    });
    const up = document.querySelector('[data-stat="uptime"]');
    if (up) {
      const sec = Number(s.uptime || 0);
      const d = Math.floor(sec / 86400);
      const h = Math.floor((sec % 86400) / 3600);
      up.textContent = d > 0 ? d + ' д ' + h + ' ч' : h + ' ч';
    }
  }

  document.addEventListener('DOMContentLoaded', async function () {
    const year = document.getElementById('year');
    if (year) year.textContent = new Date().getFullYear();

    try {
      const cfg = await Ghost.api('/api/config');
      renderPricing(cfg);
    } catch (e) {
      renderPricing({ site: { prices: {}, currency: '$' } });
    }

    async function refreshStats() {
      try {
        const info = await Ghost.api('/api/public/info');
        renderStats(info);
      } catch (e) { /* ignore */ }
    }
    refreshStats();
    setInterval(refreshStats, 30000);
  });
})();
