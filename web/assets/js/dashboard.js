/* GhostVPN - user dashboard */
(function () {
  'use strict';

  const STATUS_LABELS = {
    active: ['Активен', 'badge-ok'],
    expired: ['Истёк', 'badge-err'],
    limited: ['Лимит исчерпан', 'badge-warn'],
    disabled: ['Отключён', 'badge-err'],
    pending: ['Ожидает', 'badge-warn'],
  };

  let data = null;

  function statusLabel(status) {
    return STATUS_LABELS[status] || [status, 'badge'];
  }

  function render(dataIn) {
    data = dataIn;
    const u = data.user;
    const key = data.key;

    document.getElementById('userName').textContent = u.username;
    document.getElementById('userEmail').textContent = u.email;

    const [label, cls] = statusLabel(u.status);
    document.getElementById('statusBadge').innerHTML =
      '<span class="badge ' + cls + '">' + Ghost.escape(label) + '</span>' +
      (u.role === 'admin' ? '<a class="btn btn-sm btn-ghost" href="/admin">Админ-панель</a>' : '');

    document.getElementById('statStatus').textContent = label;
    document.getElementById('statStatusNote').textContent =
      u.status === 'active' ? 'Можно подключаться' : 'Обратитесь в поддержку';

    document.getElementById('statTraffic').textContent = u.trafficUsedGb + ' ГБ';
    const meter = document.getElementById('trafficMeter');
    meter.className = 'meter mt-1' + (u.trafficPercent >= 85 ? ' warn' : '');
    meter.firstElementChild.style.width = Math.max(2, u.trafficPercent) + '%';
    document.getElementById('statTrafficNote').textContent =
      'из ' + (u.trafficLimitGb ? u.trafficLimitGb + ' ГБ' : 'без лимита');

    document.getElementById('statExpiry').textContent = u.expiresLabel;
    document.getElementById('statExpiryNote').textContent =
      u.daysLeft === null ? 'бессрочный доступ' :
      (u.daysLeft > 0 ? 'осталось ' + u.daysLeft + ' дн.' : 'срок истёк');

    document.getElementById('statOnline').textContent = data.online.sessions;
    document.getElementById('statOnlineNote').textContent =
      u.deviceLimit ? 'лимит ' + u.deviceLimit + ' устройств' : 'без лимита устройств';

    document.getElementById('keyText').textContent = key.primary;
    document.getElementById('qrImage').src = Ghost.url('/api/me/qr.png') + '?t=' + Date.now();

    document.getElementById('connParams').innerHTML = [
      ['Протокол', 'VLESS · REALITY (TCP, Vision)'],
      ['Адрес', key.host + ':' + key.port],
      ['SNI', key.sni],
      ['Fingerprint', key.fingerprint],
      ['Short ID', key.shortId || '—'],
      ['Public key', key.publicKey],
      ['Flow', 'xtls-rprx-vision'],
    ].map(function (pair) {
      return '<dt>' + Ghost.escape(pair[0]) + '</dt><dd class="mono">' + Ghost.escape(pair[1]) + '</dd>';
    }).join('');

    document.getElementById('subList').innerHTML = data.subscription.links.map(function (item) {
      const url = Ghost.url(item.url);
      return (
        '<div class="mock-row" style="gap:10px">' +
        '<div class="grow"><b class="small">' + Ghost.escape(item.name) + '</b>' +
        '<div class="mono small muted" style="word-break:break-all">' + Ghost.escape(url) + '</div></div>' +
        '<button class="btn btn-sm btn-ghost" data-copy="' + Ghost.escape(url) + '">Копировать</button>' +
        '</div>'
      );
    }).join('');

    document.getElementById('linkList').innerHTML = key.links.map(function (link, i) {
      return (
        '<div class="mock-row" style="gap:10px">' +
        '<div class="grow"><b class="small">Ссылка ' + (i + 1) + '</b>' +
        '<div class="mono small muted" style="word-break:break-all">' + Ghost.escape(link) + '</div></div>' +
        '<button class="btn btn-sm btn-ghost" data-copy="' + Ghost.escape(link) + '">Копировать</button>' +
        '</div>'
      );
    }).join('');
  }

  async function load() {
    try {
      const res = await Ghost.api('/api/me');
      render(res);
    } catch (err) {
      if (err.status === 401) {
        location.href = '/login?next=' + encodeURIComponent('/dashboard');
        return;
      }
      Ghost.toast(err.message || 'Не удалось загрузить данные', 'err');
    }
  }

  async function loadPlans() {
    try {
      const res = await Ghost.api('/api/me/plans');
      const list = document.getElementById('planList');
      if (!list) return;
      list.innerHTML = res.plans.map(function (plan) {
        return (
          '<button class="btn btn-ghost btn-sm" data-plan="' + Ghost.escape(plan.id) + '">' +
          Ghost.escape(plan.label) + '<br><span class="small muted">' + Ghost.escape(res.currency) +
          plan.price + ' · ' + plan.days + ' дн.</span></button>'
        );
      }).join('');
    } catch (e) { /* ignore */ }
  }

  async function loadPayments() {
    try {
      const res = await Ghost.api('/api/me/payments');
      const box = document.getElementById('myPayments');
      if (!box) return;
      if (!res.payments.length) { box.innerHTML = ''; return; }
      const labels = { pending: ['ожидает оплаты', 'badge-warn'], paid: ['оплачено', 'badge-ok'], rejected: ['отклонено', 'badge-err'] };
      box.innerHTML = res.payments.slice(0, 5).map(function (p) {
        const item = labels[p.status] || [p.status, 'badge'];
        return (
          '<div class="mock-row" style="gap:8px">' +
          '<div class="grow"><b class="small">' + Ghost.escape(p.plan) + ' · ' + p.amount + ' ' + Ghost.escape(p.currency) + '</b>' +
          '<div class="small muted">' + Ghost.datetime(p.created_at) + '</div></div>' +
          '<span class="badge ' + item[1] + '">' + item[0] + '</span></div>'
        );
      }).join('');
    } catch (e) { /* ignore */ }
  }

  document.addEventListener('DOMContentLoaded', async function () {
    document.getElementById('year').textContent = new Date().getFullYear();
    const user = await Ghost.requireUser();
    if (!user) return;
    await load();
    await loadPlans();
    await loadPayments();

    document.getElementById('copyKey').addEventListener('click', function () {
      if (data) Ghost.copy(data.key.primary, 'Ключ скопирован');
    });

    document.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-copy]');
      if (btn) Ghost.copy(btn.getAttribute('data-copy'), 'Скопировано');
    });

    document.addEventListener('click', async function (e) {
      const planBtn = e.target.closest('[data-plan]');
      if (!planBtn) return;
      planBtn.disabled = true;
      try {
        await Ghost.api('/api/me/payments', { method: 'POST', body: { plan: planBtn.getAttribute('data-plan') } });
        Ghost.toast('Заявка на оплату создана', 'ok');
        await loadPayments();
      } catch (err) {
        Ghost.toast(err.message || 'Не удалось создать заявку', 'err');
      }
      planBtn.disabled = false;
    });

    document.getElementById('rotateBtn').addEventListener('click', async function () {
      if (!confirm('Перевыпустить ключ? Старая ссылка перестанет работать.')) return;
      try {
        await Ghost.api('/api/me/refresh-key', { method: 'POST' });
        Ghost.toast('Ключ перевыпущен', 'ok');
        await load();
      } catch (err) {
        Ghost.toast(err.message, 'err');
      }
    });

    document.getElementById('passBtn').addEventListener('click', async function () {
      const current = document.getElementById('currentPassword').value;
      const next = document.getElementById('newPassword').value;
      if (!current || next.length < 8) {
        Ghost.toast('Проверьте пароли (минимум 8 символов)', 'err');
        return;
      }
      try {
        await Ghost.api('/api/me/password', {
          method: 'POST',
          body: { currentPassword: current, newPassword: next },
        });
        document.getElementById('currentPassword').value = '';
        document.getElementById('newPassword').value = '';
        Ghost.toast('Пароль обновлён', 'ok');
      } catch (err) {
        Ghost.toast(err.message, 'err');
      }
    });

    setInterval(load, 30000);
  });
})();
