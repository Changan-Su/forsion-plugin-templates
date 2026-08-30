/**
 * 模板库 note-templates 自检:宿主同款 new Function('ctx', src) 求值 main.js + DOM 垫片 + 冻钟 + 内存 vault。
 * 覆盖 SPEC §7 全 21 项:
 *   20260814 八项(贡献点齐全+反向断言 / disposer / 纯函数逐向量 / XSS / 数据契约往返 / 旧宿主 / 词表键集合 / 切 en 不重挂)
 * + 复核补的两洞(zh→en→zh 逐字往返 / 切语言不丢搜索框·选中项·滚动位置)
 * + 本批 BRIEF 增量五(v4 路由自检:blocks/order getter 探针 + 块寻址口被调即红 + 令牌现取 / 活动页写保护)
 * + 本 SPEC 追加八项(三态读走不同分支 / 列出与使用之间被删 / 同名链 A 4.md / 读回不一致 /
 *   {{title}} 用改名后的 basename / 新建路线不消毒 / 库根防呆 / 零定时器)
 * 跑法:node check.mjs
 */
process.env.TZ = 'America/New_York' // ⚠️ 必须是第一条语句(import 会被提升,但它们不碰 Date)
import { readFileSync } from 'node:fs'
import { strict as A } from 'node:assert'

const src = readFileSync(new URL('./main.js', import.meta.url), 'utf8')
const tick = () => new Promise((r) => setTimeout(r, 0))
const settle = async (n = 8) => {
  for (let i = 0; i < n; i++) await tick()
}
let PASS = 0
const ok = (cond, msg) => {
  A.ok(cond, msg)
  PASS++
}
const eq = (a, b, msg) => {
  A.equal(a, b, msg)
  PASS++
}
const deq = (a, b, msg) => {
  A.deepEqual(a, b, msg)
  PASS++
}
const section = (n) => console.log(`\n── ${n} ──`)

// ═══════════════════════════════════════════════════════════════════════════════
// [21] 静态纪律 —— 零定时器 / 零 HTML 注入面 / 零裸 new Date()
// ═══════════════════════════════════════════════════════════════════════════════
section('[21] 静态纪律')
ok(!/innerHTML/.test(src), 'main.js 零 innerHTML(XSS 面归零)')
ok(!/outerHTML|insertAdjacentHTML|document\.write/.test(src), 'main.js 零其它 HTML 字符串注入面')
ok(!/setInterval/.test(src), 'main.js 零 setInterval(SPEC §2.1:任何情况下都不轮询)')
ok(!/setTimeout/.test(src), 'main.js 零 setTimeout(连一次性 UI 都不用,disposer 因此没有定时器要收)')
ok(!/requestAnimationFrame|requestIdleCallback/.test(src), 'main.js 零 rAF/idle 排程')
ok(!/new Date\(\)/.test(src), '「现在」一律 Date.now(),禁裸 new Date()')
ok(!/color:\s*#fff/i.test(src), 'CSS 不许写死白字(强调色上的字用 var(--on-accent))')
ok(!/--text-secondary/.test(src), '--text-secondary 这个 token 不存在,次级文字用 --text-muted')
ok(!/vaultRoot|listFiles|searchVault/.test(src), '本插件不调 vaultRoot / listFiles / searchVault(§4.7)')
ok(!/insertBlockAfter|deleteBlock|setFmExtra|mountBlocks|requestFocus|consumeFocus/.test(src), 'main.js 全文没有任何块寻址口(v4 上恒不可用)')
ok(!/\.blocks\b|\.order\b|getActivePageText/.test(src), 'main.js 全文不读 page.blocks / page.order / getActivePageText')
{
  // ASI 陷阱:以 ( [ 开头的行会被粘到上一句
  const lines = src.split('\n')
  const asi = [...lines.keys()]
    .filter((i) => {
      if (!/^\s*[([]/.test(lines[i])) return false
      let p = i - 1
      while (p >= 0 && !lines[p].trim()) p--
      return p >= 0 && /[)\]'"`\w]\s*$/.test(lines[p])
    })
    .map((i) => i + 1)
  eq(asi.length, 0, `以 ( [ 开头的行会被 ASI 粘到上一句:第 ${asi.join(',')} 行`)
}

// ═══════════════════════════════════════════════════════════════════════════════
// 冻钟:TZ 硬断言(不生效就红 —— 否则两条 DST 向量毫无意义)
// ═══════════════════════════════════════════════════════════════════════════════
const NOW = Date.UTC(2026, 7, 21, 19, 4, 5) // = 2026-08-21 15:04:05 EDT(周五)
eq(new Date(NOW).getHours(), 15, 'TZ=America/New_York 未生效,DST 向量无意义')
eq(new Date(NOW).getDay(), 5, '冻钟落在周五')
Date.now = () => NOW
const local = (y, m, d, h = 0, mi = 0, s = 0) => new Date(y, m - 1, d, h, mi, s, 0)

// ═══════════════════════════════════════════════════════════════════════════════
// DOM 垫片
// ═══════════════════════════════════════════════════════════════════════════════
function mkText(t) {
  const n = { tag: '#text', children: [], attrs: {}, listeners: {}, appendChild() {}, setAttribute() {}, addEventListener() {} }
  let v = String(t)
  Object.defineProperty(n, 'textContent', { get: () => v, set: (x) => { v = String(x) } })
  return n
}
function mkEl(tag) {
  const el = {
    tag,
    children: [],
    attrs: {},
    listeners: {},
    parentElement: null,
    isConnected: true,
    className: '',
    disabled: false,
    value: '',
    scrollTop: 0,
    _own: '',
    style: { setProperty() {}, removeProperty() {} },
    focus() {},
    blur() {},
    closest: () => null,
    setAttribute(k, v) { el.attrs[k] = String(v) },
    getAttribute(k) { return k in el.attrs ? el.attrs[k] : null },
    addEventListener(t, f) { (el.listeners[t] || (el.listeners[t] = [])).push(f) },
    removeEventListener(t, f) { if (el.listeners[t]) el.listeners[t] = el.listeners[t].filter((x) => x !== f) },
    remove() {
      const p = el.parentElement
      if (p) p.children = p.children.filter((x) => x !== el)
      el.parentElement = null
      el.isConnected = false
    },
  }
  el.classList = {
    add: (...cs) => { const s = new Set(el.className.split(/\s+/).filter(Boolean)); cs.forEach((c) => s.add(c)); el.className = [...s].join(' ') },
    remove: (...cs) => { el.className = el.className.split(/\s+/).filter((c) => c && !cs.includes(c)).join(' ') },
    contains: (c) => el.className.split(/\s+/).includes(c),
  }
  el.appendChild = (c) => {
    if (c && c.tag === '#frag') { for (const k of c.children.slice()) el.appendChild(k); return c }
    el.children.push(c)
    if (c && typeof c === 'object') c.parentElement = el
    return c
  }
  Object.defineProperty(el, 'textContent', {
    get: () => el._own + el.children.map((c) => (c && c.textContent) || '').join(''),
    // 浏览器语义:清空内容会让滚动位置归零 —— 这样「重画前后回填 scrollTop」才是真被测到的
    set: (v) => { el.children.length = 0; el._own = String(v); el.scrollTop = 0 },
  })
  return el
}
const docListeners = {}
globalThis.document = {
  createElement: mkEl,
  createTextNode: mkText,
  createDocumentFragment: () => mkEl('#frag'),
  addEventListener(t, f) { (docListeners[t] || (docListeners[t] = [])).push(f) },
  removeEventListener(t, f) { if (docListeners[t]) docListeners[t] = docListeners[t].filter((x) => x !== f) },
  body: mkEl('body'),
}
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '', color: 'rgb(40,40,40)' })
const findAll = (node, pred) => {
  const out = []
  const walk = (n) => { for (const c of n.children || []) { if (pred(c)) out.push(c); walk(c) } }
  walk(node)
  return out
}
const byTag = (node, tag) => findAll(node, (c) => c.tag === tag)
const byCls = (node, cls) => findAll(node, (c) => String(c.className || '').split(/\s+/).includes(cls))
const anyAttrLike = (node, re) => findAll(node, (c) => Object.keys(c.attrs || {}).some((k) => re.test(k)))
const fire = (el, type, ev = {}) => { for (const f of (el.listeners[type] || []).slice()) f(ev) }
const fireDoc = (type, ev = {}) => { for (const f of (docListeners[type] || []).slice()) f(ev) }
/** 可见文本:跳过 <style>(CSS 不是界面文案,不该混进 zh→en→zh 逐字比较) */
const visibleText = (n) => {
  if (!n || n.tag === 'style') return ''
  return (n._own || '') + (n.children || []).map(visibleText).join('')
}

// ═══════════════════════════════════════════════════════════════════════════════
// localStorage 垫片
// ═══════════════════════════════════════════════════════════════════════════════
let _ls = new Map()
globalThis.localStorage = {
  getItem: (k) => (_ls.has(k) ? _ls.get(k) : null),
  setItem: (k, v) => _ls.set(k, String(v)),
  removeItem: (k) => _ls.delete(k),
}
const setSetting = (k, v) => (v == null ? _ls.delete(`plugin.note-templates.${k}`) : _ls.set(`plugin.note-templates.${k}`, String(v)))

// ═══════════════════════════════════════════════════════════════════════════════
// 宿主 mock 工厂
// ═══════════════════════════════════════════════════════════════════════════════
function makeHost(opts = {}) {
  const H = {
    V: new Map(Object.entries(opts.files || {})),
    writes: [],
    notices: [],
    activity: [],
    opened: [],
    loadedPages: [],
    prompts: [],
    promptQueue: (opts.prompts || []).slice(),
    reg: { views: [], commands: [], slash: [], creators: [], settings: [], listSources: [], forbidden: [] },
    watchOff: 0,
    localeOff: 0,
    pageOff: 0,
    localeCb: null,
    pageCb: null,
    pageCalls: 0,
    blockProbe: 0,
    mountCount: 0,
    data: opts.data === undefined ? null : opts.data,
    failRead: opts.failRead || null, // (p) => boolean
    mangle: opts.mangle || null, // (p, text) => storedText
    page: opts.page === undefined ? { path: 'notes/正在写.md', model: 'text' } : opts.page,
    activePage: opts.activePage === undefined ? null : opts.activePage,
  }
  const forbid = (name) => (...a) => { H.reg.forbidden.push(name); throw new Error(`禁止调用 ${name}`) }
  const app = {
    notify: (m) => H.notices.push({ m, o: null }),
    openFile: (p) => H.opened.push(p),
    ...(opts.noLoadPage ? {} : { loadPage: (p) => H.loadedPages.push(p) }),
    readFile: async (p) => {
      if (H.failRead && H.failRead(p)) throw new Error('EBUSY (mock)')
      return H.V.has(p) ? H.V.get(p) : null
    },
    writeFile: async (p, text) => {
      H.writes.push(p)
      H.V.set(p, H.mangle ? H.mangle(p, String(text)) : String(text))
    },
    prompt: async (title, initial, o) => {
      H.prompts.push({ title, initial, label: o && o.label })
      return H.promptQueue.length ? H.promptQueue.shift() : null
    },
    getActivePage: () => H.activePage,
    getPage: () => {
      H.pageCalls++
      if (!H.page) return { token: `tok-${H.pageCalls}`, path: null, status: 'idle', text: '', model: 'text', blocks: {}, order: [], fmExtra: '' }
      const snap = { token: `tok-${H.pageCalls}`, path: H.page.path, status: 'ready', text: H.page.text || '# 正在写\n\n正文', model: H.page.model || 'text', fmExtra: '' }
      // ⚠️ getter 探针:v4 上正文不在 blocks/order 里,插件读到就红
      Object.defineProperty(snap, 'blocks', { get: () => { H.blockProbe++; return {} }, enumerable: true })
      Object.defineProperty(snap, 'order', { get: () => { H.blockProbe++; return [] }, enumerable: true })
      return snap
    },
    subscribePage: (cb) => { H.pageCb = cb; return () => { H.pageOff++ } },
    insertMarkdown: (token, md, where) => {
      H.inserted = H.inserted || []
      H.inserted.push({ token, md, where })
      return opts.insertFails ? false : true
    },
    // v4 上宿主诚实拒绝的那批 —— 这里做成「被调即红」
    insertBlockAfter: forbid('insertBlockAfter'),
    deleteBlock: forbid('deleteBlock'),
    setFmExtra: forbid('setFmExtra'),
    undo: forbid('undo'),
    redo: forbid('redo'),
    requestFocus: forbid('requestFocus'),
    consumeFocus: forbid('consumeFocus'),
    mountBlocks: forbid('mountBlocks'),
    getActivePageText: forbid('getActivePageText'),
    workFolder: () => opts.workFolder || '模板库',
    listPages: opts.noListPages ? undefined : async () => (opts.pages !== undefined ? opts.pages : [...H.V.keys()].filter((p) => /\.md$/i.test(p))),
    watchFile: (p, cb) => { H.watched = H.watched || new Map(); H.watched.set(p, cb); return () => { H.watchOff++ } },
  }
  if (opts.noListPages) delete app.listPages
  if (opts.noWatch) delete app.watchFile
  const ctx = {
    app,
    registerView: (v) => { const wrapped = { ...v, mount: (el) => { H.mountCount++; return v.mount(el) } }; H.reg.views.push(wrapped) },
    registerCommand: (c) => H.reg.commands.push(c),
    registerSlashItem: (s) => H.reg.slash.push(s),
    registerListSource: (x) => H.reg.listSources.push(x), // 统一左栏数据源(宿主 2026-08-25+)
    registerFileCreator: (c) => H.reg.creators.push(c),
    registerSetting: (s) => H.reg.settings.push(s),
    registerStatusItem: forbid('registerStatusItem'),
    registerEditorExtension: forbid('registerEditorExtension'),
    registerSettingsView: forbid('registerSettingsView'),
    registerFileType: forbid('registerFileType'),
    registerEmbedRenderer: forbid('registerEmbedRenderer'),
    registerTheme: forbid('registerTheme'),
    registerPropertyType: forbid('registerPropertyType'),
    registerPanel: forbid('registerPanel'),
    openView: (id) => { H.openedView = id },
    notify: (m, o) => H.notices.push({ m, o }),
    activity: { log: (e, d) => H.activity.push({ e, d }) },
    achievements: { registerSeries: forbid('registerSeries'), track: forbid('track') },
    getLocale: () => H.locale || 'zh',
    subscribeLocale: (cb) => { H.localeCb = cb; return () => { H.localeOff++ } },
    loadData: opts.noData ? undefined : async () => H.data,
    saveData: opts.noData ? undefined : async (v) => { H.data = JSON.parse(JSON.stringify(v)) },
  }
  if (opts.noData) { delete ctx.loadData; delete ctx.saveData }
  H.ctx = ctx
  return H
}

async function boot(opts = {}) {
  _ls = new Map()
  for (const k of Object.keys(opts.settings || {})) setSetting(k, opts.settings[k])
  const H = makeHost(opts)
  globalThis.__NOTE_TEMPLATES_TEST__ = {}
  H.dispose = new Function('ctx', src)(H.ctx)
  H.T = globalThis.__NOTE_TEMPLATES_TEST__
  await H.T.ready
  await settle()
  return H
}

const FILES = {
  'Templates/周会.md': '---\ntags: 会议\n---\n# {{title}}\n\n## 议程\n\n- \n\n## 决议  两空格\n',
  'Templates/读书笔记.md': '# {{title}}\n\n> 读于 {{date}}\n\n## 摘要\n',
  'Templates/会议/客户拜访.md': '# 客户拜访 {{date:YYYY年MM月DD日}}\n\n## 到场\n',
  'notes/日记.md': '# 日记\n',
  'notes/周会.md': '# 已经有一篇周会\n',
}

// ═══════════════════════════════════════════════════════════════════════════════
// [1] 贡献点齐全 + 反向断言(不注册的那六项一次都没被调用)
// ═══════════════════════════════════════════════════════════════════════════════
section('[1] 贡献点齐全 + 反向断言')
const H0 = await boot({ files: FILES })
const T = H0.T
ok(H0.reg.views.find((v) => v.id === 'library' && typeof v.mount === 'function'), '应注册 library 视图')
eq(H0.reg.views.length, 1, '只有一个视图')
eq(H0.reg.views[0].singleton, true, 'library 是 singleton')
for (const id of ['note-templates-open', 'note-templates-new']) {
  ok(H0.reg.commands.find((c) => c.id === id && typeof c.run === 'function'), `应注册 ${id} 命令`)
}
eq(H0.reg.commands.length, 2, '只有两条命令')
{
  const s = H0.reg.slash.find((x) => x.id === 'note-templates-insert')
  ok(s, '应注册 note-templates-insert 斜杠项')
  eq(s.icon, 'template', '斜杠图标用宿主词表名 template,不许塞 emoji')
  eq(typeof s.run, 'function', '斜杠项是动态 run(不是静态 scaffold)')
  eq(s.scaffold, undefined, '斜杠项没有 scaffold')
  ok(/template/.test(s.keywords) && /模板/.test(s.keywords), '斜杠 keywords 中英双语')
}
{
  const c = H0.reg.creators.find((x) => x.id === 'note-templates-new-from')
  ok(c, '应注册 note-templates-new-from 文件创建器')
  eq(c.icon, 'template', '创建器图标用词表名')
  eq(typeof c.run, 'function', '创建器 run 是函数')
}
{
  const f = H0.reg.settings.find((x) => x.key === 'folder')
  ok(f, '应声明 folder 设置')
  eq(f.type, 'text')
  eq(f.default, 'Templates', 'folder 默认值钉死 Templates(中英文界面都是它)')
  const a = H0.reg.settings.find((x) => x.key === 'askOnConflict')
  ok(a, '应声明 askOnConflict 设置')
  eq(a.type, 'boolean')
  eq(a.default, false, '默认不问:自动另存新版')
  eq(H0.reg.settings.length, 2, '只有两条设置(workFolder 由宿主自动给,插件不重注册)')
}
deq(H0.reg.forbidden, [], '反向断言:registerStatusItem / EditorExtension / SettingsView / FileType / EmbedRenderer / Theme / PropertyType / Panel / achievements 一次都没被调用')
for (const k of ['formatDate', 'shiftDate', 'parseVar', 'renderTemplate', 'splitFrontmatter', 'stripMarkers', 'sanitizeForInsert', 'candidatePath', 'normalizeFolder', 'sanitizeFileName', 'resolveTarget', 'isUnderFolder', 'buildForInsert', 'renderPreview']) {
  eq(typeof T[k], 'function', `钩子应暴露 ${k}`)
}

// ═══════════════════════════════════════════════════════════════════════════════
// [3] 核心纯函数逐向量(§5.1 ~ §5.12,每一行表格都断言)
// ═══════════════════════════════════════════════════════════════════════════════
section('[3] 纯函数逐向量')
// §5.1 formatDate
eq(T.formatDate(local(2026, 8, 21, 15, 4, 5), 'YYYY-MM-DD'), '2026-08-21')
eq(T.formatDate(local(2026, 8, 21, 15, 4, 5), 'YYYY年MM月DD日 HH:mm:ss'), '2026年08月21日 15:04:05')
eq(T.formatDate(local(2026, 8, 21, 15, 4, 5), 'DD/MM/YYYY'), '21/08/2026')
eq(T.formatDate(local(2026, 1, 2, 3, 4, 5), 'YYYYMMDD'), '20260102', '补零')
eq(T.formatDate(local(2026, 8, 21, 15, 4, 5), 'HH:mm'), '15:04')
// §5.2 shiftDate —— 两条 DST 向量是承重的
const ymd = (d) => T.formatDate(d, 'YYYY-MM-DD')
eq(ymd(T.shiftDate(local(2026, 11, 1), 1, 'd')), '2026-11-02', '秋退当天 +1d(裸 +86400000ms 会停在 11-01T23:00)')
eq(ymd(T.shiftDate(local(2026, 3, 8), -1, 'd')), '2026-03-07', '春进当天 -1d')
eq(ymd(T.shiftDate(local(2026, 1, 31), 1, 'm')), '2026-02-28', '月位移钳月末,不是 3-03')
eq(ymd(T.shiftDate(local(2024, 2, 29), 1, 'y')), '2025-02-28', '闰日钳位')
eq(ymd(T.shiftDate(local(2026, 8, 21), 2, 'w')), '2026-09-04', '周 = 7 天')
eq(ymd(T.shiftDate(local(2026, 8, 21), 0, 'd')), '2026-08-21', '零位移恒等')
eq(T.shiftDate(local(2026, 11, 1), 1, 'd').getHours(), 12, '返回的 Date 时分秒恒为正午')
{
  // 反证:裸毫秒加法在秋退日确实翻车 —— 正午锚定不是形式主义
  const naive = new Date(local(2026, 11, 1).getTime() + 86400000)
  eq(ymd(naive), '2026-11-01', '反证:裸 +86400000ms 在秋退日日期原地不动')
}
// §5.3 parseVar
deq(T.parseVar('date'), { kind: 'date', off: null, fmt: null })
deq(T.parseVar('date:YYYY/MM'), { kind: 'date', off: null, fmt: 'YYYY/MM' })
deq(T.parseVar('date:+1d:YYYY-MM-DD'), { kind: 'date', off: { n: 1, unit: 'd' }, fmt: 'YYYY-MM-DD' })
deq(T.parseVar('date:-2w'), { kind: 'date', off: { n: -2, unit: 'w' }, fmt: null })
deq(T.parseVar('time:HH:mm'), { kind: 'time', off: null, fmt: 'HH:mm' }, '格式里的冒号不丢')
deq(T.parseVar('date:+1d:HH:mm'), { kind: 'date', off: { n: 1, unit: 'd' }, fmt: 'HH:mm' })
deq(T.parseVar('title'), { kind: 'title', off: null, fmt: null })
deq(T.parseVar('cursor'), { kind: 'cursor', off: null, fmt: null })
eq(T.parseVar('foo'), null, '未知变量 → null')
eq(T.parseVar('date:+1x:YYYY'), null, '未知单位 → 整条不认,原样保留')
eq(T.parseVar(''), null, '空 → null')
// §5.4 renderTemplate
const R = (raw, title) => T.renderTemplate(raw, { title, now: NOW })
eq(R('# {{title}}\n{{date}} {{time}}', '周会'), '# 周会\n2026-08-21 15:04', '三个基本变量')
eq(R('明天:{{date:+1d:YYYY-MM-DD}}', ''), '明天:2026-08-22', '偏移 + 格式')
eq(R('{{unknown}} 保留 {{}} 也保留', ''), '{{unknown}} 保留 {{}} 也保留', '未知原样')
eq(R('{{title}}', '{{date}}'), '{{date}}', '**单趟证明**:替进去的值不许被再扫一遍')
eq(R('a{{cursor}}b', ''), 'ab', 'cursor 删除')
eq(R('{{date:+1d:YYYY-MM-DD HH:mm}}', ''), '2026-08-22 15:04', '日期位移、时分取真实 now')
eq(R('{{date:-1w:YYYY年MM月DD日}}', ''), '2026年08月14日', '负偏移 + 中文格式')
eq(R('{{time:+1d}}', ''), '15:04', '偏移对 time 合法,只动 Y/M/D')
// §5.5 splitFrontmatter
deq(T.splitFrontmatter('---\ntags: a\n---\n# x'), { fm: '---\ntags: a\n---', body: '# x' })
deq(T.splitFrontmatter('# x'), { fm: null, body: '# x' })
deq(T.splitFrontmatter('---\n没有闭合\n# x'), { fm: null, body: '---\n没有闭合\n# x' })
deq(T.splitFrontmatter('\n---\na\n---\n'), { fm: null, body: '\n---\na\n---\n' }, '不在第 0 字节')
deq(T.splitFrontmatter('---\n---\nx'), { fm: '---\n---', body: 'x' }, '空 frontmatter')
// §5.6 stripMarkers
eq(T.stripMarkers('<!-- a 1 -->\n# 标题\n\n<!-- a 2 -->\n正文'), '# 标题\n\n正文')
eq(T.stripMarkers('a<!-- /a 9 -->b'), 'ab')
eq(T.stripMarkers('<!-- 普通注释 -->\n正文'), '<!-- 普通注释 -->\n正文', '不是 a <id> 形态,不动')
eq(T.stripMarkers('<!-- a k1 -->内容<!-- /a k1 -->'), '内容', '闭合锚成对')
// §5.7 sanitizeForInsert
eq(T.sanitizeForInsert('| a   | b |'), '| a | b |', '表格对齐填充压掉')
eq(T.sanitizeForInsert('  - 缩进项  有  空格'), '  - 缩进项 有 空格', '行首缩进保留,行内压掉')
eq(T.sanitizeForInsert('```\ncode   with   spaces\n```'), '```\ncode   with   spaces\n```', '围栏内不动')
eq(T.sanitizeForInsert('`a   b` 外面   压掉'), '`a   b` 外面 压掉', '行内 code span 不动')
eq(T.sanitizeForInsert('行尾两空格  \n下一行'), '行尾两空格\n下一行', '行尾空白清掉')
eq(T.sanitizeForInsert('\r\n\n# x\n\n\n'), '# x', 'CRLF 归一 + 首尾空行清掉')
// §5.8 candidatePath
eq(T.candidatePath('A/笔记.md', 2), 'A/笔记 2.md')
eq(T.candidatePath('笔记.md', 3), '笔记 3.md')
eq(T.candidatePath('A/会议 记录.md', 2), 'A/会议 记录 2.md')
eq(T.candidatePath('A/x.spec.md', 7), 'A/x.spec 7.md', '只切最后一个 .md')
// §5.9 normalizeFolder / isUnderFolder
deq(T.normalizeFolder('  Templates/  ', 'Templates'), { folder: 'Templates', refused: false })
deq(T.normalizeFolder('', 'Templates'), { folder: 'Templates', refused: true }, '库根防呆')
deq(T.normalizeFolder('/', 'Templates'), { folder: 'Templates', refused: true })
deq(T.normalizeFolder('.', 'Templates'), { folder: 'Templates', refused: true })
deq(T.normalizeFolder('./', 'Templates'), { folder: 'Templates', refused: true })
deq(T.normalizeFolder('../x', 'Templates'), { folder: 'Templates', refused: true })
deq(T.normalizeFolder('a/../..', 'Templates'), { folder: 'Templates', refused: true })
deq(T.normalizeFolder('C:\\x', 'Templates'), { folder: 'Templates', refused: true }, '盘符')
deq(T.normalizeFolder('我的模板/子集', 'Templates'), { folder: '我的模板/子集', refused: false })
eq(T.isUnderFolder('templates/周会.md', 'Templates'), true, '大小写不敏感 —— 内置 /^templates\\//i 建的库也认')
eq(T.isUnderFolder('Templates/会议/客户.md', 'Templates'), true, '含子文件夹')
eq(T.isUnderFolder('Templates.md', 'Templates'), false, '必须有 /')
eq(T.isUnderFolder('MyTemplates/a.md', 'Templates'), false, '必须是前缀段')
eq(T.isUnderFolder('a.b+c/x.md', 'a.b+c'), true, '正则元字符已转义')
// §5.10 sanitizeFileName
eq(T.sanitizeFileName('会议/纪要'), '会议纪要')
eq(T.sanitizeFileName('  .hidden  '), 'hidden')
eq(T.sanitizeFileName('a\u0000b*c?'), 'abc')
eq(T.sanitizeFileName(''), '')
eq(T.sanitizeFileName('   '), '')
eq(T.sanitizeFileName('...'), '')
eq(T.sanitizeFileName('x'.repeat(200)).length, 120, '截断到 120')
// §5.11 resolveTarget
eq(T.resolveTarget('周会', '模板库'), '模板库/周会.md')
eq(T.resolveTarget('周会.md', '模板库'), '模板库/周会.md', '不重复补后缀')
eq(T.resolveTarget('A/B/周会', '模板库'), 'A/B/周会.md', '带 / → 库根相对')
eq(T.resolveTarget('/周会', '模板库'), '周会.md')
eq(T.resolveTarget('周会', ''), '周会.md', 'base 为库根')
eq(T.resolveTarget('../逃逸', '模板库'), null)
eq(T.resolveTarget('   ', '模板库'), null)
eq(T.resolveTarget('a/../b', '模板库'), null, '中段 .. 也拒')
// §5.12 buildForInsert
eq(T.buildForInsert('---\na: 1\n---\n# {{title}}\n<!-- a 3 -->\n正文  两空格', 'notes/周会.md'), '# 周会\n正文 两空格', '四步全走通')
eq(T.buildForInsert('# x', null), '# x', '无 frontmatter / 无标题')
eq(T.buildForInsert('{{cursor}}## 小节', 'a.md'), '## 小节', 'cursor 删除')

// ═══════════════════════════════════════════════════════════════════════════════
// [4] XSS —— renderPreview 零注入面
// ═══════════════════════════════════════════════════════════════════════════════
section('[4] XSS')
for (const evil of ['<img src=x onerror=alert(1)>', '</div><script>alert(1)</script>', 'javascript:alert(1)', '# <svg/onload=alert(1)>', '> <iframe src=javascript:alert(1)>']) {
  const box = mkEl('div')
  T.renderPreview(box, evil)
  eq(byTag(box, 'img').length, 0, `无 img 节点:${evil.slice(0, 20)}`)
  eq(byTag(box, 'script').length, 0, '无 script 节点')
  eq(byTag(box, 'svg').length + byTag(box, 'iframe').length, 0, '无 svg / iframe 节点')
  eq(anyAttrLike(box, /^on/i).length, 0, '没有任何 on* 属性')
  ok(box.textContent.includes(evil.replace(/^#\s+/, '').replace(/^>\s+/, '')), '恶意串以 textContent 原样出现')
}

// ═══════════════════════════════════════════════════════════════════════════════
// [7] 双语词表两侧键集合相等
// ═══════════════════════════════════════════════════════════════════════════════
section('[7] 双语词表')
{
  const zh = Object.keys(T.MSG.zh).sort()
  const en = Object.keys(T.MSG.en).sort()
  deq(zh.filter((k) => !en.includes(k)), [], 'zh 有而 en 没有的键')
  deq(en.filter((k) => !zh.includes(k)), [], 'en 有而 zh 没有的键')
  eq(zh.length, en.length, '两侧键数相等')
  for (const k of ['listSep', 'appName', 'viewTitle', 'cmdOpen', 'cmdNew', 'slashLabel', 'slashHint', 'creatorLabel', 'settingFolder', 'settingFolderDesc', 'settingAsk', 'settingAskDesc', 'recentHeading', 'listHeading', 'searchPlaceholder', 'countLabel', 'btnRescan', 'btnNewTemplate', 'btnCreate', 'btnInsert', 'previewTitle', 'empty', 'emptyHint', 'noEnum', 'noActivePage', 'hostTooOld', 'pickerTitle', 'pickerPlaceholder', 'pickerEmpty', 'promptNewTitle', 'promptNewLabel', 'promptTplTitle', 'createdOk', 'createdRenamed', 'insertedOk', 'errTplGone', 'errReadTpl', 'errProbe', 'errWrite', 'errVerify', 'errInsert', 'errNoName', 'errBadPath', 'errTooMany', 'errActivePage', 'warnRootFolder', 'warnTooBroad']) {
    ok(k in T.MSG.zh && k in T.MSG.en, `SPEC §6 点名的键 ${k} 两侧都在`)
  }
  // 英文侧不许残留中文;列表分隔符按语言取
  const cjk = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/
  for (const k of Object.keys(T.MSG.en)) {
    ok(!cjk.test(T.MSG.en[k]), `en.${k} 不含中文/中文标点:${T.MSG.en[k]}`)
  }
  eq(T.MSG.zh.listSep, '、')
  eq(T.MSG.en.listSep, ', ', '英文句里不许出现中文顿号')
  ok(T.MSG.en.countLabel.includes('{c}') && !/\bs\b/.test(T.MSG.en.countLabel.replace('template(s)', '')), 'countLabel 装的是整个计数短语,复数不硬套')
  // 占位符两侧必须一致
  const ph = (s) => (String(s).match(/\{(\w+)\}/g) || []).sort().join(',')
  for (const k of Object.keys(T.MSG.zh)) eq(ph(T.MSG.zh[k]), ph(T.MSG.en[k]), `占位符两侧一致:${k}`)
}
{
  // ⚠️ t() 的占位符替换必须**单趟正则** —— 与 renderTemplate 同源的纪律。
  // 逐个 split/join(或按 Object.keys 多趟 reduce)会让**先替进去的值被后面的轮次再扫一遍**。
  // 单占位符的键看不出差别,所以这里直接量 t 本身:两个占位符 + 先替的值里含后替的键。
  // 每个 {x} 只按它**自己所在的位置**取值一次,替进去的值不再参与后续扫描
  eq(T.t('warnTooBroad', { n: '{c}', c: 'X' }), '这个文件夹里有 {c} 篇笔记,只列出前 X 篇。把模板收进一个更小的文件夹会更好用。', '**单趟证明**:替进 {n} 位的 "{c}" 原样留着,没被后面的轮次再吃一遍')
  eq(T.t('warnTooBroad', { c: '{n}', n: 'N' }), '这个文件夹里有 N 篇笔记,只列出前 {n} 篇。把模板收进一个更小的文件夹会更好用。', '**单趟证明**(反方向):多趟 split/join 在这里会吐出 "有 {n} 篇"')
  eq(T.t('errTplGone', { path: '{c}' }), T.MSG.zh.errTplGone.replace('{path}', '{c}'), '用户把模板命名成 {c} 也不许被当占位符吃掉')
  eq(T.t('createdOk', {}), T.MSG.zh.createdOk, '未提供的占位符原样留着')
  eq(T.t('不存在的键'), '不存在的键', '未知键原样返回')
  ok(/s\.replace\(\/\\\{\(\\w\+\)\\\}\/g/.test(src), 't() 源码里是单趟正则替换的形态(不是 split/join)')
  PASS++
}
// 落盘常量绝不随语言变
eq(T.TEMPLATE_SCAFFOLD.includes('这是一个模板'), true, '模板脚手架是钉死的中文正文')
eq(T.tplFolder(), 'Templates', '模板文件夹默认值钉死 Templates')
eq(T.workFolder(), '模板库', '工作文件夹兜底钉死中文')

// ═══════════════════════════════════════════════════════════════════════════════
// [2] disposer:是函数、执行不抛、全部退订被调用
// ═══════════════════════════════════════════════════════════════════════════════
section('[2] disposer')
{
  const H = await boot({ files: FILES })
  eq(typeof H.dispose, 'function', 'setup 应返回 disposer')
  const n = H.T.state().watchers
  ok(n >= 3, `每个列出的模板各挂一个 watchFile(实际 ${n})`)
  H.dispose()
  eq(H.watchOff, n, '全部 watchFile 退订被调用')
  eq(H.localeOff, 1, 'subscribeLocale 退订被调用')
  eq(H.pageOff, 1, 'subscribePage 退订被调用')
  H.dispose() // 二次 dispose 不许抛
  PASS++
}

// ═══════════════════════════════════════════════════════════════════════════════
// [5] 数据契约往返:MRU 写 → 读 → 再写
// ═══════════════════════════════════════════════════════════════════════════════
section('[5] MRU 数据契约')
{
  const H = await boot({ files: FILES })
  await H.T.pushRecent('Templates/周会.md')
  await H.T.pushRecent('Templates/读书笔记.md')
  await H.T.pushRecent('Templates/周会.md') // 去重 + 提到最前
  deq(H.data, { v: 1, recent: ['Templates/周会.md', 'Templates/读书笔记.md'] }, 'saveData 在场走它;去重 + 新的在前')
  eq(H.writes.length, 0, 'saveData 在场时不往 vault 写 sidecar')
  // 读 → 再写不丢字段
  const H2 = await boot({ files: FILES, data: { v: 1, recent: ['Templates/读书笔记.md', 'Templates/周会.md'] } })
  deq(H2.T.state().mru, { v: 1, recent: ['Templates/读书笔记.md', 'Templates/周会.md'] }, 'loadData 读回')
  await H2.T.pushRecent('Templates/会议/客户拜访.md')
  deq(H2.data.recent, ['Templates/会议/客户拜访.md', 'Templates/读书笔记.md', 'Templates/周会.md'], '再写不丢已有条目')
  eq(H2.data.v, 1, 'v 字段不丢')
  // 上限 8
  const H3 = await boot({ files: FILES })
  for (let i = 0; i < 12; i++) await H3.T.pushRecent(`Templates/t${i}.md`)
  eq(H3.data.recent.length, 8, 'recent 上限 8')
  eq(H3.data.recent[0], 'Templates/t11.md', '最新的在最前')
  // 旧宿主:没有 loadData/saveData → 走 sidecar
  const H4 = await boot({ files: FILES, noData: true })
  await H4.T.pushRecent('Templates/周会.md')
  ok(H4.writes.includes('模板库/.note-templates.json'), 'loadData/saveData 缺席 → 写 sidecar')
  deq(JSON.parse(H4.V.get('模板库/.note-templates.json')), { v: 1, recent: ['Templates/周会.md'] }, 'sidecar 同一份 JSON')
  const H5 = await boot({ files: { ...FILES, '模板库/.note-templates.json': JSON.stringify({ v: 1, recent: ['Templates/读书笔记.md'] }) }, noData: true })
  deq(H5.T.state().mru.recent, ['Templates/读书笔记.md'], 'sidecar 读回')
  // 两处都失败 → 静默降级为内存态,不抛
  const H6 = await boot({ files: FILES, noData: true })
  H6.ctx.app.writeFile = async () => { throw new Error('EROFS') }
  await H6.T.pushRecent('Templates/周会.md')
  eq(H6.T.state().mruMemoryOnly, true, '两处都写不了 → 内存态')
  deq(H6.T.state().mru.recent, ['Templates/周会.md'], '内存态里 MRU 仍然对')
  // 坏 JSON 不许崩
  const H7 = await boot({ files: { ...FILES, '模板库/.note-templates.json': '{坏的' }, noData: true })
  deq(H7.T.state().mru.recent, [], '坏 JSON → 回到空,不抛')
}

// ═══════════════════════════════════════════════════════════════════════════════
// [6] 旧宿主 ctx:07-18 之后的 API 全删掉,setup 不抛
// ═══════════════════════════════════════════════════════════════════════════════
section('[6] 旧宿主')
{
  _ls = new Map()
  const notes = []
  const oldCtx = {
    app: {
      notify: (m) => notes.push(m),
      openFile: () => {},
      readFile: async () => null,
      writeFile: async () => {},
      prompt: async () => null,
      getPage: () => ({ token: 't', path: null, status: 'idle', blocks: {}, order: [], fmExtra: '' }),
      subscribePage: undefined,
    },
    registerCommand: (c) => (oldCtx._cmds = (oldCtx._cmds || []).concat([c])),
    registerSlashItem: () => {},
    registerFileCreator: () => {},
    registerSetting: () => {},
    registerTheme: () => {},
    registerPanel: () => {},
    registerStatusItem: () => {},
    registerFileType: () => {},
    registerEmbedRenderer: () => {},
    registerPropertyType: () => {},
    openView: undefined,
    achievements: { registerSeries: () => {}, track: () => {} },
  }
  delete oldCtx.app.subscribePage
  delete oldCtx.app.watchFile
  delete oldCtx.app.listPages
  delete oldCtx.app.workFolder
  delete oldCtx.app.insertMarkdown
  delete oldCtx.app.getActivePage
  globalThis.__NOTE_TEMPLATES_TEST__ = {}
  let d
  A.doesNotThrow(() => { d = new Function('ctx', src)(oldCtx) }, '旧宿主下 setup 不许抛')
  PASS++
  const OT = globalThis.__NOTE_TEMPLATES_TEST__
  await OT.ready
  eq(OT.state().locale, 'zh', '没有 getLocale → 回退中文')
  eq(OT.state().enumSupported, false, '没有 listPages → 枚举不可用,降级')
  eq(OT.workFolder(), '模板库', '没有 workFolder → 兜底中文常量')
  // 命令面板「打开」走 hostTooOld 提示而不是崩
  const openCmd = oldCtx._cmds.find((c) => c.id === 'note-templates-open')
  A.doesNotThrow(() => openCmd.run(), '旧宿主上触发打开命令不许崩')
  PASS++
  ok(notes.some((m) => String(m).includes('宿主版本过旧')), '走 hostTooOld 提示(回退到 ctx.app.notify)')
  eq(typeof d, 'function', '旧宿主路径也返回 disposer')
  A.doesNotThrow(() => d(), '旧宿主 disposer 执行不抛')
  PASS++
}

// ═══════════════════════════════════════════════════════════════════════════════
// [8][9][10] 语言切换:不重挂 / 逐字往返 / 不丢用户输入
// ═══════════════════════════════════════════════════════════════════════════════
section('[8][9][10] 语言切换')
{
  const H = await boot({ files: FILES })
  const el = mkEl('div')
  const viewDispose = H.reg.views[0].mount(el)
  await settle()
  eq(H.mountCount, 1, '视图挂载一次')
  const root = byCls(el, 'ntp-root')[0]
  ok(root, '视图挂上了根容器')
  ok(visibleText(root).includes('全部模板'), '中文界面出现「全部模板」')
  ok(visibleText(root).includes('周会'), '模板列表出现「周会」')
  ok(byCls(root, 'ntp-item').length >= 3, `列出了 ${byCls(root, 'ntp-item').length} 个模板项`)

  // 用户操作:填搜索框、选中第二项、滚到某位置
  const search = byCls(root, 'ntp-search')[0]
  const listBox = byCls(root, 'ntp-list')[0]
  search.value = '周'
  fire(search, 'input')
  await settle()
  const filtered = byCls(root, 'ntp-item')
  eq(filtered.length, 1, '搜索「周」后只剩 1 项')
  eq(filtered[0].getAttribute('data-path'), 'Templates/周会.md', '过滤结果正确')
  search.value = ''
  fire(search, 'input')
  await settle()
  const items = byCls(root, 'ntp-item')
  fire(items[1], 'click')
  await settle()
  const selPathBefore = byCls(root, 'ntp-item').find((x) => x.className.includes('sel')).getAttribute('data-path')
  ok(selPathBefore, `选中了 ${selPathBefore}`)
  ok(visibleText(byCls(root, 'ntp-prev')[0]).length > 0, '预览区有内容')
  search.value = '周'
  fire(search, 'input')
  await settle()
  listBox.scrollTop = 42

  const zhText = visibleText(root)

  // [8] 切 en:重渲文本出现英文串,且视图**没有被重新 mount**
  H.locale = 'en'
  H.localeCb('en')
  await settle()
  eq(H.mountCount, 1, '切语言不重挂视图(mount 计数不变)')
  const enText = visibleText(root)
  ok(enText.includes('All templates'), '切 en 后出现英文串 All templates')
  ok(enText.includes('Rescan') && enText.includes('New note from this'), '按钮也变英文')
  ok(!enText.includes('全部模板'), '英文界面不再出现「全部模板」')

  // [10] 语言切换不丢用户没提交的输入
  eq(search.value, '周', '切语言后搜索框内容还在')
  eq(byCls(root, 'ntp-item').length, 1, '过滤结果不变')
  const selAfter = byCls(root, 'ntp-item').find((x) => x.className.includes('sel'))
  ok(selAfter, '选中项还在')
  eq(selAfter.getAttribute('data-path'), selPathBefore, '选中的还是同一个模板')
  eq(listBox.scrollTop, 42, '滚动位置被回填(垫片会在清空内容时把 scrollTop 归零)')

  // [9] 切回 zh:整棵视图文本与初始**逐字相同**
  H.locale = 'zh'
  H.localeCb('zh')
  await settle()
  eq(H.mountCount, 1, '切回来也不重挂')
  eq(visibleText(root), zhText, 'zh → en → zh 逐字往返')
  eq(search.value, '周', '往返后搜索框内容仍在')

  viewDispose()
  H.dispose()
}

// ═══════════════════════════════════════════════════════════════════════════════
// [11] v4 路由自检
// ═══════════════════════════════════════════════════════════════════════════════
section('[11] v4 路由')
{
  const H = await boot({ files: FILES, page: { path: 'notes/v4.md', model: 'text', text: '# 正在写\n\n正文' } })
  const el = mkEl('div')
  H.reg.views[0].mount(el)
  await settle()
  const root = byCls(el, 'ntp-root')[0]
  const items = byCls(root, 'ntp-item')
  fire(items.find((x) => x.getAttribute('data-path') === 'Templates/周会.md'), 'click')
  await settle()
  const btnInsert = byCls(root, 'ntp-btn').find((b) => /插进当前笔记/.test(b.textContent))
  ok(btnInsert && !btnInsert.disabled, '有活动页时「插进当前笔记」可用')
  fire(btnInsert, 'click')
  await settle()
  eq(H.blockProbe, 0, '插件一次都没有读 page.blocks / page.order 取正文(getter 探针)')
  deq(H.reg.forbidden, [], '一次都没调 insertBlockAfter / deleteBlock / setFmExtra / undo / redo / requestFocus / consumeFocus / mountBlocks')
  eq(H.inserted.length, 1, '改内容走的是 insertMarkdown')
  eq(H.inserted[0].where, 'cursor', 'where = cursor')
  ok(/^tok-\d+$/.test(H.inserted[0].token), '带了令牌')
  ok(H.inserted[0].md.includes('# 正在写') === false, '插的是模板内容,不是页面正文')
  ok(!H.inserted[0].md.includes('tags: 会议'), '插入路线剥掉了 frontmatter')
  eq(H.writes.length, 0, '插入路径零 writeFile')
  // 连点两次拿到两个不同 token(令牌**现取**,绝不缓存)
  fire(btnInsert, 'click')
  await settle()
  eq(H.inserted.length, 2)
  A.notEqual(H.inserted[0].token, H.inserted[1].token, '每次点击重新 getPage() 取新令牌')
  PASS++
  eq(H.writes.length, 0, '第二次插入仍然零 writeFile')
  H.dispose()
}
{
  // insertMarkdown 返回 false → 报 errInsert,且没有任何 writeFile
  const H = await boot({ files: FILES, page: { path: 'notes/v4.md', model: 'text' }, insertFails: true })
  const el = mkEl('div')
  H.reg.views[0].mount(el)
  await settle()
  const root = byCls(el, 'ntp-root')[0]
  fire(byCls(root, 'ntp-item').find((x) => x.getAttribute('data-path') === 'Templates/周会.md'), 'click')
  await settle()
  fire(byCls(root, 'ntp-btn').find((b) => /插进当前笔记/.test(b.textContent)), 'click')
  await settle()
  ok(H.notices.some((n) => String(n.m).includes('插入失败')), 'insertMarkdown 返回 false → 报 errInsert')
  eq(H.writes.length, 0, '**绝不回退到 writeFile**')
  eq(H.blockProbe, 0, '失败路径也没读 blocks/order')
  H.dispose()
}
{
  // 没有活动页 → 按钮禁用 + 点了也只是提示
  const H = await boot({ files: FILES, page: null })
  const el = mkEl('div')
  H.reg.views[0].mount(el)
  await settle()
  const root = byCls(el, 'ntp-root')[0]
  fire(byCls(root, 'ntp-item')[0], 'click')
  await settle()
  const btn = byCls(root, 'ntp-btn').find((b) => /插进当前笔记/.test(b.textContent))
  eq(btn.disabled, true, '没有活动页时「插进当前笔记」禁用')
  ok(String(btn.getAttribute('title')).includes('先在编辑器里打开一篇笔记'), '禁用时 title 说明原因')
  H.dispose()
}

// ═══════════════════════════════════════════════════════════════════════════════
// [12] 活动页写保护
// ═══════════════════════════════════════════════════════════════════════════════
section('[12] 活动页写保护')
{
  // 主用例:目标已存在且正是活动页 → 另存新版,绝不覆写
  const H = await boot({ files: FILES, activePage: 'notes/周会.md', prompts: ['周会'] })
  const finalPath = await H.T.createFromTemplate('Templates/周会.md', 'notes')
  eq(finalPath, 'notes/周会 2.md', '另存为 notes/周会 2.md')
  ok(!H.writes.includes('notes/周会.md'), '**没有**对活动页 notes/周会.md 的 writeFile')
  ok(H.writes.includes('notes/周会 2.md'), '实际写的是 notes/周会 2.md')
  eq(H.V.get('notes/周会.md'), '# 已经有一篇周会\n', '活动页内容逐字节没动')
  ok(H.notices.some((n) => String(n.m).includes('已另存为')), 'createdRenamed 提示出现')
  eq(H.loadedPages[0], 'notes/周会 2.md', '打开的是新建的那篇(走 loadPage)')
  H.dispose()
}
{
  // askOnConflict:true + 用户手打活动页名字、而该文件被外部删掉(探测 missing)→ 硬闸拦住
  const files = { ...FILES }
  delete files['notes/周会.md'] // 外部删掉了,但编辑器里还开着
  const H = await boot({ files, settings: { askOnConflict: 'true' }, activePage: 'notes/周会.md', prompts: ['日记', '周会'] })
  const r = await H.T.createFromTemplate('Templates/周会.md', 'notes')
  eq(r, null, '被 §3.2.2 硬闸拦住')
  ok(H.notices.some((n) => String(n.m).includes('目标正是你此刻打开的那篇笔记')), '报 errActivePage')
  eq(H.writes.length, 0, '零写入')
  eq(H.prompts.length, 2, 'ask 模式下确实又问了一次(预填空闲名)')
  eq(H.prompts[1].initial, '日记 2', '第二次 prompt 预填的是已算好的空闲名')
  H.dispose()
}
{
  // 斜杠路径:全程零 writeFile
  const H = await boot({ files: FILES, page: { path: 'notes/正在写.md', model: 'text' } })
  H.T.setPick(async () => 'Templates/周会.md')
  const md = await H.reg.slash[0].run({ pagePath: 'notes/正在写.md', folder: 'notes/.amadeus' })
  ok(md.includes('# 正在写'), '斜杠返回的 markdown 里 {{title}} 已代入活动页名')
  ok(!md.includes('tags: 会议'), '剥掉了 frontmatter')
  eq(H.writes.length, 0, '斜杠路径全程零 writeFile(插入由宿主完成)')
  eq(H.blockProbe, 0, '斜杠路径没碰 blocks/order')
  deq(H.reg.forbidden, [], '斜杠路径没碰任何块寻址口')
  deq(H.data.recent, ['Templates/周会.md'], '用过的模板进 MRU')
  ok(H.activity.some((a) => a.e === 'insert' && a.d.tpl === 'Templates/周会.md'), 'activity 记 insert')
  H.dispose()
}

// ═══════════════════════════════════════════════════════════════════════════════
// [13] 三态读:null 与抛错走不同分支(P0-①)
// ═══════════════════════════════════════════════════════════════════════════════
section('[13] 三态读')
{
  // 目标探测抛错 → 中止,零写入,报 errProbe
  const H = await boot({ files: FILES, prompts: ['新笔记'], failRead: (p) => p === '模板库/新笔记.md' })
  const r = await H.T.createFromTemplate('Templates/周会.md', '模板库')
  eq(r, null, '探测读失败 → 中止')
  eq(H.writes.length, 0, '**一个字节都不写**')
  ok(H.notices.some((n) => String(n.m).includes('读不到目标文件')), '报 errProbe')
  ok(!H.notices.some((n) => String(n.m).includes('模板不见了')), 'errProbe ≠ errTplGone')
  H.dispose()
}
{
  // 模板现读抛错 → errReadTpl,零写入;与「不存在」走不同分支、文案不同
  const H = await boot({ files: FILES, prompts: ['新笔记'], failRead: (p) => p === 'Templates/周会.md' })
  const r = await H.T.createFromTemplate('Templates/周会.md', '模板库')
  eq(r, null)
  eq(H.writes.length, 0, '模板读失败 → 零写入')
  ok(H.notices.some((n) => String(n.m).includes('读不到模板')), '报 errReadTpl(读失败)')
  ok(!H.notices.some((n) => String(n.m).includes('模板不见了')), '不是 errTplGone')
  eq(H.prompts.length, 0, '读模板在问名字之前 —— 读不到就不该打扰用户')
  H.dispose()
}
{
  // 模板返回 null(明确不存在)→ errTplGone,与上面文案不同
  const H = await boot({ files: FILES, prompts: ['新笔记'] })
  const r = await H.T.createFromTemplate('Templates/不存在.md', '模板库')
  eq(r, null)
  eq(H.writes.length, 0)
  ok(H.notices.some((n) => String(n.m).includes('模板不见了')), 'null → errTplGone')
  ok(!H.notices.some((n) => String(n.m).includes('读不到模板')), 'null 与抛错**走不同分支**')
  H.dispose()
}
{
  // 斜杠路径同样区分
  const H = await boot({ files: FILES, failRead: (p) => p === 'Templates/周会.md' })
  H.T.setPick(async () => 'Templates/周会.md')
  eq(await H.reg.slash[0].run({ pagePath: 'a.md' }), '', '读失败 → 返回空串,什么都不插')
  ok(H.notices.some((n) => String(n.m).includes('读不到模板')), '斜杠读失败报 errReadTpl')
  deq(H.data && H.data.recent ? H.data.recent : [], [], '读失败不进 MRU')
  H.dispose()
}

// ═══════════════════════════════════════════════════════════════════════════════
// [14] 模板在「列出」与「使用」之间被删
// ═══════════════════════════════════════════════════════════════════════════════
section('[14] 列出与使用之间被删')
{
  const H = await boot({ files: FILES })
  ok(H.T.state().templates.includes('Templates/周会.md'), '列表里本来有它')
  H.V.delete('Templates/周会.md') // 用户在别处删了
  H.T.setPick(async () => 'Templates/周会.md')
  const md = await H.reg.slash[0].run({ pagePath: 'notes/正在写.md' })
  eq(md, '', 'slash run 返回空串')
  ok(H.notices.some((n) => String(n.m).includes('模板不见了')), '报 errTplGone')
  deq(H.data && H.data.recent ? H.data.recent : [], [], '**不进 MRU**')
  eq(H.writes.length, 0, '零写入')
  H.dispose()
}

// ═══════════════════════════════════════════════════════════════════════════════
// [15] 同名另存链
// ═══════════════════════════════════════════════════════════════════════════════
section('[15] 同名另存链')
{
  const H = await boot({
    files: { ...FILES, 'A.md': 'x', 'A 2.md': 'x', 'A 3.md': 'x' },
    prompts: ['A'],
  })
  const p = await H.T.createFromTemplate('Templates/读书笔记.md', '')
  eq(p, 'A 4.md', 'A.md / A 2.md / A 3.md 都占了 → 写 A 4.md')
  ok(!H.writes.includes('A.md') && !H.writes.includes('A 2.md') && !H.writes.includes('A 3.md'), '一个已有文件都没碰')
  eq(H.V.get('A.md'), 'x', '已有文件逐字节不变')
  H.dispose()
}
{
  // 99 个都占了 → 中止 + errTooMany,零写入
  const files = { ...FILES, 'B.md': 'x' }
  for (let n = 2; n <= 99; n++) files[`B ${n}.md`] = 'x'
  const H = await boot({ files, prompts: ['B'] })
  const p = await H.T.createFromTemplate('Templates/读书笔记.md', '')
  eq(p, null, '试满 99 号 → 中止')
  ok(H.notices.some((n) => String(n.m).includes('同名文件太多了')), '报 errTooMany')
  eq(H.writes.length, 0, '零写入')
  H.dispose()
}

// ═══════════════════════════════════════════════════════════════════════════════
// [16] 读回自校验(P0-③)
// ═══════════════════════════════════════════════════════════════════════════════
section('[16] 读回自校验')
{
  const H = await boot({
    files: FILES,
    prompts: ['新笔记'],
    mangle: (p, text) => (p === '模板库/新笔记.md' ? text + '\n被别人改了' : text),
  })
  const p = await H.T.createFromTemplate('Templates/周会.md', '模板库')
  eq(p, null, '读回不一致 → 中止')
  ok(H.notices.some((n) => String(n.m).includes('写完读回来的内容对不上')), '报 errVerify')
  eq(H.opened.length + H.loadedPages.length, 0, '**没有打开任何东西**')
  deq(H.data && H.data.recent ? H.data.recent : [], [], '**MRU 没有追加**(失败绝不记成功,下一轮还能重来)')
  ok(!H.activity.some((a) => a.e === 'create'), 'activity 也不记 create')
  H.dispose()
}
{
  // 写抛错 → errWrite,不进 MRU
  const H = await boot({ files: FILES, prompts: ['新笔记'] })
  H.ctx.app.writeFile = async () => { throw new Error('ENOSPC') }
  const p = await H.T.createFromTemplate('Templates/周会.md', '模板库')
  eq(p, null)
  ok(H.notices.some((n) => String(n.m).includes('写入失败')), '报 errWrite')
  ok(H.notices.some((n) => String(n.m).includes('ENOSPC')), '带上真实错误信息')
  eq(H.opened.length + H.loadedPages.length, 0, '没有打开任何东西')
  H.dispose()
}

// ═══════════════════════════════════════════════════════════════════════════════
// [17] {{title}} 用**改名后**的最终 basename
// ═══════════════════════════════════════════════════════════════════════════════
section('[17] {{title}} 用改名后的 basename')
{
  const H = await boot({ files: { ...FILES, '周会.md': '占位' }, prompts: ['周会'] })
  const p = await H.T.createFromTemplate('Templates/周会.md', '')
  eq(p, '周会 2.md', '另存为 周会 2.md')
  const body = H.V.get('周会 2.md')
  ok(body.includes('# 周会 2'), '正文里 {{title}} 代入的是**改名后**的「周会 2」')
  ok(!body.includes('# 周会\n'), '不是改名前的「周会」')
  eq(H.V.get('周会.md'), '占位', '占位文件逐字节不变')
  H.dispose()
}

// ═══════════════════════════════════════════════════════════════════════════════
// [18] 新建路线不消毒(正面锁住 §2.5 的不对称)
// ═══════════════════════════════════════════════════════════════════════════════
section('[18] 新建路线不消毒')
{
  const TPL = '---\ntags: 会议\nkey: v\n---\n\n<!-- a 7 -->\n# {{title}}\n\n| a   | b |\n| --- | --- |\n| 1   | 2 |\n'
  const H = await boot({ files: { ...FILES, 'Templates/结构.md': TPL }, prompts: ['产物'] })
  const p = await H.T.createFromTemplate('Templates/结构.md', '模板库')
  eq(p, '模板库/产物.md')
  const body = H.V.get('模板库/产物.md')
  ok(body.startsWith('---\ntags: 会议\nkey: v\n---'), '新建路线:**frontmatter 在**')
  ok(body.includes('<!-- a 7 -->'), '新建路线:**块标记在**(锚点键每文件独立,复制不冲突)')
  ok(body.includes('| a   | b |'), '新建路线:**表格对齐空格在**')
  ok(body.includes('# 产物'), '新建路线:只有变量被代入')
  eq(body, TPL.replace('{{title}}', '产物'), '除了变量代入,逐字节与模板相同')
  // 同一份模板走插入路线 → 三样都不在
  const ins = H.T.buildForInsert(TPL, 'notes/目标.md')
  ok(!ins.includes('---\ntags'), '插入路线:frontmatter 不在')
  ok(!ins.includes('<!-- a 7 -->'), '插入路线:块标记不在')
  ok(!ins.includes('| a   | b |') && ins.includes('| a | b |'), '插入路线:表格对齐空格被归一')
  ok(ins.includes('# 目标'), '插入路线:{{title}} 用的是目标笔记名')
  H.dispose()
}
{
  // 新建模板:脚手架逐字节原样(它的产物是「模板」,代入变量会当场把它废掉)
  const H = await boot({ files: FILES, prompts: ['我的新模板'] })
  const p = await H.T.createTemplate()
  eq(p, 'Templates/我的新模板.md', '新模板落在 tplFolder 下')
  eq(H.V.get(p), H.T.TEMPLATE_SCAFFOLD, '脚手架**逐字节原样**落盘,{{title}} / {{date}} 一个都不代入')
  eq(H.loadedPages[0], p, '写完打开,用户用宿主自己的编辑器改(走 loadPage)')
  ok(H.activity.some((a) => a.e === 'new-template'), 'activity 记 new-template')
  deq(H.data && H.data.recent ? H.data.recent : [], [], '新建模板不进 MRU(MRU 记的是「用过哪个模板」)')
  H.dispose()
}

// ═══════════════════════════════════════════════════════════════════════════════
// [19] 库根防呆(最大风险 ②)
// ═══════════════════════════════════════════════════════════════════════════════
section('[19] 库根防呆')
{
  const H = await boot({ files: FILES, settings: { folder: '' } })
  eq(H.T.tplFolder(), 'Templates', '空串 → 回退 Templates')
  for (const v of ['/', '.', '../x', 'C:\\x']) {
    setSetting('folder', v)
    await H.T.scanTemplates()
    eq(H.T.tplFolder(), 'Templates', `${JSON.stringify(v)} → 回退 Templates`)
    const list = H.T.state().templates
    ok(!list.includes('notes/日记.md') && !list.includes('notes/周会.md'), `${JSON.stringify(v)} 下没把全库笔记当模板`)
    ok(list.every((p) => /^Templates\//i.test(p)), '列表里只有 Templates/ 下的')
  }
  const warns = H.notices.filter((n) => String(n.m).includes('模板文件夹设置不合法'))
  eq(warns.length, 1, 'warnRootFolder 一次会话只提示一次(不刷屏)')
  H.dispose()
}
{
  // 合法的自定义文件夹照常工作
  const H = await boot({ files: { ...FILES, '我的模板/子集/a.md': '# a' }, settings: { folder: '我的模板' } })
  deq(H.T.state().templates, ['我的模板/子集/a.md'], '中文 + 子文件夹的模板夹照常工作')
  ok(!H.notices.some((n) => String(n.m).includes('模板文件夹设置不合法')), '合法设置不该有警告')
  H.dispose()
}
{
  // 大小写不敏感:内置 templates/ 建的模板也认(两套共用一批文件)
  const H = await boot({ files: { 'templates/内置建的.md': '# x', 'Templates/我建的.md': '# y', 'notes/别的.md': '# z' } })
  deq(H.T.state().templates.sort(), ['Templates/我建的.md', 'templates/内置建的.md'].sort(), '大小写不敏感,不分裂成两个库')
  H.dispose()
}
{
  // 超过 MAX_TEMPLATES → 顶部黄条
  const files = {}
  for (let i = 0; i < 260; i++) files[`Templates/t${String(i).padStart(3, '0')}.md`] = '# x'
  const H = await boot({ files })
  eq(H.T.state().templates.length, 200, '列表上限 200')
  eq(H.T.state().totalFound, 260, '记住了真实总数')
  const el = mkEl('div')
  H.reg.views[0].mount(el)
  await settle()
  const warn = byCls(el, 'ntp-warn')[0]
  ok(visibleText(warn).includes('260') && visibleText(warn).includes('200'), '顶部黄条给出 200 / 260')
  H.dispose()
}

// ═══════════════════════════════════════════════════════════════════════════════
// [20] 枚举缺席降级
// ═══════════════════════════════════════════════════════════════════════════════
section('[20] 枚举缺席降级')
for (const opts of [{ noListPages: true }, { pages: [] }]) {
  const H = await boot({ files: FILES, ...opts })
  eq(H.T.state().enumSupported, false, `${opts.noListPages ? 'listPages 缺席' : 'listPages 返回 []'} → 枚举不可用`)
  const el = mkEl('div')
  let d
  A.doesNotThrow(() => { d = H.reg.views[0].mount(el) }, 'mount 不抛')
  PASS++
  await settle()
  const root = byCls(el, 'ntp-root')[0]
  ok(visibleText(root).includes('当前环境不支持枚举'), '视图显示 noEnum')
  for (const b of byCls(root, 'ntp-btn')) {
    if (/用它新建|插进当前笔记/.test(b.textContent)) eq(b.disabled, true, `按钮禁用:${b.textContent}`)
  }
  eq(H.T.state().watchers, 0, '没有模板就没有 watcher')
  // 浮层路径也降级(不崩)
  H.T.setPick(null)
  eq(await H.T.pickTemplate(), null, '选择浮层降级返回 null')
  ok(H.notices.some((n) => String(n.m).includes('当前环境不支持枚举')), '浮层降级有提示')
  if (d) d()
  H.dispose()
}
{
  // 没有 watchFile 的宿主:不崩、不轮询
  const H = await boot({ files: FILES, noWatch: true })
  eq(H.T.state().watchers, 0, 'watchFile 缺席 → 零 watcher,也不退化成轮询')
  eq(H.T.state().templates.length, 3, '照常列出模板')
  H.dispose()
}

// ═══════════════════════════════════════════════════════════════════════════════
// 补充:文件创建器 base = parentFolder / 命令顺序「先选模板后问名字」/ 浮层键盘 / 重新扫描
// ═══════════════════════════════════════════════════════════════════════════════
section('[补] 入口行为')
{
  // registerFileCreator:base 是右键的那个文件夹,不是 workFolder
  const H = await boot({ files: FILES, prompts: ['拜访记录'] })
  H.T.setPick(async () => 'Templates/会议/客户拜访.md')
  await H.reg.creators[0].run('客户/2026')
  ok(H.writes.includes('客户/2026/拜访记录.md'), 'base = parentFolder(右键了哪个文件夹就落哪儿)')
  ok(!H.writes.some((p) => p.startsWith('模板库/') && p.endsWith('拜访记录.md')), '不是 workFolder')
  // 库根右键(parentFolder = '')
  H.promptQueue.push('根上的')
  await H.reg.creators[0].run('')
  ok(H.writes.includes('根上的.md'), "parentFolder = '' → 落库根")
  H.dispose()
}
{
  // 命令 note-templates-new:**先选模板,后问名字**
  const H = await boot({ files: FILES, prompts: ['本周'] })
  const order = []
  H.T.setPick(async () => { order.push('pick'); return 'Templates/周会.md' })
  const realPrompt = H.ctx.app.prompt
  H.ctx.app.prompt = async (...a) => { order.push('prompt'); return realPrompt(...a) }
  H.reg.commands.find((c) => c.id === 'note-templates-new').run()
  await settle(20)
  deq(order, ['pick', 'prompt'], '顺序钉死:先选模板,再问名字')
  ok(H.writes.includes('模板库/本周.md'), '命令路径 base = workFolder')
  H.dispose()
}
{
  // 命令 note-templates-open
  const H = await boot({ files: FILES })
  H.reg.commands.find((c) => c.id === 'note-templates-open').run()
  eq(H.openedView, 'library', 'note-templates-open 打开 library 视图')
  H.dispose()
}
{
  // 浮层:挂到 layer 根、有行、↑↓/Enter/Esc 可用、disposer 摘掉
  const H = await boot({ files: FILES })
  H.T.setPick(null)
  const p = H.T.pickTemplate()
  await settle()
  const pk = H.T._picker
  ok(pk && pk.layer, '浮层建出来了')
  ok(pk.layer.parentElement, '浮层挂上了宿主容器(不是游离节点)')
  eq(pk.layer.className, 'ntp-layer', '浮层根是插件自己的 .ntp-layer(fixed + pointer-events:none)')
  const rows = byCls(pk.layer, 'ntp-pop-row')
  eq(rows.length, 3, '列出 3 个模板')
  eq(rows[0].className.includes('cur'), true, '默认高亮第一行')
  pk.onKey({ key: 'ArrowDown', preventDefault() {} })
  const rows2 = byCls(pk.layer, 'ntp-pop-row')
  eq(rows2[1].className.includes('cur'), true, '↓ 移动高亮')
  pk.input.value = '读书'
  fire(pk.input, 'input')
  eq(byCls(pk.layer, 'ntp-pop-row').length, 1, '打字过滤')
  pk.onKey({ key: 'Enter', preventDefault() {} })
  eq(await p, 'Templates/读书笔记.md', 'Enter 确认选中项')
  eq(pk.layer.parentElement, null, '确认后浮层被摘掉')
  // Esc 取消
  const p2 = H.T.pickTemplate()
  await settle()
  const pk2 = H.T._picker
  pk2.onKey({ key: 'Escape', preventDefault() {}, stopPropagation() {} })
  eq(await p2, null, 'Esc 取消返回 null')
  eq(pk2.layer.parentElement, null, '取消后浮层被摘掉')
  // disposer 兜底摘浮层
  const p3 = H.T.pickTemplate()
  await settle()
  const pk3 = H.T._picker
  H.dispose()
  eq(await p3, null, 'disposer 关掉在飞的浮层并 resolve(null)')
  eq(pk3.layer.parentElement, null, 'disposer 把浮层摘干净')
}
{
  // 「重新扫描」按钮:watchFile 只报内容变,新建/删除/改名不报 —— 所以这个按钮必须真的重列
  const H = await boot({ files: FILES })
  const el = mkEl('div')
  H.reg.views[0].mount(el)
  await settle()
  const root = byCls(el, 'ntp-root')[0]
  eq(byCls(root, 'ntp-item').length, 3, '一开始 3 个')
  H.V.set('Templates/新来的.md', '# 新来的')
  fire(byCls(root, 'ntp-btn').find((b) => b.textContent === '重新扫描'), 'click')
  await settle()
  eq(byCls(root, 'ntp-item').length, 4, '重新扫描后 4 个')
  ok(visibleText(root).includes('新来的'), '新模板出现在列表里')
  // watchFile 回调 → 重读当前预览
  fire(byCls(root, 'ntp-item').find((x) => x.getAttribute('data-path') === 'Templates/读书笔记.md'), 'click')
  await settle()
  ok(visibleText(byCls(root, 'ntp-prev')[0]).includes('摘要'), '预览是读书笔记')
  H.V.set('Templates/读书笔记.md', '# {{title}}\n\n## 改过了\n')
  H.watched.get('Templates/读书笔记.md')()
  await settle()
  ok(visibleText(byCls(root, 'ntp-prev')[0]).includes('改过了'), 'watchFile 回调 → 预览重读')
  H.dispose()
}
{
  // 预览按**插入路线**渲染(所见即插入后的样子)
  const H = await boot({ files: FILES, page: { path: 'notes/我的周会.md', model: 'text' } })
  const el = mkEl('div')
  H.reg.views[0].mount(el)
  await settle()
  const root = byCls(el, 'ntp-root')[0]
  fire(byCls(root, 'ntp-item').find((x) => x.getAttribute('data-path') === 'Templates/周会.md'), 'click')
  await settle()
  const prev = visibleText(byCls(root, 'ntp-prev')[0])
  ok(prev.includes('我的周会'), '预览里 {{title}} 已代入')
  ok(!prev.includes('tags: 会议'), '预览按插入路线:frontmatter 不在')
  ok(prev.includes('议程'), '预览有正文小节')
  eq(H.blockProbe, 0, '预览路径没读 blocks/order')
  H.dispose()
}
{
  // ⚠️ SPEC §2.1:列表只存路径名,**每次真正要用(插入 / 新建 / 预览)都现读一次,不缓存正文**。
  // 这里故意在插件背后改盘(不触发 watchFile),看它插进去的是新内容还是陈旧的预览缓存。
  const H = await boot({ files: FILES, page: { path: 'notes/正在写.md', model: 'text' } })
  const el = mkEl('div')
  H.reg.views[0].mount(el)
  await settle()
  const root = byCls(el, 'ntp-root')[0]
  fire(byCls(root, 'ntp-item').find((x) => x.getAttribute('data-path') === 'Templates/读书笔记.md'), 'click')
  await settle()
  ok(visibleText(byCls(root, 'ntp-prev')[0]).includes('摘要'), '预览是选中那一刻的内容')
  H.V.set('Templates/读书笔记.md', '# {{title}}\n\n## 背着插件改过的新内容\n') // 外部改动,不触发 watchFile
  fire(byCls(root, 'ntp-btn').find((b) => /插进当前笔记/.test(b.textContent)), 'click')
  await settle()
  eq(H.inserted.length, 1)
  ok(H.inserted[0].md.includes('背着插件改过的新内容'), '插入**现读**磁盘,不用陈旧的预览缓存')
  ok(!H.inserted[0].md.includes('摘要'), '陈旧内容没有被插进去')
  // 新建路径同样现读
  H.promptQueue.push('产物')
  H.V.set('Templates/读书笔记.md', '# {{title}}\n\n## 又改了一次\n')
  await H.T.createFromTemplate('Templates/读书笔记.md', '模板库')
  ok(H.V.get('模板库/产物.md').includes('又改了一次'), '新建路径也是现读磁盘')
  // 斜杠路径同样现读
  H.T.setPick(async () => 'Templates/读书笔记.md')
  H.V.set('Templates/读书笔记.md', '# {{title}}\n\n## 第三次改\n')
  const md = await H.reg.slash[0].run({ pagePath: 'notes/正在写.md' })
  ok(md.includes('第三次改'), '斜杠路径也是现读磁盘')
  H.dispose()
}
{
  // 点击「插进当前笔记」之后、await 期间用户改选了别的模板 → 插的、记进 MRU 的、提示里说的
  // 必须都是**点击那一刻**钉住的那个,不能是「刚选上的那个」。
  const H = await boot({ files: FILES, page: { path: 'notes/正在写.md', model: 'text' } })
  const el = mkEl('div')
  H.reg.views[0].mount(el)
  await settle()
  const root = byCls(el, 'ntp-root')[0]
  const row = (p) => byCls(root, 'ntp-item').find((x) => x.getAttribute('data-path') === p)
  fire(row('Templates/读书笔记.md'), 'click')
  await settle()
  // readFile 慢一拍,给用户留出改选的窗口
  const realRead = H.ctx.app.readFile
  H.ctx.app.readFile = async (p) => { await tick(); await tick(); return realRead(p) }
  fire(byCls(root, 'ntp-btn').find((b) => /插进当前笔记/.test(b.textContent)), 'click')
  fire(row('Templates/周会.md'), 'click') // await 期间改选
  await settle(20)
  eq(H.inserted.length, 1, '只插了一次')
  ok(H.inserted[0].md.includes('摘要'), '插的是**点击那一刻**选中的读书笔记')
  ok(!H.inserted[0].md.includes('议程'), '不是 await 期间改选上的周会')
  deq(H.data.recent, ['Templates/读书笔记.md'], 'MRU 记的也是点击那一刻那个')
  eq(H.activity.filter((a) => a.e === 'insert')[0].d.tpl, 'Templates/读书笔记.md', 'activity 埋点同样')
  H.dispose()
}
{
  // 名字全是非法字符 → 用钉死的中文默认名,不报路径错;真越界 → errBadPath 且零写入
  const H = await boot({ files: FILES, prompts: ['...'] })
  const p = await H.T.createFromTemplate('Templates/读书笔记.md', '模板库')
  eq(p, '模板库/未命名笔记.md', '名字washed 掉 → 钉死的中文默认名(英文界面下也是它)')
  ok(H.notices.some((n) => String(n.m).includes('没有可用字符')), '报 errNoName')
  const H2 = await boot({ files: FILES, prompts: ['../逃出去'] })
  eq(await H2.T.createFromTemplate('Templates/读书笔记.md', '模板库'), null, '越界名字被拒')
  ok(H2.notices.some((n) => String(n.m).includes('不能越出笔记库')), '报 errBadPath')
  eq(H2.writes.length, 0, '越界零写入')
  H.dispose()
  H2.dispose()
}
{
  // 用户取消(prompt 返回 null / 空)→ 静默,不报错、不写
  const H = await boot({ files: FILES, prompts: [null] })
  eq(await H.T.createFromTemplate('Templates/周会.md', '模板库'), null)
  eq(H.writes.length, 0)
  eq(H.notices.length, 0, '取消是静默的,不许弹错误')
  const H2 = await boot({ files: FILES, prompts: ['   '] })
  eq(await H2.T.createFromTemplate('Templates/周会.md', '模板库'), null)
  eq(H2.notices.length, 0, '空名字也静默取消')
  H.dispose()
  H2.dispose()
}
{
  // 正常成功路径的完整证词
  const H = await boot({ files: FILES, prompts: ['本周周会'] })
  const p = await H.T.createFromTemplate('Templates/周会.md', '模板库')
  eq(p, '模板库/本周周会.md')
  ok(H.V.get(p).startsWith('---\ntags: 会议\n---'), 'frontmatter 保留')
  ok(H.V.get(p).includes('# 本周周会'), '{{title}} 代入')
  ok(H.V.get(p).includes('## 决议  两空格'), '新建路线不做空格归一')
  deq(H.data.recent, ['Templates/周会.md'], '成功后才落 MRU')
  eq(H.loadedPages[0], p, '走 loadPage 而非 openFile')
  ok(H.activity.some((a) => a.e === 'create' && a.d.tpl === 'Templates/周会.md' && a.d.path === p), 'activity 记 create,detail 只放 vault 相对路径')
  ok(H.notices.some((n) => String(n.m).includes('已建好')), 'createdOk 提示')
  ok(!H.notices.some((n) => String(n.m).includes('已另存为')), '没改名就不报改名')
  H.dispose()
}
{
  // sidecar 被用户当笔记打开着 → 退回内存态,不写、不报错
  const H = await boot({ files: FILES, noData: true, activePage: '模板库/.note-templates.json' })
  await H.T.pushRecent('Templates/周会.md')
  eq(H.writes.length, 0, 'sidecar 正被打开 → 一个字节都不写')
  eq(H.T.state().mruMemoryOnly, true, '退回内存态')
  eq(H.notices.length, 0, '不打扰用户(丢一条 MRU 不是事故)')
  H.dispose()
}

// ══════════════════════════════════════════════════════════════════════════
// [回归] 2026-08-21 收口补的三组 —— 不是建造者写的,是事后拿宿主源码实证挖出来的
// ══════════════════════════════════════════════════════════════════════════
{
  // R1:普通 .md 必须走 loadPage,不能走 openFile。
  //     真源 amadeusNav.ts:215 —— openFile 对 !matchFileType(path) 的裸 .md 回落到
  //     amadeus.openVaultFile() = 交系统默认程序,新建的笔记会在 TextEdit 里弹出来。
  const H = await boot({ files: FILES, prompts: ['回归一'] })
  const p = await H.T.createFromTemplate('Templates/周会.md', '模板库')
  eq(H.loadedPages[0], p, 'R1 新建后走 ctx.app.loadPage')
  eq(H.opened.length, 0, 'R1 一次都没调 ctx.app.openFile')
  H.dispose()
}
{
  // R2:旧宿主没有 loadPage 时才退回 openFile(那种宿主上没有更好的路)
  const H = await boot({ files: FILES, prompts: ['回归二'], noLoadPage: true })
  const p = await H.T.createFromTemplate('Templates/周会.md', '模板库')
  eq(H.loadedPages.length, 0, 'R2 旧宿主没有 loadPage')
  eq(H.opened[0], p, 'R2 退回 openFile,不是干脆不打开')
  H.dispose()
}
{
  // R3:slash 的 run() 返回值有三道宿主硬闸,我们自己先判。
  //     真源 UnifiedPage.tsx:412-419 —— 非字符串 / 长度 > 8192 / 含控制字符,一律 throw。
  const H = await boot({ files: FILES })
  const G = H.T.guardSlashPayload
  eq(G('# 正常\n\n一段'), '# 正常\n\n一段', 'R3 正常内容原样通过')
  eq(G('\t制表与换行放行\n'), '\t制表与换行放行\n', 'R3 tab 与换行是放行的')
  eq(G('x'.repeat(8192)), 'x'.repeat(8192), 'R3 边界 8192 本身合法(宿主判的是 > 8192)')
  const n1 = H.notices.length
  eq(G('x'.repeat(8193)), '', 'R3 超 8192 返回空串(宿主对空串是安静不插入)')
  ok(H.notices.length > n1, 'R3 超长要明说原因,不许静默')
  ok(String(H.notices[H.notices.length - 1].m).includes('8192'), 'R3 提示里点出 8192 这个数')
  ok(G('y'.repeat(9000)) === '', 'R3 超长绝不截断成半份模板 —— 插进去半份比不插更坏')
  const n2 = H.notices.length
  eq(G('正常' + String.fromCharCode(7) + '响铃'), '', 'R3 控制字符返回空串')
  ok(H.notices.length > n2, 'R3 控制字符要明说原因')
  eq(G(null), '', 'R3 非字符串也不让它冒到宿主')
  H.dispose()
}

// ══════════════════════════════════════════════════════════════════════════
// [回归] 2026-08-21 对抗评审(REVIEW-templates.md Finding 1 / 2)
// ══════════════════════════════════════════════════════════════════════════
{
  // R-F1:两条插入路线必须同一口径。以前只有斜杠那条判控制字符,
  //   视图里的「插进当前笔记」按钮把宿主明文拒收的内容原样交给 insertMarkdown。
  const DIRTY = '# 会议纪要\n\n## 议题\f一\n'
  const H = await boot({ files: { 'Templates/脏模板.md': DIRTY } })
  const md = H.T.buildForInsert(DIRTY, 'notes/正在写.md')
  ok(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(md), 'R-F1 前置:这份模板过完消毒仍带控制字符')
  const n0 = H.notices.length
  eq(H.T.ctrlCharClean(md), false, 'R-F1 控制字符闸必须拦下它')
  ok(H.notices.length > n0, 'R-F1 拦下时要明说原因,不许静默')
  eq(H.T.ctrlCharClean('# 干净\n\n\t有 tab 和换行\n'), true, 'R-F1 tab 与换行是放行的(别拦过头)')
  // 8192 那道闸**不许**带进 insertMarkdown 路线:它没有长度上限,带过去是误闸
  eq(H.T.ctrlCharClean('x'.repeat(9000)), true, 'R-F1 长度不归控制字符闸管')
  eq(H.T.guardSlashPayload('x'.repeat(9000)), '', 'R-F1 而斜杠那条仍然按 8192 拦')
  H.dispose()
}
{
  // R-F2:闸拦下之后一个持久标记都不许落(P0 模板 3)。
  //   以前 pushRecent / activity.log / rerenders 排在 guardSlashPayload **之前**,
  //   于是一份永远插不进去的模板照样进「最近使用」(saveData 落盘,重启还在)并记一条 insert。
  const BIG = '# 大\n\n' + 'x'.repeat(9000)
  const H = await boot({ files: { 'Templates/大.md': BIG, 'Templates/小.md': '# 小\n\n一行\n' } })
  const sl = H.reg.slash.find((x) => x.id === 'note-templates-insert')
  const before = JSON.stringify(H.data)
  const actsBefore = H.activity.length
  H.T.setPick(async () => 'Templates/大.md')
  const out = await sl.run({ pagePath: 'notes/正在写.md', folder: 'notes/.amadeus' })
  eq(out, '', 'R-F2 超限模板 run() 返回空串(宿主对空串是安静不插入)')
  eq(JSON.stringify(H.data), before, 'R-F2 「最近使用」一个字节都没变')
  eq(H.activity.length, actsBefore, 'R-F2 活动日志没多出一条 insert')
  // 反向:能插进去的模板照旧落标记
  H.T.setPick(async () => 'Templates/小.md')
  const out2 = await sl.run({ pagePath: 'notes/正在写.md', folder: 'notes/.amadeus' })
  ok(out2 && out2.length > 0, 'R-F2 反向:正常模板照旧返回内容')
  ok(H.data && H.data.recent && H.data.recent[0] === 'Templates/小.md', 'R-F2 反向:成功时才进「最近使用」')
  H.dispose()
}

// ── [补] 统一左栏列表源(1.1.0)──────────────────────────────────────────────────
// ⚠️「订阅即重扫」是这条接缝的头号坑:插件在宿主**启动期**装载,那时活动库还没恢复,
//    listPages() 按契约给空数组(不抛错)→ 列表定格为空且此后无人再喊它(青鸟 2026-08-28 实报)。
{
  section('[补] 统一左栏列表源')
  const H = await boot({ pages: [] }) // 启动期:枚举面还给不出东西(= 活动库未就位)
  const LS = H.reg.listSources.find((x) => x.id === 'template-list')
  ok(LS, '应注册 template-list 列表源')
  eq(H.reg.views.find((v) => v.id === 'library').workspaceSource, 'template-list', 'library 视图应声明 workspaceSource(裸源 id)')
  eq(LS.items({}).length, 0, '前提:启动期扫到的是空的')
  H.V.set('Templates/周报.md', '# 周报\n\n本周:\n')
  H.V.set('Templates/读书笔记.md', '# 读书笔记\n\n出处:\n')
  H.ctx.app.listPages = async () => [...H.V.keys()].filter((p) => /\.md$/i.test(p))
  const off = LS.subscribe(() => {})
  await new Promise((r) => setTimeout(r, 10))
  const rows = LS.items({})
  eq(rows.length, 2, 'subscribe() 必须触发一次重扫,否则启动期扫空的列表永远回不来')
  eq(rows[0].title, '周报', '行标题=模板名(去掉 .md 与目录)')
  eq(rows[0].icon, 'template', '行首图标走宿主词表键 template')
  eq(LS.items({ query: '读书' }).length, 1, '搜索匹配路径')
  // 单击 = 打开模板本身(导航);「用它新建」只在右键里,不给单击
  const navBefore = H.navLoaded ? H.navLoaded.length : 0
  LS.open({ key: 'Templates/周报.md' })
  ok(H.loadedPages.includes('Templates/周报.md'), '单击应 loadPage 打开模板本身(裸 .md 绝不走 openFile)')
  const menu = LS.itemMenu({ key: 'Templates/周报.md' })
  eq(menu.length, 1, '右键只给一条「用它新建」')
  void navBefore
  ok(typeof off === 'function', 'subscribe() 须返回退订函数')
  off()
  H.dispose()
}

console.log(`\n✅ 全绿 —— ${PASS} 条断言通过(SPEC §7 的 21 项全覆盖)`)
