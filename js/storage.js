/**
 * 数据访问层：统一封装 localStorage 读写。
 * 业务逻辑层只通过本模块访问数据，后续可替换为服务端 API。
 */
const Store = {
  KEYS: {
    users: 'cas_users',
    activities: 'cas_activities',
    registrations: 'cas_registrations',
    notifications: 'cas_notifications',
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

  /**
   * 注销账户时的关联数据清理：
   * 删除该用户；若为教师，同时删除其发布的活动及这些活动的全部报名记录；
   * 若为学生，删除其全部报名记录。
   */
  purgeUserData(user) {
    const ownActIds = new Set(
      this.getActivities().filter(a => a.publisherId === user.id).map(a => a.id)
    );
    this._write(this.KEYS.activities,
      this.getActivities().filter(a => a.publisherId !== user.id));
    this._write(this.KEYS.registrations,
      this.getRegistrations().filter(r => r.studentId !== user.id && !ownActIds.has(r.activityId)));
    // V3.0：通知同样属于用户数据，注销时一并清理
    this._write(this.KEYS.notifications,
      this.getNotifications().filter(n => n.userId !== user.id && !ownActIds.has(n.activityId)));
    this._write(this.KEYS.users,
      this.getUsers().filter(u => u.id !== user.id));
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

  waitlistedRegistrationsOf(activityId) {
    return this.getRegistrations().filter(r => r.activityId === activityId && r.status === 'waitlisted')
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  },

  pendingRegistrationsOf(activityId) {
    return this.getRegistrations().filter(r => r.activityId === activityId && r.status === 'pending');
  },

  /** 某学生对某活动的有效报名 */
  findActiveRegistration(activityId, studentId) {
    return this.getRegistrations().find(
      r => r.activityId === activityId && r.studentId === studentId && r.status === 'registered'
    ) || null;
  },

  /**
   * V3.0：某学生对某活动尚未结束的申请（已确认 / 待审核 / 候补）。
   * 用于提交幂等：同一学生对同一活动重复提交时返回既有记录，而不是新增一条申请。
   */
  findOpenRegistration(activityId, studentId) {
    return this.getRegistrations().find(
      r => r.activityId === activityId && r.studentId === studentId &&
        ['registered', 'pending', 'waitlisted'].includes(r.status)
    ) || null;
  },

  /* ---------- 站内消息（V3.0） ---------- */
  getNotifications(userId) {
    const list = this._read(this.KEYS.notifications, []);
    return userId ? list.filter(n => n.userId === userId) : list;
  },

  addNotification(notification) {
    const list = this._read(this.KEYS.notifications, []);
    list.push(notification);
    this._write(this.KEYS.notifications, list);
  },

  unreadCount(userId) {
    return this.getNotifications(userId).filter(n => !n.read).length;
  },

  markNotificationsRead(userId) {
    const list = this._read(this.KEYS.notifications, []);
    let changed = false;
    list.forEach(n => {
      if (n.userId === userId && !n.read) { n.read = true; changed = true; }
    });
    if (changed) this._write(this.KEYS.notifications, list);
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
