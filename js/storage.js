/**
 * 数据访问层：统一封装 localStorage 读写。
 * 业务逻辑层只通过本模块访问数据，后续可替换为服务端 API。
 */
const Store = {
  KEYS: {
    users: 'cas_users',
    activities: 'cas_activities',
    registrations: 'cas_registrations',
    session: 'cas_session'
  },

  _read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      const val = raw ? JSON.parse(raw) : fallback;
      return val === null || val === undefined ? fallback : val;
    } catch (e) {
      return fallback;
    }
  },

  _write(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  },

  /* ---------- 用户 ---------- */
  getUsers() {
    return this._read(this.KEYS.users, []);
  },

  findUserByUsername(username) {
    return this.getUsers().find(u => u.username === username) || null;
  },

  findUserById(id) {
    return this.getUsers().find(u => u.id === id) || null;
  },

  addUser(user) {
    const users = this.getUsers();
    users.push(user);
    this._write(this.KEYS.users, users);
  },

  /* ---------- 活动 ---------- */
  getActivities() {
    return this._read(this.KEYS.activities, []);
  },

  findActivityById(id) {
    return this.getActivities().find(a => a.id === id) || null;
  },

  addActivity(activity) {
    const list = this.getActivities();
    list.push(activity);
    this._write(this.KEYS.activities, list);
  },

  updateActivity(activity) {
    const list = this.getActivities();
    const idx = list.findIndex(a => a.id === activity.id);
    if (idx >= 0) {
      list[idx] = activity;
      this._write(this.KEYS.activities, list);
    }
  },

  /* ---------- 报名记录 ---------- */
  getRegistrations() {
    return this._read(this.KEYS.registrations, []);
  },

  addRegistration(reg) {
    const list = this.getRegistrations();
    list.push(reg);
    this._write(this.KEYS.registrations, list);
  },

  updateRegistration(reg) {
    const list = this.getRegistrations();
    const idx = list.findIndex(r => r.id === reg.id);
    if (idx >= 0) {
      list[idx] = reg;
      this._write(this.KEYS.registrations, list);
    }
  },

  /** 某活动的有效报名（status=registered）列表 */
  activeRegistrationsOf(activityId) {
    return this.getRegistrations().filter(
      r => r.activityId === activityId && r.status === 'registered'
    );
  },

  /** 某学生对某活动的有效报名 */
  findActiveRegistration(activityId, studentId) {
    return this.getRegistrations().find(
      r => r.activityId === activityId && r.studentId === studentId && r.status === 'registered'
    ) || null;
  },

  /* ---------- 会话 ---------- */
  getSessionUserId() {
    return this._read(this.KEYS.session, null);
  },

  setSessionUserId(userId) {
    this._write(this.KEYS.session, userId);
  },

  clearSession() {
    localStorage.removeItem(this.KEYS.session);
  }
};

/** 生成简单唯一 id */
function uid(prefix) {
  return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}
