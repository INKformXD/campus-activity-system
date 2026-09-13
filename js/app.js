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

  /** 报名校验：返回错误信息，合法返回 null */
  function validateSignup(a, student, studentNo, phone) {
    const state = activityState(a);
    if (state === 'closed') return '该活动已被教师关闭报名，无法报名';
    if (state === 'deadline') return '该活动报名已截止，无法报名';
    if (Store.findActiveRegistration(a.id, student.id)) {
      return '你已经报名该活动，请勿重复报名';
    }
    if (regCount(a.id) >= a.capacity) return '该活动名额已满，无法报名';
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
    html += '<button type="button" id="btn-logout">退出登录</button>';
    html += '<button type="button" id="btn-delete-account" class="btn-danger-text">注销账户</button>';
    nav.innerHTML = html;

    document.querySelectorAll('#nav .nav-item').forEach(btn => {
      btn.addEventListener('click', () => showView(btn.dataset.view));
    });
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
      .sort((x, y) => new Date(x.start) - new Date(y.start));
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
      ? Store.findActiveRegistration(a.id, user.id) : null;

    let actionHtml = '';
    if (state !== 'open') {
      actionHtml = `<p class="muted">${state === 'closed' ? '该活动已被教师关闭报名。' : '该活动报名已截止。'}</p>`;
    } else if (mine) {
      actionHtml = '<p class="muted">你已报名该活动，可在“我的报名”中查看或取消。</p>';
    } else if (count >= a.capacity) {
      actionHtml = '<p class="muted">该活动名额已满。</p>';
    } else {
      actionHtml = `
        <form id="form-signup" class="signup-form">
          <label>学号 <input type="text" id="su-no" placeholder="请输入学号" maxlength="20"></label>
          <label>手机号 <input type="text" id="su-phone" placeholder="用于活动联系，11 位手机号" maxlength="11"></label>
          <button type="submit" class="btn btn-primary">确认报名</button>
        </form>`;
    }

    openModal(`
      <h3>${esc(a.title)}${stateBadge(state)}</h3>
      <div class="detail-row">时间：${fmtDateTime(a.startTime)} ~ ${fmtDateTime(a.endTime)}</div>
      <div class="detail-row">地点：${esc(a.location)}</div>
      <div class="detail-row">名额：${count} / ${a.capacity}　报名截止：${fmtDateTime(a.deadline)}</div>
      <div class="detail-row">发布教师：${esc(a.publisherName)}</div>
      <div class="desc">${esc(a.description || '（无活动描述）')}</div>
      ${actionHtml}
    `);

    const form = document.getElementById('form-signup');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const err = validateSignup(a, user,
          document.getElementById('su-no').value,
          document.getElementById('su-phone').value);
        if (err) { toast(err, 'error'); return; }
        Store.addRegistration({
          id: uid('r'),
          activityId: a.id,
          studentId: user.id,
          studentName: user.name,
          studentNo: document.getElementById('su-no').value.trim(),
          phone: document.getElementById('su-phone').value.trim(),
          status: 'registered',
          createdAt: new Date().toISOString()
        });
        toast('报名成功！', 'success');
        closeModal();
        renderHall();
      });
    }
  }

  /* ================= 学生：我的报名 ================= */

  function renderMine() {
    const listEl = document.getElementById('mine-list');
    const user = Auth.currentUser();
    const regs = Store.getRegistrations()
      .filter(r => r.studentId === user.id && r.status === 'registered')
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
      return `
        <div class="card">
          <div class="card-title">${esc(a.title)}${stateBadge(state)}<span class="badge badge-mine">已报名</span></div>
          <div class="card-meta">活动时间：${fmtDateTime(a.startTime)}　地点：${esc(a.location)}</div>
          <div class="card-meta">报名时间：${fmtDateTime(r.createdAt)}　学号：${esc(r.studentNo)}　手机号：${esc(r.phone)}</div>
          <div class="card-actions">
            <button type="button" class="btn btn-sm" data-detail="${a.id}">查看活动详情</button>
            <button type="button" class="btn btn-danger btn-sm" data-cancel="${r.id}" ${cancelable ? '' : 'disabled'}>
              ${cancelable ? '取消报名' : '报名已截止，不可取消'}
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
    reg.status = 'cancelled';
    Store.updateRegistration(reg);
    toast('已取消报名，名额已释放', 'success');
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
      };
      const err = validateActivity(f);
      if (err) { toast(err, 'error'); return; }

      Store.addActivity({
        id: uid('a'),
        title: f.title,
        description: f.description,
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
          <div class="card-meta">报名情况：${count} / ${a.capacity}　报名截止：${fmtDateTime(a.deadline)}</div>
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
    const regs = Store.activeRegistrationsOf(a.id)
      .sort((x, y) => new Date(x.createdAt) - new Date(y.createdAt));

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

    openModal(`
      <h3>报名名单：${esc(a.title)}</h3>
      <div class="detail-row">报名人数：${regs.length} / ${a.capacity}</div>
      <table class="roster-table">
        <thead><tr><th>序号</th><th>姓名</th><th>学号</th><th>手机号</th><th>报名时间</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `);
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
