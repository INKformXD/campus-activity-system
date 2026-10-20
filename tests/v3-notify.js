/**
 * V3.0 新增能力验证：报名回执与幂等、候补队列透明化、状态消息与未读、审核与补位通知、注销清理。
 * 运行：node tests/v3-notify.js
 */
const { chromium } = require('playwright-core');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const f = url.pathname === '/' ? path.join(root, 'index.html') : path.join(root, decodeURIComponent(url.pathname));
  fs.readFile(f, (e, b) => {
    if (e) { res.statusCode = 404; res.end('not found'); }
    else { res.setHeader('Content-Type', mime[path.extname(f)] || 'application/octet-stream'); res.end(b); }
  });
});

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(6000);
  page.on('dialog', d => d.accept());
  const results = [];
  const check = (name, ok) => {
    results.push([name, !!ok]);
    console.log(name, !!ok);
    if (!ok) throw Error('FAIL ' + name);
  };
  const base = `http://127.0.0.1:${server.address().port}`;
  await page.goto(base);
  await page.click('#link-seed');
  await page.waitForTimeout(100);

  const login = async (u) => {
    await page.locator('.auth-tab[data-tab=login]').click();
    await page.locator('#login-username').fill(u);
    await page.locator('#login-password').fill('123456');
    await page.locator('#form-login button[type=submit]').click();
    await page.waitForTimeout(150);
  };
  const register = async (u, name) => {
    await page.locator('.auth-tab[data-tab=register]').click();
    await page.locator('#reg-username').fill(u);
    await page.locator('#reg-name').fill(name);
    await page.locator('#reg-password').fill('123456');
    await page.locator('#form-register button[type=submit]').click();
    await page.waitForTimeout(150);
  };
  const logout = async () => { await page.locator('#btn-logout').click(); await page.waitForTimeout(120); };

  const local = d => {
    const z = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`;
  };
  const publish = async (title, capacity, cond) => {
    await page.locator('[data-view=publish]').click();
    const start = new Date(Date.now() + 86400000), end = new Date(Date.now() + 90000000), dl = new Date(Date.now() + 3600000);
    await page.locator('#pub-title').fill(title);
    await page.locator('#pub-location').fill('测试地点');
    await page.locator('#pub-start').fill(local(start));
    await page.locator('#pub-end').fill(local(end));
    await page.locator('#pub-deadline').fill(local(dl));
    await page.locator('#pub-capacity').fill(String(capacity));
    await page.locator('#pub-description').fill('V3.0 验证用活动');
    await page.locator('#pub-eligibility').fill(cond || '');
    await page.locator('#form-publish button[type=submit]').click();
    await page.waitForTimeout(120);
  };
  const openDetail = async (title) => {
    await page.locator('[data-view=hall]').click();
    await page.waitForTimeout(80);
    await page.locator('#view-student-hall .card').filter({ hasText: title }).locator('[data-detail]').click();
    await page.waitForTimeout(120);
  };
  const apply = async (no) => {
    await page.locator('#su-no').fill(no);
    await page.locator('#su-phone').fill('13800000000');
    await page.locator('#form-signup button[type=submit]').click();
    await page.waitForTimeout(900);
  };
  const receiptText = () => page.locator('#modal-content').innerText();
  const gotoMine = async () => { await page.locator('#btn-goto-mine').click(); await page.waitForTimeout(150); };
  const badgeText = () => page.locator('#btn-notify').innerText();

  /* ---------- 1. 报名回执与幂等 ---------- */
  await login('teacher');
  await publish('V3幂等与回执', 5, '');
  await logout();
  await login('student');
  await openDetail('V3幂等与回执');
  check('报名表单存在', await page.locator('#form-signup').count() === 1);

  await page.locator('#su-no').fill('001');
  await page.locator('#su-phone').fill('13800000000');
  await page.locator('#form-signup button[type=submit]').click();
  await page.waitForTimeout(60);
  const btnState = await page.locator('#form-signup button[type=submit]').evaluate(b => ({ disabled: b.disabled, text: b.textContent }));
  check('提交中按钮被禁用并提示', btnState.disabled && btnState.text.includes('提交中'));

  // 处理期间再点一次（模拟网络抖动下的重复点击）
  await page.evaluate(() => { const f = document.getElementById('form-signup'); if (f) f.requestSubmit(); });
  await page.waitForTimeout(900);

  const receipt = await receiptText();
  check('提交后显示报名回执', receipt.includes('报名回执'));
  check('回执包含状态与回执号', receipt.includes('已确认参加') && /RQ-[A-Z0-9]+-[A-Z0-9]+/.test(receipt));

  const dupCount = await page.evaluate(() => {
    const regs = JSON.parse(localStorage.getItem('cas_registrations') || '[]');
    const acts = JSON.parse(localStorage.getItem('cas_activities') || '[]');
    const act = acts.find(a => a.title === 'V3幂等与回执');
    const users = JSON.parse(localStorage.getItem('cas_users') || '[]');
    const stu = users.find(u => u.username === 'student');
    return regs.filter(r => r.activityId === act.id && r.studentId === stu.id).length;
  });
  check('重复提交只产生一条报名记录', dupCount === 1);

  await gotoMine();
  check('我的报名显示回执号', (await page.locator('#mine-list').innerText()).includes('回执号'));
  check('我的报名显示已确认参加', (await page.locator('#mine-list').innerText()).includes('已确认参加'));
  check('报名后有未读消息角标', (await badgeText()).includes('消息') && (await badgeText()).includes('1'));

  await page.locator('#btn-notify').click();
  await page.waitForTimeout(150);
  check('消息中心含确认消息', (await page.locator('#modal-content').innerText()).includes('已确认参加'));
  await page.locator('#modal-close').click();
  check('打开消息后角标清除', (await badgeText()).trim() === '消息');

  await openDetail('V3幂等与回执');
  check('已报名活动不再显示报名表单', await page.locator('#form-signup').count() === 0);
  check('详情页展示本人当前状态', (await receiptText()).includes('已确认参加'));
  await page.locator('#modal-close').click();

  /* ---------- 2. 候补位置、补位通知与已读持久化 ---------- */
  await logout();
  await login('teacher');
  await publish('V3候补位置', 1, '');
  await logout();
  await login('student');
  await openDetail('V3候补位置');
  await apply('002');
  check('容量为1时本人已确认', (await receiptText()).includes('已确认参加'));
  await gotoMine();

  await logout();
  await register('student2', '候补学生二');
  await openDetail('V3候补位置');
  await apply('003');
  check('满员后进入候补并显示队列位置', (await receiptText()).includes('候补第 1 位 / 共 1 人'));
  await gotoMine();
  check('我的报名显示候补队列位置', (await page.locator('#mine-list').innerText()).includes('候补第 1 位 / 共 1 人'));

  await logout();
  await login('student');
  await page.locator('[data-view=mine]').click();
  await page.waitForTimeout(100);
  await page.locator('#view-student-mine .card').filter({ hasText: 'V3候补位置' }).locator('[data-cancel]').click();
  await page.waitForTimeout(250);
  check('已确认者取消后队首补位', true);

  await logout();
  await login('student2');
  await page.waitForTimeout(150);
  const unread = await page.evaluate(() => JSON.parse(localStorage.getItem('cas_notifications') || '[]').filter(n => !n.read).length);
  check('补位后学生收到未读消息', unread >= 1);
  check('补位后状态变为已确认', (await page.locator('#mine-list').innerText()).includes('已确认参加'));
  await page.locator('#btn-notify').click();
  await page.waitForTimeout(150);
  const noticeText = await page.locator('#modal-content').innerText();
  check('补位消息说明候补转正', noticeText.includes('转为已确认参加'));
  check('补位消息含活动名称', noticeText.includes('V3候补位置'));
  await page.locator('#modal-close').click();
  await page.reload();
  await page.waitForTimeout(250);
  check('刷新后未读角标保持已读', (await badgeText()).trim() === '消息');
  check('刷新后消息仍可回看', await page.evaluate(() => {
    const n = JSON.parse(localStorage.getItem('cas_notifications') || '[]');
    const users = JSON.parse(localStorage.getItem('cas_users') || '[]');
    const me = users.find(u => u.username === 'student2');
    const mine = n.filter(x => x.userId === me.id);
    return mine.length >= 2 && mine.every(x => x.read === true);
  }));

  /* ---------- 3. 审核结果通知 ---------- */
  await logout();
  await login('teacher');
  await publish('V3审核通知', 5, '需教师确认');
  await logout();
  await login('student');
  await openDetail('V3审核通知');
  await apply('004');
  check('条件活动申请后为待审核', (await receiptText()).includes('待教师审核'));
  await gotoMine();

  await logout();
  await login('teacher');
  await page.locator('[data-view=teacherMine]').click();
  await page.waitForTimeout(100);
  await page.locator('#teacher-list .card').filter({ hasText: 'V3审核通知' }).locator('[data-roster]').click();
  await page.locator('[data-review][data-result=approved]').first().click();
  await page.waitForTimeout(250);
  await page.locator('#modal-close').click();
  await logout();

  await login('student');
  await page.waitForTimeout(150);
  await page.locator('#btn-notify').click();
  await page.waitForTimeout(150);
  check('审核通过生成消息', (await page.locator('#modal-content').innerText()).includes('通过审核'));
  await page.locator('#modal-close').click();

  /* ---------- 4. 注销清理通知 ---------- */
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('cas_notifications') || '[]').length);
  await page.locator('#btn-delete-account').click();
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => {
    const n = JSON.parse(localStorage.getItem('cas_notifications') || '[]');
    const users = JSON.parse(localStorage.getItem('cas_users') || '[]');
    return { total: n.length, users: users.length, hasStudent: users.some(u => u.username === 'student') };
  });
  check('注销后本人消息被清理', before > 0 && after.total < before);
  check('注销后账号被删除', after.hasStudent === false && after.users === 2);

  console.log(JSON.stringify(results));
  await browser.close();
  server.close();
  server.closeAllConnections();
  process.exit(0);
})().catch(e => {
  console.error(e.stack);
  server.close();
  server.closeAllConnections();
  process.exit(1);
});
