/* GhostVPN - admin panel */
(function () {
  'use strict';

  const STATUS = {
    active: ['Активен', 'badge-ok'],
    expired: ['Истёк', 'badge-err'],
    limited: ['Лимит', 'badge-warn'],
    disabled: ['Отключён', 'badge-err'],
    banned: ['Бан', 'badge-err'],
    pending: ['Ожидает', 'badge-warn'],
  };

  let users = [];

  /* -------------------------------------------------------------- */
  /* helpers                                                         */
  /* -------------------------------------------------------------- */

  function statusBadge(status) {
    const item = STATUS[status] || [status, 'badge'];
    return '<span class="badge ' + item[1] + '">' + Ghost.escape(item[0]) + '</span>';
  }

  function expiryCell(user) {
    if (!user.expiresAt) return '<span class="muted">бессрочно</span>';
    const days = Math.ceil((user.expiresAt - Date.now()) / 86400000);
    const cls = days <= 0 ? 'badge-err' : days <= 3 ? 'badge-warn' : 'badge-info';
    return '<span class="badge ' + cls + '">' + Ghost.date(user.expiresAt) + '</span>';
  }

  function trafficCell(user) {
    const used = user.trafficUsedGb;
    if (!user.trafficLimitGb) return used + ' ГБ / без лимита';
    return used + ' / ' + user.trafficLimitGb + ' ГБ';
  }

  function rowHtml(user) {
    return (
      '<tr data-id="' + user.id + '">' +
      '<td><b>' + Ghost.escape(user.email) + '</b><div class="small muted">' + Ghost.escape(user.username) +
      (user.role === 'admin' ? ' · <span class="badge badge-brand">админ</span>' : '') + '</div></td>' +
      '<td>' + statusBadge(user.effectiveStatus || user.status) + '</td>' +
      '<td>' + trafficCell(user) + '</td>' +
      '<td>' + expiryCell(user) + '</td>' +
      '<td>' + (user.online || 0) + '</td>' +
      '<td><div class="row gap-sm wrap">' +
      '<button class="btn btn-sm btn-ghost" data-action="edit">Изм.</button>' +
      '<button class="btn btn-sm btn-ghost" data-action="extend">+30 дн.</button>' +
      '<button class="btn btn-sm btn-ghost" data-action="reset">Трафик</button>' +
      '<button class="btn btn-sm btn-ghost" data-action="rotate">Ключ</button>' +
      (user.status === 'pending'
        ? '<button class="btn btn-sm" data-action="activate">Активировать</button>'
        : '<button class="btn btn-sm btn-ghost" data-action="toggle">' +
          (user.status === 'active' ? 'Отключить' : 'Включить') + '</button>') +
      '<button class="btn btn-sm btn-danger" data-action="delete">Удалить</button>' +
      '</div></td></tr>'
    );
  }

  function renderUsers(list) {
    users = list;
    const body = document.getElementById('usersBody');
    const q = (document.getElementById('searchInput').value || '').toLowerCase();
    const filtered = q
      ? list.filter((u) => (u.email + ' ' + u.username).toLowerCase().includes(q))
      : list;
    body.innerHTML = filtered.length
      ? filtered.map(rowHtml).join('')
      : '<tr><td colspan="6" class="muted center">Аккаунтов нет</td></tr>';
  }

  /* -------------------------------------------------------------- */
  /* data loading                                                    */
  /* -------------------------------------------------------------- */

  async function loadUsers() {
    const res = await Ghost.api('/api/admin/users');
    renderUsers(res.users);
    document.getElementById('statUsers').textContent = res.totals.count;
    document.getElementById('statActive').textContent = res.totals.active;
    document.getElementById('statOnline').textContent = res.totals.online;
    document.getElementById('statTraffic').textContent = Ghost.bytes(res.totals.trafficUsed);
    document.getElementById('statUsersNote').textContent = 'всего аккаунтов';
    document.getElementById('statActiveNote').textContent = 'с доступом';
    document.getElementById('statOnlineNote').textContent = 'сессий сейчас';
    document.getElementById('statTrafficNote').textContent = 'суммарно израсходовано';
  }

  async function loadSettings() {
    const res = await Ghost.api('/api/admin/settings');
    const s = res.settings;
    const set = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.value = value === undefined || value === null ? '' : value;
    };
    set('set_port', s.serverPort);
    set('set_public', s.publicUrl);
    set('set_sni', s.realitySni);
    set('set_dest', s.realityDest);
    set('set_fp', s.realityFingerprint);
    set('set_log', s.loglevel);
    set('set_quic', s.allowQuic ? '1' : '0');
    set('set_name', s.siteName);
    set('set_tagline', s.siteTagline);
    set('set_support', s.supportUrl);
    set('set_currency', s.currency);
    set('set_price_1m', s.prices['1m']);
    set('set_price_3m', s.prices['3m']);
    set('set_price_6m', s.prices['6m']);
    set('set_price_12m', s.prices['12m']);
    set('set_reg', s.registrationOpen ? '1' : '0');
    set('set_inv', s.inviteRequired ? '1' : '0');
    set('set_devices', s.deviceLimit);
    set('set_traffic', s.defaultTrafficGb);
    set('set_trial', s.trialDays);
  }

  async function loadInvites() {
    const res = await Ghost.api('/api/admin/invites');
    const body = document.getElementById('invitesBody');
    body.innerHTML = res.invites.length
      ? res.invites.map((i) =>
          '<tr><td class="mono">' + Ghost.escape(i.code) + '</td>' +
          '<td>' + i.used + ' / ' + i.max_uses + '</td>' +
          '<td class="small muted">' + Ghost.datetime(i.created_at) + '</td>' +
          '<td><button class="btn btn-sm btn-danger" data-invite="' + Ghost.escape(i.code) + '">Удалить</button></td></tr>'
        ).join('')
      : '<tr><td colspan="4" class="muted center">Инвайтов нет</td></tr>';
  }

  async function loadEvents() {
    const res = await Ghost.api('/api/admin/events?limit=150');
    const body = document.getElementById('eventsBody');
    body.innerHTML = res.events.length
      ? res.events.map((e) =>
          '<tr><td class="small muted nowrap">' + Ghost.datetime(e.created_at) + '</td>' +
          '<td><span class="badge">' + Ghost.escape(e.type) + '</span></td>' +
          '<td class="small">' + Ghost.escape(e.message) + '</td>' +
          '<td class="small muted">' + Ghost.escape(e.ip || '—') + '</td></tr>'
        ).join('')
      : '<tr><td colspan="4" class="muted center">Событий нет</td></tr>';
  }

  async function loadServer() {
    const res = await Ghost.api('/api/admin/stats');
    document.getElementById('serverInfo').innerHTML = [
      ['Состояние', res.xray.running ? '<span class="badge badge-ok">работает</span>' : '<span class="badge badge-err">остановлен</span>'],
      ['PID', res.xray.pid || '—'],
      ['Порт', res.server.port],
      ['Адрес', Ghost.escape(res.server.host)],
      ['SNI', Ghost.escape(res.server.sni)],
      ['Destination', Ghost.escape(res.server.dest)],
      ['Конфиг', '<span class="mono small">' + Ghost.escape(res.xray.configPath || '') + '</span>'],
      ['Ошибка', res.xray.error ? '<span class="badge badge-err">' + Ghost.escape(res.xray.error) + '</span>' : '—'],
    ].map((p) => '<dt>' + p[0] + '</dt><dd>' + p[1] + '</dd>').join('');

    document.getElementById('realityInfo').innerHTML = [
      ['Public key', '<span class="mono small">' + Ghost.escape(res.xray.realityPublicKey || '') + '</span>'],
      ['Short IDs', '<span class="mono small">' + Ghost.escape((res.xray.shortIds || []).join(', ')) + '</span>'],
    ].map((p) => '<dt>' + p[0] + '</dt><dd>' + p[1] + '</dd>').join('');
  }

  /* -------------------------------------------------------------- */
  /* user modal                                                      */
  /* -------------------------------------------------------------- */

  const modal = document.getElementById('userModal');
  const modalAlert = document.getElementById('modalAlert');

  function openModal(user) {
    modalAlert.classList.remove('show');
    document.getElementById('modalTitle').textContent = user ? 'Редактировать аккаунт' : 'Новый аккаунт';
    document.getElementById('f_id').value = user ? user.id : '';
    document.getElementById('f_email').value = user ? user.email : '';
    document.getElementById('f_username').value = user ? user.username : '';
    document.getElementById('f_password').value = '';
    document.getElementById('f_password').required = !user;
    document.getElementById('f_role').value = user ? user.role : 'user';
    document.getElementById('f_status').value = user ? user.status : 'active';
    document.getElementById('f_traffic').value = user ? user.trafficLimitGb : 0;
    document.getElementById('f_devices').value = user ? user.deviceLimit : 3;
    document.getElementById('f_note').value = user ? user.note : '';
    if (user && user.expiresAt) {
      const days = Math.max(0, Math.ceil((user.expiresAt - Date.now()) / 86400000));
      document.getElementById('f_days').value = days;
    } else {
      document.getElementById('f_days').value = 0;
    }
    modal.classList.add('show');
  }

  function closeModal() {
    modal.classList.remove('show');
  }

  document.getElementById('userForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    modalAlert.classList.remove('show');
    const id = document.getElementById('f_id').value;
    const days = Number(document.getElementById('f_days').value || 0);
    const payload = {
      email: document.getElementById('f_email').value,
      username: document.getElementById('f_username').value,
      role: document.getElementById('f_role').value,
      status: document.getElementById('f_status').value,
      trafficLimitGb: Number(document.getElementById('f_traffic').value || 0),
      deviceLimit: Number(document.getElementById('f_devices').value || 0),
      note: document.getElementById('f_note').value,
    };
    const password = document.getElementById('f_password').value;
    if (password) payload.password = password;

    try {
      if (id) {
        const res = await Ghost.api('/api/admin/users/' + id, { method: 'PATCH', body: payload });
        if (days > 0) {
          await Ghost.api('/api/admin/users/' + id + '/extend', { method: 'POST', body: { days } });
        }
        void res;
      } else {
        await Ghost.api('/api/admin/users', { method: 'POST', body: payload });
        if (days > 0) {
          const list = await Ghost.api('/api/admin/users');
          const created = list.users.find((u) => u.email === payload.email.toLowerCase());
          if (created) {
            await Ghost.api('/api/admin/users/' + created.id + '/extend', { method: 'POST', body: { days } });
          }
        }
      }
      closeModal();
      Ghost.toast('Сохранено', 'ok');
      await loadUsers();
    } catch (err) {
      modalAlert.textContent = err.message || 'Ошибка сохранения';
      modalAlert.classList.add('show');
    }
  });

  document.getElementById('modalCancel').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  /* -------------------------------------------------------------- */
  /* events                                                          */
  /* -------------------------------------------------------------- */

  document.getElementById('usersBody').addEventListener('click', async function (e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const tr = btn.closest('tr');
    const id = tr.getAttribute('data-id');
    const user = users.find((u) => String(u.id) === id);
    if (!user) return;
    const action = btn.getAttribute('data-action');

    try {
      if (action === 'edit') {
        openModal(user);
        return;
      }
      if (action === 'extend') {
        await Ghost.api('/api/admin/users/' + id + '/extend', { method: 'POST', body: { days: 30 } });
        Ghost.toast('Продлено на 30 дней', 'ok');
      } else if (action === 'reset') {
        if (!confirm('Сбросить счётчик трафика у ' + user.email + '?')) return;
        await Ghost.api('/api/admin/users/' + id + '/reset-traffic', { method: 'POST' });
        Ghost.toast('Трафик сброшен', 'ok');
      } else if (action === 'rotate') {
        if (!confirm('Перевыпустить ключ у ' + user.email + '? Старая ссылка перестанет работать.')) return;
        await Ghost.api('/api/admin/users/' + id + '/rotate-key', { method: 'POST' });
        Ghost.toast('Ключ перевыпущен', 'ok');
      } else if (action === 'activate') {
        const days = Number(prompt('На сколько дней активировать ключ?', '30'));
        if (!days) return;
        await Ghost.api('/api/admin/users/' + id + '/activate', { method: 'POST', body: { days: Number(days) } });
        Ghost.toast('Ключ активирован на ' + days + ' дн.', 'ok');
      } else if (action === 'toggle') {
        const next = user.status === 'active' ? 'disabled' : 'active';
        await Ghost.api('/api/admin/users/' + id, { method: 'PATCH', body: { status: next } });
        Ghost.toast(next === 'active' ? 'Аккаунт включён' : 'Аккаунт отключён', 'ok');
      } else if (action === 'delete') {
        if (!confirm('Удалить ' + user.email + '? Действие необратимо.')) return;
        await Ghost.api('/api/admin/users/' + id, { method: 'DELETE' });
        Ghost.toast('Аккаунт удалён', 'ok');
      }
      await loadUsers();
    } catch (err) {
      Ghost.toast(err.message || 'Ошибка', 'err');
    }
  });

  document.getElementById('invitesBody').addEventListener('click', async function (e) {
    const btn = e.target.closest('[data-invite]');
    if (!btn) return;
    const code = btn.getAttribute('data-invite');
    if (!confirm('Удалить инвайт ' + code + '?')) return;
    await Ghost.api('/api/admin/invites/' + encodeURIComponent(code), { method: 'DELETE' });
    await loadInvites();
  });

  async function loadPayments() {
    const res = await Ghost.api('/api/admin/payments');
    const body = document.getElementById('paymentsBody');
    const labels = {
      pending: ['ожидает', 'badge-warn'],
      paid: ['оплачено', 'badge-ok'],
      rejected: ['отклонено', 'badge-err'],
    };
    body.innerHTML = res.payments.length
      ? res.payments.map((p) => {
          const item = labels[p.status] || [p.status, 'badge'];
          const actions = p.status === 'pending'
            ? '<button class="btn btn-sm" data-pay="paid" data-id="' + p.id + '">Подтвердить</button>' +
              '<button class="btn btn-sm btn-ghost" data-pay="rejected" data-id="' + p.id + '">Отклонить</button>'
            : '';
          return (
            '<tr><td class="small muted nowrap">' + Ghost.datetime(p.created_at) + '</td>' +
            '<td>' + Ghost.escape(p.email || '—') + '</td>' +
            '<td>' + Ghost.escape(p.plan) + ' · ' + p.days + ' дн.</td>' +
            '<td>' + p.amount + ' ' + Ghost.escape(p.currency) + '</td>' +
            '<td><span class="badge ' + item[1] + '">' + item[0] + '</span></td>' +
            '<td><div class="row gap-sm">' + actions + '</div></td></tr>'
          );
        }).join('')
      : '<tr><td colspan="6" class="muted center">Заявок нет</td></tr>';
  }

  document.getElementById('paymentsBody').addEventListener('click', async function (e) {
    const btn = e.target.closest('[data-pay]');
    if (!btn) return;
    const id = btn.getAttribute('data-id');
    const action = btn.getAttribute('data-pay');
    if (action === 'rejected' && !confirm('Отклонить заявку?')) return;
    try {
      await Ghost.api('/api/admin/payments/' + id + '/' + action, { method: 'POST' });
      Ghost.toast(action === 'paid' ? 'Оплата подтверждена' : 'Заявка отклонена', 'ok');
      await loadPayments();
      await loadUsers();
    } catch (err) {
      Ghost.toast(err.message || 'Ошибка', 'err');
    }
  });

  /* -------------------------------------------------------------- */
  /* Batch key generation                                            */
  /* -------------------------------------------------------------- */

  let generatedKeys = [];

  async function loadBatches() {
    const res = await Ghost.api('/api/admin/batches');
    const body = document.getElementById('batchesBody');
    body.innerHTML = res.batches.length
      ? res.batches.map((b) =>
          '<tr><td>' + Ghost.escape(b.label) + '</td>' +
          '<td>' + b.count + '</td>' +
          '<td>' + b.active + '</td>' +
          '<td>' + b.pending + '</td>' +
          '<td><button class="btn btn-sm btn-ghost" data-batch="' + Ghost.escape(b.label) + '">Экспорт</button></td></tr>'
        ).join('')
      : '<tr><td colspan="5" class="muted center">Партий пока нет</td></tr>';
  }

  document.getElementById('generateBtn').addEventListener('click', async function () {
    const alertBox = document.getElementById('genAlert');
    alertBox.classList.remove('show');
    const btn = this;
    btn.disabled = true;
    btn.textContent = 'Создаём...';
    try {
      const res = await Ghost.api('/api/admin/batch-keys', {
        method: 'POST',
        body: {
          count: Number(document.getElementById('gen_count').value || 1),
          days: Number(document.getElementById('gen_days').value || 30),
          trafficGb: Number(document.getElementById('gen_traffic').value || 0),
          plan: document.getElementById('gen_plan').value,
          price: Number(document.getElementById('gen_price').value || 0),
          label: document.getElementById('gen_label').value,
          usernamePrefix: document.getElementById('gen_prefix').value,
          emailDomain: document.getElementById('gen_domain').value,
          activate: document.getElementById('gen_activate').value === '1',
        },
      });
      generatedKeys = res.created;
      document.getElementById('genSummary').textContent =
        'Создано ключей: ' + res.created.length + (res.failed.length ? ', ошибок: ' + res.failed.length : '') +
        ' · срок ' + res.days + ' дн. · тариф «' + res.plan + '»';
      document.getElementById('genKeysBox').textContent =
        res.created.map((k) => k.email + '  ' + k.password + '\n' + k.key).join('\n\n') || '—';
      Ghost.toast('Создано ключей: ' + res.created.length, 'ok');
      await loadBatches();
      await loadUsers();
    } catch (err) {
      alertBox.textContent = err.message || 'Ошибка генерации';
      alertBox.classList.add('show');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Сгенерировать';
    }
  });

  document.getElementById('copyGenBtn').addEventListener('click', function () {
    if (!generatedKeys.length) { Ghost.toast('Сначала сгенерируйте ключи', 'err'); return; }
    Ghost.copy(generatedKeys.map((k) => k.key).join('\n'), 'Ключи скопированы');
  });

  function downloadCsv(rows, filename) {
    const escape = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const header = ['email', 'password', 'status', 'expires_at', 'traffic_limit_gb', 'key', 'subscription', 'label'];
    const body = rows.map((k) => [
      k.email, k.password, k.status,
      k.expiresAt ? new Date(k.expiresAt).toISOString().slice(0, 10) : '',
      k.trafficLimitGb, k.key, k.subscription, k.label || '',
    ].map(escape).join(','));
    const blob = new Blob(['\ufeff' + [header.map(escape).join(','), ...body].join('\n')],
      { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportKeys(format, label) {
    // Свежие ключи выгружаем из памяти - там есть и пароли.
    if (generatedKeys.length && format === 'csv') {
      downloadCsv(generatedKeys, 'ghostvpn-keys.csv');
      return;
    }
    const target = label || document.getElementById('gen_label').value;
    const url = Ghost.url('/api/admin/export?format=' + format + '&label=' + encodeURIComponent(target));
    window.open(url, '_blank');
  }

  document.getElementById('exportCsvBtn').addEventListener('click', () => exportKeys('csv'));
  document.getElementById('exportTxtBtn').addEventListener('click', () => exportKeys('txt'));

  document.getElementById('batchesBody').addEventListener('click', function (e) {
    const btn = e.target.closest('[data-batch]');
    if (!btn) return;
    exportKeys('csv', btn.getAttribute('data-batch'));
  });

  /* -------------------------------------------------------------- */
  /* tabs & actions                                                  */
  /* -------------------------------------------------------------- */

  document.querySelectorAll('.tab').forEach(function (tab) {
    tab.addEventListener('click', async function () {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const name = tab.getAttribute('data-tab');
      ['users', 'keys', 'payments', 'settings', 'invites', 'events', 'server'].forEach(function (key) {
        document.getElementById('tab-' + key).classList.toggle('hidden', key !== name);
      });
      if (name === 'keys') await loadBatches();
      if (name === 'payments') await loadPayments();
      if (name === 'settings') await loadSettings();
      if (name === 'invites') await loadInvites();
      if (name === 'events') await loadEvents();
      if (name === 'server') { await loadServer(); await loadNetwork(); }
    });
  });

  document.getElementById('newUserBtn').addEventListener('click', () => openModal(null));
  document.getElementById('searchInput').addEventListener('input', () => renderUsers(users));

  document.getElementById('saveSettings').addEventListener('click', async function () {
    const body = {
      server_port: Number(document.getElementById('set_port').value || 443),
      public_url: document.getElementById('set_public').value.trim(),
      reality_sni: document.getElementById('set_sni').value,
      reality_dest: document.getElementById('set_dest').value,
      reality_fingerprint: document.getElementById('set_fp').value,
      loglevel: document.getElementById('set_log').value,
      allow_quic: document.getElementById('set_quic').value,
      site_name: document.getElementById('set_name').value,
      site_tagline: document.getElementById('set_tagline').value,
      support_url: document.getElementById('set_support').value,
      currency: document.getElementById('set_currency').value,
      price_1m: document.getElementById('set_price_1m').value,
      price_3m: document.getElementById('set_price_3m').value,
      price_6m: document.getElementById('set_price_6m').value,
      price_12m: document.getElementById('set_price_12m').value,
      registration_open: document.getElementById('set_reg').value,
      invite_required: document.getElementById('set_inv').value,
      device_limit: Number(document.getElementById('set_devices').value || 0),
      default_traffic_gb: Number(document.getElementById('set_traffic').value || 0),
      trial_days: Number(document.getElementById('set_trial').value || 0),
    };
    try {
      await Ghost.api('/api/admin/settings', { method: 'PUT', body });
      Ghost.toast('Настройки сохранены', 'ok');
      await loadSettings();
    } catch (err) {
      Ghost.toast(err.message, 'err');
    }
  });

  async function loadNetwork() {
    const res = await Ghost.api('/api/admin/network');
    document.getElementById('networkInfo').innerHTML = [
      ['IP в локальной сети', res.lanIp || '—'],
      ['Текущий адрес панели', res.publicUrl || res.host || '—'],
      ['Адрес в ключах сейчас', res.publicUrl || res.lanIp || res.serverHost || res.host],
      ['Порт VPN', res.serverPort],
    ].map((p) => '<dt>' + p[0] + '</dt><dd class="mono">' + Ghost.escape(String(p[1])) + '</dd>').join('');
    document.getElementById('useLanBtn').dataset.value = res.lanIp || '';
  }

  document.getElementById('useLanBtn').addEventListener('click', function () {
    const value = this.dataset.value;
    if (!value) { Ghost.toast('IP в сети не найден', 'err'); return; }
    const field = document.getElementById('set_public');
    field.value = 'http://' + value + ':8080';
    Ghost.toast('Нажмите «Сохранить настройки»', 'ok');
    document.getElementById('set_public').focus();
  });

  document.getElementById('copyAddrBtn').addEventListener('click', async function () {
    const res = await Ghost.api('/api/admin/network');
    Ghost.copy(res.publicUrl || res.lanIp || res.host, 'Адрес скопирован');
  });

  document.getElementById('nodeCheckBtn').addEventListener('click', async function () {
    const box = document.getElementById('nodeCheckResult');
    const btn = this;
    btn.disabled = true;
    box.innerHTML = '<div class="small muted">Проверяем...</div>';
    try {
      const res = await Ghost.api('/api/admin/node-check');
      box.innerHTML =
        '<div class="alert ' + (res.youtubeOk ? 'alert-ok' : 'alert-error') + ' show">' +
        Ghost.escape(res.hint) + '</div>' +
        '<div class="table-wrap"><table><thead><tr><th>Сервис</th><th>Статус</th><th>Время</th></tr></thead><tbody>' +
        res.results.map((r) =>
          '<tr><td>' + Ghost.escape(r.name) + (r.detail ? ' <span class="small muted">' + Ghost.escape(r.detail) + '</span>' : '') + '</td>' +
          '<td>' + (r.ok
            ? '<span class="badge badge-ok">OK ' + r.status + '</span>'
            : '<span class="badge badge-err">' + Ghost.escape(r.error || 'ошибка') + '</span>') + '</td>' +
          '<td class="small muted">' + r.ms + ' мс</td></tr>'
        ).join('') + '</tbody></table></div>';
    } catch (err) {
      box.innerHTML = '<div class="alert alert-error show">' + Ghost.escape(err.message) + '</div>';
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('createInviteBtn').addEventListener('click', async function () {    const code = document.getElementById('inviteCode').value.trim();
    const maxUses = Number(document.getElementById('inviteUses').value || 1);
    try {
      const res = await Ghost.api('/api/admin/invites', { method: 'POST', body: { code, maxUses } });
      Ghost.toast('Создан код: ' + res.code, 'ok');
      document.getElementById('inviteCode').value = '';
      await loadInvites();
    } catch (err) {
      Ghost.toast(err.message, 'err');
    }
  });

  async function restartXray() {
    try {
      await Ghost.api('/api/admin/xray/restart', { method: 'POST' });
      Ghost.toast('Xray перезапущен', 'ok');
    } catch (err) {
      Ghost.toast(err.message, 'err');
    }
  }

  async function reloadClients() {
    try {
      await Ghost.api('/api/admin/xray/reload', { method: 'POST' });
      Ghost.toast('Клиенты обновлены', 'ok');
    } catch (err) {
      Ghost.toast(err.message, 'err');
    }
  }

  document.getElementById('restartXrayBtn').addEventListener('click', restartXray);
  document.getElementById('restartXrayBtn2').addEventListener('click', restartXray);
  document.getElementById('reloadClientsBtn').addEventListener('click', reloadClients);
  document.getElementById('reloadClientsBtn2').addEventListener('click', reloadClients);

  /* -------------------------------------------------------------- */
  /* boot                                                            */
  /* -------------------------------------------------------------- */

  document.addEventListener('DOMContentLoaded', async function () {
    document.getElementById('year').textContent = new Date().getFullYear();
    const user = await Ghost.requireUser({ admin: true });
    if (!user) return;
    await loadUsers();
    setInterval(() => { loadUsers().catch(() => {}); }, 20000);
  });
})();
