/**
 * 视图层 + 业务规则：页面渲染、事件处理、报名/发布/权限规则。
 */
(function () {
  'use strict';

  /* ================= 通用工具 ================= */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  function fmtDateTime(isoOrValue) {
    if (!isoOrValue) return '';
    const d = new Date(isoOrValue);
    if (isNaN(d.getTime())) return esc(isoOrValue);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
           `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  let toastTimer = null;
  function toast(msg, type) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast' + (type ? ' toast-' + type : '');
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
  }

  function openModal(html) {
    document.getElementById('modal-content').innerHTML = html;
    document.getElementById('modal').classList.remove('hidden');
  }
  function closeModal() {
    document.getElementById('modal').classList.add('hidden');
    document.getElementById('modal-content').innerHTML = '';
  }

  /* ================= 站内消息（V3.0） ================= */

  const NOTICE_TEXT = {
    confirmed: '已确认参加',
    waitlisted: '进入候补队列',
    pending: '等待教师审核',
    promoted: '候补转正',
    rejected: '申请未通过'
  };

  /** 写入一条状态消息；同一活动的同一状态变化只记一次（幂等保护） */
  function pushNotice(userId, activityId, type, message) {
    if (!userId) return;
    Store.addNotification({
      id: uid('n'),
      userId: userId,
      activityId: activityId,
      type: type,
      title: NOTICE_TEXT[type] || '报名状态更新',
      message: message,
      createdAt: new Date().toISOString(),
      read: false
    });
  }

  /** 该学生是否有某活动相关的未读消息 */
  function hasUnreadNotice(userId, activityId) {
    return Store.getNotifications(userId).some(n => n.activityId === activityId && !n.read);
  }

  function updateNoticeBadge() {
    const user = Auth.currentUser();
    const btn = document.getElementById('btn-notify');
    if (!btn || !user) return;
    const n = Store.unreadCount(user.id);
    btn.innerHTML = '消息' + (n > 0 ? `<span class="nav-badge">${n}</span>` : '');
    btn.classList.toggle('has-unread', n > 0);
  }

  /* ================= 业务规则 ================= */

  /** 活动可报名状态：open（报名中）/ closed（教师关闭）/ deadline（已过截止时间） */
  function activityState(a) {
    if (a.status === 'closed') return 'closed';
    if (new Date(a.deadline).getTime() < Date.now()) return 'deadline';
    return 'open';
  }

  function stateBadge(state) {
    if (state === 'open') return '<span class="badge badge-open">报名中</span>';
    if (state === 'closed') return '<span class="badge badge-closed">已关闭报名</span>';
    return '<span class="badge badge-closed">报名已截止</span>';
  }

  function regCount(activityId) {
    return Store.activeRegistrationsOf(activityId).length;
  }

  /** 活动发布校验：返回错误信息，合法返回 null */
  function validateActivity(f) {
    if (!f.title) return '请填写活动标题';
    if (!f.location) return '请填写活动地点';
    if (!f.start || !f.end || !f.deadline) return '请完整填写开始时间、结束时间和报名截止时间';
    const start = new Date(f.start), end = new Date(f.end), deadline = new Date(f.deadline);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || isNaN(deadline.getTime())) {
      return '时间格式不正确';
    }
    if (end.getTime() <= start.getTime()) return '结束时间必须晚于开始时间';
    if (deadline.getTime() > start.getTime()) return '报名截止时间不能晚于活动开始时间';
    const cap = Number(f.capacity);
    if (!Number.isInteger(cap) || cap <= 0) return '名额上限必须为正整数';
    return null;
  }

  /** 报名校验：返回错误信息，合法返回 null。
   *  V3.0：重复申请不再当作错误，改为在提交时返回既有记录（幂等），此处只校验业务前置条件。 */
  function validateSignup(a, student, studentNo, phone) {
    const state = activityState(a);
    if (state === 'closed') return '该活动已被教师关闭报名，无法报名';
    if (state === 'deadline') return '该活动报名已截止，无法报名';
    if (!studentNo || !studentNo.trim()) return '请填写学号';
    if (!phone || !phone.trim()) return '请填写手机号';
    if (!/^1\d{10}$/.test(phone.trim())) return '手机号格式不正确（应为 11 位数字）';
    return null;
  }

  /** 是否允许取消报名 */
  function canCancel(a) {
    return activityState(a) === 'open';
  }

  /* ================= 视图路由 ================= */

  const VIEWS = {
    guest: 'view-guest',
    hall: 'view-student-hall',
    mine: 'view-student-mine',
    publish: 'view-teacher-publish',
    teacherMine: 'view-teacher-mine'
  };

  function showView(name) {
    Object.values(VIEWS).forEach(id => document.getElementById(id).classList.add('hidden'));
    document.getElementById(VIEWS[name]).classList.remove('hidden');
    document.querySelectorAll('#nav .nav-item').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === name);
    });
    if (name === 'hall') renderHall();
    if (name === 'mine') renderMine();
    if (name === 'teacherMine') renderTeacherMine();
  }

  function renderNav() {
    const nav = document.getElementById('nav');
    const user = Auth.currentUser();
    if (!user) { nav.innerHTML = ''; return; }

    const items = user.role === 'student'
      ? [['hall', '活动大厅'], ['mine', '我的报名']]
      : [['teacherMine', '我的活动'], ['publish', '发布活动']];

    let html = `<span class="user-info">${esc(user.name)}（${user.role === 'student' ? '学生' : '教师'}）</span>`;
    items.forEach(([v, label]) => {
      html += `<button type="button" class="nav-item" data-view="${v}">${label}</button>`;
    });
    if (user.role === 'student') {
      html += '<button type="button" class="nav-action" id="btn-notify">消息</button>';
    }
    html += '<button type="button" id="btn-logout">退出登录</button>';
    html += '<button type="button" id="btn-delete-account" class="btn-danger-text">注销账户</button>';
    nav.innerHTML = html;

    document.querySelectorAll('#nav .nav-item').forEach(btn => {
      btn.addEventListener('click', () => showView(btn.dataset.view));
    });
    const notifyBtn = document.getElementById('btn-notify');
    if (notifyBtn) notifyBtn.addEventListener('click', openNoticeCenter);
    updateNoticeBadge();
    document.getElementById('btn-logout').addEventListener('click', () => {
      Auth.logout();
      boot();
      toast('已退出登录');
    });
    document.getElementById('btn-delete-account').addEventListener('click', () => {
      const user = Auth.currentUser();
      const ok = confirm('注销账户将删除本人账号及其全部相关数据（教师发布的活动与报名、学生的报名记录），且不可恢复。确定要注销账户吗？');
      if (!ok) return;
      Auth.deleteAccount();
      boot();
      toast('账户已注销，相关数据已清除');
    });
  }

  /* ================= 未登录：登录 / 注册 ================= */

  function bindGuest() {
    document.querySelectorAll('.auth-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const isLogin = tab.dataset.tab === 'login';
        document.getElementById('form-login').classList.toggle('hidden', !isLogin);
        document.getElementById('form-register').classList.toggle('hidden', isLogin);
      });
    });

    document.getElementById('form-login').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const user = await Auth.login(
          document.getElementById('login-username').value,
          document.getElementById('login-password').value
        );
        toast('登录成功，欢迎 ' + user.name, 'success');
        enterHome(user);
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    document.getElementById('reg-role').addEventListener('change', (e) => {
      document.getElementById('reg-authcode-row').classList.toggle('hidden', e.target.value !== 'teacher');
    });

    document.getElementById('form-register').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const user = await Auth.register(
          document.getElementById('reg-username').value,
          document.getElementById('reg-name').value,
          document.getElementById('reg-password').value,
          document.getElementById('reg-role').value,
          document.getElementById('reg-authcode').value
        );
        toast('注册成功，已自动登录', 'success');
        enterHome(user);
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    document.getElementById('link-seed').addEventListener('click', (e) => {
      e.preventDefault();
      seedDemoData();
    });
  }

  /** 登录/注册后进入角色首页 */
  function enterHome(user) {
    renderNav();
    showView(user.role === 'student' ? 'hall' : 'teacherMine');
  }

  /* ================= 学生：活动大厅 ================= */

  /** 报名的当前状态文案；候补显示队列位置与总人数 */
  function stateText(reg, activityId) {
    if (reg.status === 'registered') return '已确认参加';
    if (reg.status === 'pending') return '待教师审核';
    if (reg.status === 'waitlisted') {
      const queue = Store.waitlistedRegistrationsOf(activityId);
      const idx = queue.findIndex(x => x.id === reg.id);
      return `候补第 ${idx + 1} 位 / 共 ${queue.length} 人`;
    }
    if (reg.status === 'rejected') return '申请未通过';
    if (reg.status === 'cancelled') return '已取消';
    return reg.status;
  }

  function noticeMessage(reg, a) {
    if (reg.status === 'registered') return `你报名的《${a.title}》已确认参加。`;
    if (reg.status === 'waitlisted') {
      return `《${a.title}》名额已满，你已进入候补队列，当前${stateText(reg, a.id)}。`;
    }
    return `《${a.title}》的参加申请已提交，等待教师审核。`;
  }

  /** 报名回执面板：替代原先 2.6 秒后消失的 toast，给出可回看的提交结果 */
  function showSignupResult(a, reg, isRepeat) {
    const tips = {
      registered: '你已占用一个名额，报名截止前可在“我的报名”中取消。',
      waitlisted: '名额释放时系统按进入顺序自动补位，补位结果会出现在“消息”里。',
      pending: '该活动需要教师审核，审核结果会出现在“消息”里。'
    };
    openModal(`
      <h3>报名回执</h3>
      <div class="receipt">
        <div class="receipt-row"><span>活动</span><b>${esc(a.title)}</b></div>
        <div class="receipt-row"><span>状态</span><b class="receipt-status">${esc(stateText(reg, a.id))}</b></div>
        <div class="receipt-row"><span>回执号</span><code>${esc(reg.requestNo || '—')}</code></div>
        <div class="receipt-row"><span>提交时间</span><span>${fmtDateTime(reg.createdAt)}</span></div>
      </div>
      <p class="muted">${isRepeat ? '你此前已提交过该活动，系统返回同一条报名记录，未重复占用名额。' : ''}${esc(tips[reg.status] || '')}</p>
      <div class="result-actions">
        <button type="button" class="btn btn-primary" id="btn-goto-mine">查看我的报名</button>
        <button type="button" class="btn" id="btn-close-result">关闭</button>
      </div>
    `);
    document.getElementById('btn-goto-mine').addEventListener('click', () => { closeModal(); showView('mine'); });
    document.getElementById('btn-close-result').addEventListener('click', closeModal);
  }

  /** 消息中心：打开即把当前用户的消息标记为已读（未读样式保留在本次弹窗中） */
  function openNoticeCenter() {
    const user = Auth.currentUser();
    if (!user || user.role !== 'student') return;
    const list = Store.getNotifications(user.id)
      .slice()
      .sort((x, y) => new Date(y.createdAt) - new Date(x.createdAt));
    const unread = Store.unreadCount(user.id);

    const body = list.length === 0
      ? '<div class="empty">暂无消息。报名结果、审核结果和候补补位都会在这里留下记录。</div>'
      : '<div class="msg-list">' + list.map(n => {
          const a = Store.findActivityById(n.activityId);
          return `
            <div class="msg-item ${n.read ? '' : 'msg-unread'}" ${a ? `data-activity="${esc(n.activityId)}"` : ''}>
              <div class="msg-head">
                <span class="msg-type">${esc(n.title)}</span>
                <span class="msg-time">${fmtDateTime(n.createdAt)}</span>
              </div>
              <div class="msg-body">${esc(n.message)}</div>
              ${a ? `<div class="msg-activity">活动：${esc(a.title)}</div>` : '<div class="msg-activity">活动已删除</div>'}
            </div>`;
        }).join('') + '</div>';

    openModal(`
      <h3>消息</h3>
      <p class="muted">共 ${list.length} 条${unread > 0 ? `，其中 ${unread} 条未读` : '，已全部读过'}</p>
      ${body}
    `);

    Store.markNotificationsRead(user.id);
    updateNoticeBadge();
    renderMine(); // 消除“我的报名”卡片上的“有新变化”标记
    document.querySelectorAll('.msg-item[data-activity]').forEach(el => {
      el.addEventListener('click', () => {
        closeModal();
        openActivityDetail(el.dataset.activity);
      });
    });
  }

  function activityCard(a, state) {
    const count = regCount(a.id);
    const full = count >= a.capacity;
    return `
      <div class="card">
        <div class="card-title">${esc(a.title)}${stateBadge(state)}</div>
        <div class="card-meta">时间：${fmtDateTime(a.startTime)} ~ ${fmtDateTime(a.endTime)}</div>
        <div class="card-meta">地点：${esc(a.location)}</div>
        <div class="card-meta">名额：${count} / ${a.capacity}${full ? '（已满）' : ''}　报名截止：${fmtDateTime(a.deadline)}</div>
        <div class="card-meta">发布教师：${esc(a.publisherName)}</div>
        <div class="card-actions">
          <button type="button" class="btn btn-primary btn-sm" data-detail="${a.id}">查看详情 / 报名</button>
        </div>
      </div>`;
  }

  function renderHall() {
    const list = document.getElementById('hall-list');
    const acts = Store.getActivities()
      .slice()
      .sort((x, y) => new Date(x.startTime) - new Date(y.startTime));
    if (acts.length === 0) {
      list.innerHTML = '<div class="empty">暂无活动，请等待教师发布。</div>';
      return;
    }
    list.innerHTML = acts.map(a => activityCard(a, activityState(a))).join('');
    list.querySelectorAll('[data-detail]').forEach(btn => {
      btn.addEventListener('click', () => openActivityDetail(btn.dataset.detail));
    });
  }

  function openActivityDetail(activityId) {
    const a = Store.findActivityById(activityId);
    if (!a) { toast('活动不存在', 'error'); return; }
    const user = Auth.currentUser();
    const state = activityState(a);
    const count = regCount(a.id);
    const mine = user && user.role === 'student'
      ? Store.findOpenRegistration(a.id, user.id) : null;

    let actionHtml = '';
    if (state !== 'open') {
      actionHtml = `<p class="muted">${state === 'closed' ? '该活动已被教师关闭报名。' : '该活动报名已截止。'}</p>`
        + (mine ? `<p class="muted">你的报名状态：${esc(stateText(mine, a.id))}，可在“我的报名”中查看。</p>` : '');
    } else if (mine) {
      actionHtml = `<p class="muted">你的报名状态：<b>${esc(stateText(mine, a.id))}</b>，可在“我的报名”中查看或取消。</p>`;
    } else {
      actionHtml = `
        <form id="form-signup" class="signup-form">
          <label>学号 <input type="text" id="su-no" placeholder="请输入学号" maxlength="20"></label>
          <label>手机号 <input type="text" id="su-phone" placeholder="用于活动联系，11 位手机号" maxlength="11"></label>
          <button type="submit" class="btn btn-primary">${a.eligibility ? '提交审核申请' : count >= a.capacity ? '加入候补' : '确认报名'}</button>
        </form>`;
    }

    openModal(`
      <h3>${esc(a.title)}${stateBadge(state)}</h3>
      <div class="detail-row">时间：${fmtDateTime(a.startTime)} ~ ${fmtDateTime(a.endTime)}</div>
      <div class="detail-row">地点：${esc(a.location)}</div>
      <div class="detail-row">名额：${count} / ${a.capacity}　报名截止：${fmtDateTime(a.deadline)}</div>
      ${a.eligibility ? `<div class="detail-row">参加条件：${esc(a.eligibility)}</div>` : ''}
      <div class="detail-row">发布教师：${esc(a.publisherName)}</div>
      <div class="desc">${esc(a.description || '（无活动描述）')}</div>
      ${actionHtml}
    `);

    const form = document.getElementById('form-signup');
    if (form) {
      let submitting = false;
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        if (submitting) return; // 提交中重复点击直接忽略

        const noEl = document.getElementById('su-no');
        const phoneEl = document.getElementById('su-phone');
        const err = validateSignup(a, user, noEl.value, phoneEl.value);
        if (err) { toast(err, 'error'); return; }

        // 幂等：已存在有效申请时返回原记录，不新增一条申请
        const existing = Store.findOpenRegistration(a.id, user.id);
        if (existing) { showSignupResult(a, existing, true); return; }

        submitting = true;
        const btn = form.querySelector('button[type=submit]');
        const btnText = btn.textContent;
        btn.disabled = true;
        btn.textContent = '提交中…';

        const requestNo = 'RQ-' + Date.now().toString(36).toUpperCase() + '-' +
          Math.random().toString(36).slice(2, 5).toUpperCase();

        // 模拟一次请求往返：处理期间不允许再次提交，避免"点两次"产生重复申请
        setTimeout(() => {
          let reg = Store.findOpenRegistration(a.id, user.id);
          const isRepeat = !!reg;
          if (!reg) {
            const full = regCount(a.id) >= a.capacity;
            const status = a.eligibility ? 'pending' : (full ? 'waitlisted' : 'registered');
            reg = {
              id: uid('r'),
              requestNo: requestNo,
              activityId: a.id,
              studentId: user.id,
              studentName: user.name,
              studentNo: noEl.value.trim(),
              phone: phoneEl.value.trim(),
              status: status,
              createdAt: new Date().toISOString(),
              lastChangeAt: new Date().toISOString()
            };
            Store.addRegistration(reg);
            pushNotice(user.id, a.id, status, noticeMessage(reg, a));
          }
          submitting = false;
          btn.disabled = false;
          btn.textContent = btnText;
          showSignupResult(a, reg, isRepeat);
          updateNoticeBadge();
        }, 400);
      });
    }
  }

  /* ================= 学生：我的报名 ================= */

  function renderMine() {
    const listEl = document.getElementById('mine-list');
    const user = Auth.currentUser();
    const regs = Store.getRegistrations()
      .filter(r => r.studentId === user.id && ['registered','pending','waitlisted'].includes(r.status))
      .sort((x, y) => new Date(y.createdAt) - new Date(x.createdAt));

    if (regs.length === 0) {
      listEl.innerHTML = '<div class="empty">你还没有报名任何活动，去活动大厅看看吧。</div>';
      return;
    }

    listEl.innerHTML = regs.map(r => {
      const a = Store.findActivityById(r.activityId);
      if (!a) return '';
      const state = activityState(a);
      const cancelable = canCancel(a);
      const label = stateText(r, a.id);
      const unread = hasUnreadNotice(user.id, a.id);
      const cancelLabel = r.status === 'waitlisted' ? '退出候补'
        : r.status === 'pending' ? '撤回申请' : '取消报名';
      return `
        <div class="card">
          <div class="card-title">${esc(a.title)}${stateBadge(state)}<span class="badge badge-mine">${esc(label)}</span>${unread ? '<span class="badge badge-new">有新变化</span>' : ''}</div>
          <div class="card-meta">活动时间：${fmtDateTime(a.startTime)}　地点：${esc(a.location)}</div>
          <div class="card-meta">报名时间：${fmtDateTime(r.createdAt)}　学号：${esc(r.studentNo)}　手机号：${esc(r.phone)}</div>
          <div class="card-meta">回执号：${esc(r.requestNo || '—')}　最近变化：${fmtDateTime(r.lastChangeAt || r.createdAt)}</div>
          <div class="card-actions">
            <button type="button" class="btn btn-sm" data-detail="${a.id}">查看活动详情</button>
            <button type="button" class="btn btn-danger btn-sm" data-cancel="${r.id}" ${cancelable ? '' : 'disabled'}>
              ${cancelable ? cancelLabel : '报名已截止，不可取消'}
            </button>
          </div>
        </div>`;
    }).join('');

    listEl.querySelectorAll('[data-detail]').forEach(btn => {
      btn.addEventListener('click', () => openActivityDetail(btn.dataset.detail));
    });
    listEl.querySelectorAll('[data-cancel]').forEach(btn => {
      btn.addEventListener('click', () => cancelRegistration(btn.dataset.cancel));
    });
  }

  function cancelRegistration(regId) {
    const reg = Store.getRegistrations().find(r => r.id === regId);
    if (!reg) return;
    const a = Store.findActivityById(reg.activityId);
    if (!a || !canCancel(a)) {
      toast('报名已截止，无法取消', 'error');
      return;
    }
    const wasRegistered = reg.status === 'registered';
    reg.status = 'cancelled';
    Store.updateRegistration(reg);
    if (wasRegistered) promoteNext(reg.activityId);
    toast(wasRegistered ? '已取消报名，名额已释放，候补队首已确认' : '已退出申请/候补', 'success');
    renderMine();
  }

  /* ================= 教师：发布活动 ================= */

  function bindPublish() {
    document.getElementById('form-publish').addEventListener('submit', (e) => {
      e.preventDefault();
      const user = Auth.currentUser();
      const f = {
        title: document.getElementById('pub-title').value.trim(),
        location: document.getElementById('pub-location').value.trim(),
        start: document.getElementById('pub-start').value,
        end: document.getElementById('pub-end').value,
        deadline: document.getElementById('pub-deadline').value,
        capacity: document.getElementById('pub-capacity').value,
        description: document.getElementById('pub-description').value.trim()
        ,eligibility: document.getElementById('pub-eligibility').value.trim()
      };
      const err = validateActivity(f);
      if (err) { toast(err, 'error'); return; }

      Store.addActivity({
        id: uid('a'),
        title: f.title,
        description: f.description,
        eligibility: f.eligibility,
        location: f.location,
        startTime: new Date(f.start).toISOString(),
        endTime: new Date(f.end).toISOString(),
        capacity: Number(f.capacity),
        deadline: new Date(f.deadline).toISOString(),
        publisherId: user.id,
        publisherName: user.name,
        status: 'open',
        createdAt: new Date().toISOString()
      });

      e.target.reset();
      toast('活动发布成功', 'success');
      showView('teacherMine');
    });
  }

  /* ================= 教师：我的活动 ================= */

  function renderTeacherMine() {
    const listEl = document.getElementById('teacher-list');
    const user = Auth.currentUser();
    const acts = Store.getActivities()
      .filter(a => a.publisherId === user.id)
      .sort((x, y) => new Date(y.createdAt) - new Date(x.createdAt));

    if (acts.length === 0) {
      listEl.innerHTML = '<div class="empty">你还没有发布活动，点击“发布活动”开始。</div>';
      return;
    }

    listEl.innerHTML = acts.map(a => {
      const state = activityState(a);
      const count = regCount(a.id);
      const closed = a.status === 'closed';
      return `
        <div class="card">
          <div class="card-title">${esc(a.title)}${stateBadge(state)}</div>
          <div class="card-meta">活动时间：${fmtDateTime(a.startTime)} ~ ${fmtDateTime(a.endTime)}　地点：${esc(a.location)}</div>
          <div class="card-meta">确认：${count} / ${a.capacity}；待审核：${Store.pendingRegistrationsOf(a.id).length}；候补：${Store.waitlistedRegistrationsOf(a.id).length}　报名截止：${fmtDateTime(a.deadline)}</div>
          ${a.eligibility ? `<div class="card-meta">参加条件：${esc(a.eligibility)}</div>` : ''}
          <div class="card-actions">
            <button type="button" class="btn btn-primary btn-sm" data-roster="${a.id}">查看报名名单</button>
            <button type="button" class="btn ${closed ? 'btn-success' : 'btn-danger'} btn-sm" data-toggle="${a.id}">
              ${closed ? '重新开放报名' : '关闭报名'}
            </button>
          </div>
        </div>`;
    }).join('');

    listEl.querySelectorAll('[data-roster]').forEach(btn => {
      btn.addEventListener('click', () => openRoster(btn.dataset.roster));
    });
    listEl.querySelectorAll('[data-toggle]').forEach(btn => {
      btn.addEventListener('click', () => toggleActivity(btn.dataset.toggle));
    });
  }

  function openRoster(activityId) {
    const a = Store.findActivityById(activityId);
    const user = Auth.currentUser();
    if (!a || a.publisherId !== user.id) {
      toast('无权查看该活动名单', 'error');
      return;
    }
    const confirmed = Store.activeRegistrationsOf(a.id).sort((x, y) => new Date(x.createdAt) - new Date(y.createdAt));
    const pending = Store.pendingRegistrationsOf(a.id);
    const waiting = Store.waitlistedRegistrationsOf(a.id);
    const regs = confirmed;

    let rows;
    if (regs.length === 0) {
      rows = '<tr><td colspan="5" style="text-align:center;color:#a0aec0;">暂无学生报名</td></tr>';
    } else {
      rows = regs.map((r, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${esc(r.studentName)}</td>
          <td>${esc(r.studentNo)}</td>
          <td>${esc(r.phone)}</td>
          <td>${fmtDateTime(r.createdAt)}</td>
        </tr>`).join('');
    }

    const pendingRows = pending.map(r => `<tr><td>${esc(r.studentName)}</td><td>${esc(r.studentNo)}</td><td>${esc(r.phone)}</td><td>待审核</td><td><button data-review="${r.id}" data-result="approved">通过</button> <button data-review="${r.id}" data-result="rejected">不符合</button></td></tr>`).join('');
    const waitingRows = waiting.map((r,i) => `<tr><td>${i+1}</td><td>${esc(r.studentName)}</td><td>${esc(r.studentNo)}</td><td>${fmtDateTime(r.createdAt)}</td><td>候补</td></tr>`).join('');
    openModal(`
      <h3>报名名单：${esc(a.title)}</h3>
      <div class="detail-row">已确认 ${regs.length}/${a.capacity}；待审核 ${pending.length}；候补 ${waiting.length}（按进入时间）</div>
      <h4>已确认名单</h4>
      <table class="roster-table">
        <thead><tr><th>序号</th><th>姓名</th><th>学号</th><th>手机号</th><th>报名时间</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <h4>条件审核</h4><table class="roster-table"><thead><tr><th>姓名</th><th>学号</th><th>手机</th><th>状态</th><th>操作</th></tr></thead><tbody>${pendingRows || '<tr><td colspan="5">暂无待审核申请</td></tr>'}</tbody></table>
      <h4>候补队列</h4><table class="roster-table"><thead><tr><th>顺序</th><th>姓名</th><th>学号</th><th>进入时间</th><th>状态</th></tr></thead><tbody>${waitingRows || '<tr><td colspan="5">暂无候补</td></tr>'}</tbody></table>
    `);
    document.querySelectorAll('[data-review]').forEach(btn => btn.addEventListener('click', () => reviewRegistration(btn.dataset.review, btn.dataset.result)));
  }

  function promoteNext(activityId) {
    const next = Store.waitlistedRegistrationsOf(activityId)[0];
    if (!next) return;
    next.status = 'registered';
    next.promotedAt = new Date().toISOString();
    next.lastChangeAt = next.promotedAt;
    Store.updateRegistration(next);
    const a = Store.findActivityById(activityId);
    pushNotice(next.studentId, activityId, 'promoted',
      `《${a ? a.title : '活动'}》有名额释放，你已从候补转为已确认参加。`);
  }

  function reviewRegistration(regId, result) {
    const r = Store.getRegistrations().find(x => x.id === regId);
    if (!r || r.status !== 'pending') return;
    const a = Store.findActivityById(r.activityId);
    r.status = result === 'approved' ? (regCount(a.id) < a.capacity ? 'registered' : 'waitlisted') : 'rejected';
    r.reviewedAt = new Date().toISOString();
    r.lastChangeAt = r.reviewedAt;
    Store.updateRegistration(r);
    if (result === 'approved') {
      pushNotice(r.studentId, r.activityId, r.status,
        r.status === 'registered'
          ? `你申请参加的《${a.title}》已通过审核，并确认了名额。`
          : `你申请参加的《${a.title}》已通过审核，因名额已满进入候补，当前${stateText(r, a.id)}。`);
    } else {
      pushNotice(r.studentId, r.activityId, 'rejected',
        `你申请参加的《${a.title}》未通过审核。`);
    }
    toast(result === 'approved' ? (r.status === 'registered' ? '审核通过并确认名额' : '审核通过，加入候补队列') : '已记录审核结果');
    openRoster(a.id);
  }

  function toggleActivity(activityId) {
    const a = Store.findActivityById(activityId);
    const user = Auth.currentUser();
    if (!a || a.publisherId !== user.id) {
      toast('无权管理该活动', 'error');
      return;
    }
    a.status = a.status === 'closed' ? 'open' : 'closed';
    Store.updateActivity(a);
    toast(a.status === 'closed' ? '已关闭报名' : '已重新开放报名', 'success');
    renderTeacherMine();
  }

  /* ================= 演示数据 ================= */

  async function seedDemoData() {
    if (Store.getUsers().length > 0) {
      toast('系统中已有数据，无需重复载入', 'error');
      return;
    }
    const teacher = {
      id: uid('u'), username: 'teacher', name: '王老师', role: 'teacher',
      passwordHash: await Auth.hashPassword('123456'), createdAt: new Date().toISOString()
    };
    const student = {
      id: uid('u'), username: 'student', name: '李同学', role: 'student',
      passwordHash: await Auth.hashPassword('123456'), createdAt: new Date().toISOString()
    };
    Store.addUser(teacher);
    Store.addUser(student);

    const now = Date.now();
    Store.addActivity({
      id: uid('a'),
      title: '2026 年秋季校园招聘会',
      description: '面向全校学生的秋季招聘会，60+ 家企业现场招聘，欢迎携带简历参加。',
      location: '大学生活动中心一楼展厅',
      startTime: new Date(now + 7 * 86400000).toISOString(),
      endTime: new Date(now + 7 * 86400000 + 4 * 3600000).toISOString(),
      capacity: 50,
      deadline: new Date(now + 5 * 86400000).toISOString(),
      publisherId: teacher.id,
      publisherName: teacher.name,
      status: 'open',
      createdAt: new Date().toISOString()
    });
    toast('演示数据已载入：教师 teacher / 学生 student，密码均为 123456', 'success');
  }

  /* ================= 启动 ================= */

  function boot() {
    closeModal();
    const user = Auth.currentUser();
    renderNav();
    if (!user) {
      showView('guest');
    } else {
      enterHome(user);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindGuest();
    bindPublish();
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.querySelector('#modal .modal-mask').addEventListener('click', closeModal);
    boot();
  });
})();
