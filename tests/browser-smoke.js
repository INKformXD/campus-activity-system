const { chromium } = require('playwright-core');
const http = require('http'), fs=require('fs'), path=require('path');
const root=path.resolve(__dirname,'..');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://localhost'); let f=url.pathname==='/'?path.join(root,'index.html'):path.join(root,decodeURIComponent(url.pathname)); fs.readFile(f,(e,b)=>{if(e){res.statusCode=404;res.end('not found')}else{res.setHeader('Content-Type',mime[path.extname(f)]||'application/octet-stream');res.end(b)}})});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});const page=await browser.newPage();const results=[];const check=(n,x)=>{results.push([n,!!x]);console.log(n,!!x);if(!x)throw Error('FAIL '+n)};page.setDefaultTimeout(5000);const base=`http://127.0.0.1:${server.address().port}`;
await page.goto(base);await page.click('#link-seed');await page.waitForTimeout(100);
const login=async(u)=>{await page.locator('.auth-tab[data-tab=login]').click();await page.locator('#login-username').fill(u);await page.locator('#login-password').fill('123456');await page.locator('#form-login button[type=submit]').click();await page.waitForTimeout(100)};
const logout=async()=>{await page.locator('#btn-logout').click();await page.waitForTimeout(50)};
await login('teacher');
await page.click('[data-view="publish"]');
const dt=new Date(Date.now()+86400000), end=new Date(Date.now()+90000000), dl=new Date(Date.now()+3600000);const local=d=>{const z=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`};
const makeAct=async(title,cond)=>{await page.locator('#pub-title').fill(title);await page.locator('#pub-location').fill('测试地点');await page.locator('#pub-start').fill(local(dt));await page.locator('#pub-end').fill(local(end));await page.locator('#pub-deadline').fill(local(dl));await page.locator('#pub-capacity').fill('1');await page.locator('#pub-description').fill('测试');await page.locator('#pub-eligibility').fill(cond);await page.locator('#form-publish button[type=submit]').click();await page.waitForTimeout(80)};
await makeAct('条件审核测试','需教师确认');
await page.locator('#btn-logout').click();await login('student');
const apply=async(title,no)=>{await page.locator('#view-student-hall .card').filter({hasText:title}).locator('[data-detail]').click();await page.waitForTimeout(30);await page.locator('#su-no').fill(no);await page.locator('#su-phone').fill('13800000000');await page.locator('#form-signup button[type=submit]').click();await page.waitForTimeout(800);await page.locator('#btn-goto-mine').click();await page.waitForTimeout(120)};
await apply('条件审核测试','001');check('条件活动申请待审核', (await page.locator('#mine-list').innerText()).includes('待教师审核'));
await page.locator('#btn-logout').click();await page.locator('.auth-tab[data-tab="register"]').click();await page.locator('#reg-username').fill('student2');await page.locator('#reg-name').fill('测试学生2');await page.locator('#reg-password').fill('123456');await page.locator('#form-register button[type=submit]').click();await page.waitForTimeout(70);
// Publish a full-capacity waitlist event for two students.
await logout();await login('teacher');await page.locator('.card').filter({hasText:'条件审核测试'}).locator('[data-roster]').click();await page.locator('[data-review][data-result=approved]').click();check('教师审核通过',await page.locator('#modal').innerText().then(t=>t.includes('已确认')));await page.locator('#modal-close').click();await page.locator('[data-view=publish]').click();await makeAct('候补与补位测试','');await logout();await login('student');await apply('候补与补位测试','002');check('首位学生确认', (await page.locator('#mine-list').innerText()).includes('已确认参加'));
await logout();await login('student2');await apply('候补与补位测试','003');check('满员加入候补', (await page.locator('#mine-list').innerText()).includes('候补第 1 位'));
await logout();await page.locator('.auth-tab[data-tab=register]').click();await page.locator('#reg-username').fill('student3');await page.locator('#reg-name').fill('测试学生3');await page.locator('#reg-password').fill('123456');await page.locator('#form-register button[type=submit]').click();await page.waitForTimeout(60);await apply('候补与补位测试','004');check('候补按FIFO显示第二位',(await page.locator('#view-student-mine').innerText()).includes('候补第 2 位'));await logout();await login('teacher');await page.locator('.card').filter({hasText:'候补与补位测试'}).locator('[data-roster]').click();await page.locator('[data-review]').first().count().then(n=>{}).catch(()=>{}); // roster usable
check('教师可看报名名单',await page.locator('#modal').innerText().then(t=>t.includes('候补队列')));
await page.locator('#modal-close').click();await logout();await login('student');await page.locator('[data-view="mine"]').click();await page.locator('#view-student-mine .card').filter({hasText:'候补与补位测试'}).locator('[data-cancel]').click();await page.waitForTimeout(100);
await logout();await login('student2');await page.locator('[data-view="mine"]').click();check('取消后FIFO队首补位',(await page.locator('#view-student-mine .card').filter({hasText:'候补与补位测试'}).innerText()).includes('已确认参加'));await page.locator('#view-student-mine .card').filter({hasText:'候补与补位测试'}).locator('[data-cancel]').click();await logout();await login('student3');await page.locator('[data-view=mine]').click();check('队首再次取消后第二位补位',(await page.locator('#view-student-mine .card').filter({hasText:'候补与补位测试'}).innerText()).includes('已确认参加'));
await logout();await login('student');await apply('2026 年秋季校园招聘会','004');check('V1无条件活动直接确认',(await page.locator('#view-student-mine').innerText()).includes('已确认参加'));await page.locator('#view-student-mine .card').filter({hasText:'2026 年秋季校园招聘会'}).locator('[data-cancel]').click();check('V1截止前取消报名',!(await page.locator('#view-student-mine').innerText()).includes('2026 年秋季校园招聘会'));await logout();await login('teacher');let tc=page.locator('#view-teacher-mine .card').filter({hasText:'候补与补位测试'});await tc.locator('[data-toggle]').click();check('教师关闭活动', (await tc.innerText()).includes('重新开放报名'));await tc.locator('[data-toggle]').click();check('教师重新开放活动',(await tc.innerText()).includes('关闭报名'));
console.log(JSON.stringify(results));await browser.close();server.close();server.closeAllConnections();process.exit(0);})().catch(e=>{console.error(e.stack);process.exitCode=1;server.close();server.closeAllConnections();process.exit(1)});









