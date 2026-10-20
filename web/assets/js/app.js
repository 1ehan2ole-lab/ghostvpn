/* GhostVPN - shared client helpers */
(function () {
  'use strict';

  const Ghost = {};

  /* -------------------------------------------------------------- */
  /* API                                                              */
  /* -------------------------------------------------------------- */

  // Базовый URL API. Пустая строка = тот же домен. Для статической
  // публикации (GitHub Pages) задаётся в web/config.js.
  let apiBase = String(window.GHOSTVPN_API_BASE || '').replace(/\/+$/, '');

  /**
   * Подтягивает актуальный config.js (обход кэша статики) и вычисляет
   * базовый URL API и адрес панели.
   */
  async function initConfig() {
    if (typeof window.GHOSTVPN_API_BASE === 'undefined') {
      try {
        const res = await fetch('config.js?v=' + Date.now(), { cache: 'no-store' });
        const text = await res.text();
        const api = text.match(/GHOSTVPN_API_BASE\s*=\s*'([^']*)'/);
        const panel = text.match(/GHOSTVPN_PANEL_URL\s*=\s*'([^']*)'/);
        if (api) window.GHOSTVPN_API_BASE = api[1];
        if (panel) window.GHOSTVPN_PANEL_URL = panel[1];
      } catch (e) {
        /* статика недоступна - работаем на текущем домене */
      }
    }
    apiBase = String(window.GHOSTVPN_API_BASE || '').replace(/\/+$/, '');
    return apiBase;
  }

  Ghost.url = function (pathname) {
    return apiBase + pathname;
  };

  let configReady = null;

  Ghost.api = async function (path, options) {
    if (!configReady) configReady = initConfig();
    await configReady;
    const opts = Object.assign({ credentials: 'same-origin', headers: {} }, options || {});
    opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers);
    if (opts.body && typeof opts.body !== 'string') {
      opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(Ghost.url(path), opts);
    let data = null;
    const text = await res.text();
    if (text) {
      try { data = JSON.parse(text); } catch (e) { data = { message: text }; }
    }
    if (!res.ok) {
      const err = new Error((data && data.message) || 'HTTP ' + res.status);
      err.status = res.status;
      err.code = data && data.error;
      err.data = data;
      throw err;
    }
    return data;
  };

  /* -------------------------------------------------------------- */
  /* UI helpers                                                       */
  /* -------------------------------------------------------------- */

  Ghost.toast = function (message, kind) {
    let host = document.querySelector('.toast-host');
    if (!host) {
      host = document.createElement('div');
      host.className = 'toast-host';
      document.body.appendChild(host);
    }
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.textContent = message;
    host.appendChild(el);
    setTimeout(function () {
      el.style.opacity = '0';
      el.style.transform = 'translateY(8px)';
      el.style.transition = 'all .2s';
      setTimeout(() => el.remove(), 220);
    }, 3200);
  };

  Ghost.copy = async function (text, label) {
    try {
      await navigator.clipboard.writeText(text);
      Ghost.toast((label || 'Скопировано') + ' в буфер обмена', 'ok');
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); Ghost.toast((label || 'Скопировано'), 'ok'); }
      catch (err) { Ghost.toast('Не удалось скопировать', 'err'); }
      ta.remove();
    }
  };

  Ghost.escape = function (value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  Ghost.bytes = function (bytes) {
    const v = Number(bytes) || 0;
    if (v <= 0) return '0 Б';
    const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
    const i = Math.min(units.length - 1, Math.floor(Math.log(v) / Math.log(1024)));
    const n = v / Math.pow(1024, i);
    return (i === 0 ? n : n.toFixed(n >= 100 ? 0 : 2)) + ' ' + units[i];
  };

  Ghost.date = function (ts) {
    if (!ts) return 'бессрочно';
    const d = new Date(Number(ts));
    return d.toISOString().slice(0, 10);
  };

  Ghost.datetime = function (ts) {
    if (!ts) return '—';
    return new Date(Number(ts)).toISOString().replace('T', ' ').slice(0, 16);
  };

  /* -------------------------------------------------------------- */
  /* Auth helpers                                                     */
  /* -------------------------------------------------------------- */

  Ghost.currentUser = null;

  Ghost.loadSession = async function () {
    try {
      const res = await Ghost.api('/api/auth/me');
      Ghost.currentUser = res.user;
    } catch (e) {
      Ghost.currentUser = null;
    }
    return Ghost.currentUser;
  };

  Ghost.requireUser = async function (options) {
    const user = await Ghost.loadSession();
    if (!user) {
      const next = encodeURIComponent(location.pathname + location.search);
      location.href = '/login?next=' + next;
      return null;
    }
    if (options && options.admin && user.role !== 'admin') {
      location.href = '/dashboard';
      return null;
    }
    return user;
  };

  /* -------------------------------------------------------------- */
  /* Boot: navigation, site name, mobile menu                         */
  /* -------------------------------------------------------------- */

  // Доступ из других скриптов страницы (landing, dashboard, admin)
  window.Ghost = Ghost;

  document.addEventListener('DOMContentLoaded', async function () {
    await initConfig();

    // Если сайт опубликован отдельно от панели - перенаправляем внутренние ссылки.
    const panelUrl = String(window.GHOSTVPN_PANEL_URL || '').replace(/\/+$/, '');
    const rewrite = function () {
      if (!panelUrl || panelUrl === location.origin) return;
      document.querySelectorAll('a[href^="/"]').forEach(function (a) {
        const href = a.getAttribute('href');
        if (href && href.charAt(1) !== '/') a.setAttribute('href', panelUrl + href);
      });
    };
    rewrite();
    // Ссылки могут появиться позже (кнопки входа) - переписываем ещё раз.
    setTimeout(rewrite, 300);
    setTimeout(rewrite, 900);

    const toggle = document.querySelector('.nav-toggle');
    const links = document.querySelector('.nav-links');
    if (toggle && links) {
      toggle.addEventListener('click', function () {
        links.classList.toggle('open');
      });
    }

    // site name / tagline
    try {
      const cfg = await Ghost.api('/api/config');
      document.querySelectorAll('[data-site-name]').forEach(function (el) {
        el.textContent = cfg.site.name;
      });
      document.title = document.title.replace('GhostVPN', cfg.site.name);
      document.querySelectorAll('[data-site-tagline]').forEach(function (el) {
        el.textContent = cfg.site.tagline;
      });
      const authLinks = document.querySelector('[data-auth-links]');
      if (authLinks) {
        if (cfg.user) {
          authLinks.innerHTML =
            '<a class="btn btn-ghost btn-sm" href="/dashboard">Кабинет</a>' +
            (cfg.user.role === 'admin' ? '<a class="btn btn-sm" href="/admin">Админ</a>' : '') +
            '<a class="btn btn-ghost btn-sm" id="logoutBtn" href="#">Выйти</a>';
          const out = document.getElementById('logoutBtn');
          if (out) {
            out.addEventListener('click', async function (e) {
              e.preventDefault();
              await Ghost.api('/api/auth/logout', { method: 'POST' });
              location.href = '/';
            });
          }
        } else {
          authLinks.innerHTML =
            '<a class="btn btn-ghost btn-sm" href="/login">Войти</a>' +
            '<a class="btn btn-sm" href="/register">Начать</a>';
        }
      }
      Ghost.registrationOpen = cfg.registrationOpen;
    } catch (e) {
      // Панель недоступна (например, статическая публикация) - оставляем кнопки входа.
      const authLinks = document.querySelector('[data-auth-links]');
      if (authLinks && !authLinks.textContent.trim()) {
        authLinks.innerHTML =
          '<a class="btn btn-ghost btn-sm" href="/login">Войти</a>' +
          '<a class="btn btn-sm" href="/register">Начать</a>';
      }
    }
    rewrite();
  });
})();
