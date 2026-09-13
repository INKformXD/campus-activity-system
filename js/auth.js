/**
 * 业务逻辑层：注册、登录、会话管理与密码哈希。
 */
const Auth = {
  /** 教师注册认证码（演示环境固定值，正式环境应由管理端发放） */
  TEACHER_AUTH_CODE: 'JS2026',

  /**
   * 密码哈希：优先使用 SHA-256（crypto.subtle）；
   * 在不支持的环境退化为内置哈希，保证不保存明文密码。
   */
  hashPassword(password, salt) {
    const s = salt || 'cas_v1_fixed_salt';
    if (window.crypto && crypto.subtle && crypto.subtle.digest) {
      const data = new TextEncoder().encode(s + '::' + password);
      return crypto.subtle.digest('SHA-256', data).then(buf => {
        return Array.from(new Uint8Array(buf))
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');
      });
    }
    // 同步降级方案（非明文）
    return Promise.resolve(this._fallbackHash(s + '::' + password));
  },

  _fallbackHash(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return ('00000000' + (h2 >>> 0).toString(16)).slice(-8) +
           ('00000000' + (h1 >>> 0).toString(16)).slice(-8);
  },

  /**
   * 注册。成功返回 user；失败抛出 Error（message 为可直接提示的中文原因）。
   * 教师身份注册需通过认证码校验（REQ-08），防止任意人员注册教师并发布活动。
   */
  async register(username, name, password, role, authCode) {
    username = (username || '').trim();
    name = (name || '').trim();
    password = password || '';

    if (role !== 'student' && role !== 'teacher') {
      throw new Error('请选择注册身份');
    }
    if (role === 'teacher' && (authCode || '').trim() !== this.TEACHER_AUTH_CODE) {
      throw new Error('教师认证码不正确，无法注册教师身份');
    }
    if (!username) throw new Error('请填写用户名');
    if (username.length < 3 || username.length > 20) {
      throw new Error('用户名长度应为 3-20 位字符');
    }
    if (!name) throw new Error('请填写姓名');
    if (password.length < 6) throw new Error('密码长度至少 6 位');
    if (Store.findUserByUsername(username)) {
      throw new Error('该用户名已被注册，请更换用户名');
    }

    const user = {
      id: uid('u'),
      username,
      name,
      role,
      passwordHash: await this.hashPassword(password),
      createdAt: new Date().toISOString()
    };
    Store.addUser(user);
    Store.setSessionUserId(user.id);
    return user;
  },

  /**
   * 登录。成功返回 user；失败抛出 Error。
   */
  async login(username, password) {
    username = (username || '').trim();
    password = password || '';
    if (!username || !password) throw new Error('请输入用户名和密码');

    const user = Store.findUserByUsername(username);
    if (!user) throw new Error('用户名不存在，请先注册');

    const hash = await this.hashPassword(password);
    if (hash !== user.passwordHash) throw new Error('密码错误，请重新输入');

    Store.setSessionUserId(user.id);
    return user;
  },

  logout() {
    Store.clearSession();
  },

  /**
   * 注销账户（REQ-09）：删除当前登录用户及其关联数据，且不可恢复。
   * 教师账户：同时删除其发布的活动及这些活动的全部报名记录；
   * 学生账户：删除其全部报名记录。注销后清除会话并返回登录页。
   */
  deleteAccount() {
    const user = this.currentUser();
    if (!user) return;
    Store.purgeUserData(user);
    Store.clearSession();
  },

  /** 当前登录用户，未登录返回 null */
  currentUser() {
    const id = Store.getSessionUserId();
    return id ? Store.findUserById(id) : null;
  }
};
