/**
 * 模板库 note-templates —— Forsion 桌面插件(裸 setup(ctx) 体,宿主 new Function('ctx', code) 装载)。
 *
 * 你自己 vault 里的 `Templates/*.md` 就是模板库:笔记里敲 /模板 插一段结构、命令面板或文件树右键
 * 「从模板新建」起一篇新笔记、「模板库」视图里逐个预览(变量已代入)。
 *
 * 为什么必须是插件:宿主内置模板系统插入的唯一通道是 v3 的块清单,而 v4/unified 已是普通笔记的
 * 默认载体,内置模板项在 v4 笔记上被显式关掉了。本插件走 registerSlashItem.run() 返回 markdown
 * 交宿主插入 + insertMarkdown —— 两条路都不碰块 id。
 *
 * 活动页写保护(毁数据防线,三条):
 *   ① 改当前笔记只有 insertMarkdown。绝不「读全文 → 改 → 整篇写回」(page.text 是上次保存那一刻的
 *      快照,≤800ms 陈旧,那 800ms 里用户敲的字会被抹掉)。本插件一次都不读 page.text / blocks / order。
 *   ② 新建笔记走七步:现读模板 → 问名字 → 定路径 → 三态探测+同名另存 → 活动页硬闸 → 写+读回自校验 → 落 MRU。
 *   ③ 永远没有「覆写」这个分支,连设置项都不给。读失败(不是「不存在」)一律中止,一个字节都不写。
 *
 * 两条不对称路线(最容易写错的一处):
 *   插入 = 剥 frontmatter + 剥块标记 + 空格归一后的一段;
 *   新建 = 一份合法笔记的字节副本(只代入变量,其余逐字节原样)。
 *
 * 安全:一切文件内容渲染只走 createElement + textContent(全文件零 HTML 字符串注入面,零 XSS 面)。
 *      不执行模板里的任何代码(没有 Templater 那种 JS 求值)。
 * 兼容:07-18 之后的 ctx 面一律可选链,旧宿主缺席时优雅降级,setup 绝不抛。
 * 双语:MSG.zh / MSG.en 两侧键集合相等;ctx.subscribeLocale 触发就地重画(视图不重挂,
 *      重画前快照搜索框 / 选中项 / 滚动位置,重画后回填)。落盘的名字与路径一律钉死,不随语言变。
 * 时间:「现在」一律 Date.now();日期位移正午锚定(DST 三定式);全文件无任何定时器。
 */
const PLUGIN_ID = 'note-templates'

// ── 钉死的落盘常量(绝不取 t(),英文界面下也是这些值) ──────────────────────────
const DEFAULT_WORK_FOLDER = '模板库' // ctx.app.workFolder 缺席时的兜底
const DEFAULT_TPL_FOLDER = 'Templates' // 模板源文件夹默认值(英文:与 Obsidian 同名、与宿主内置 templates/ 大小写不敏感同源)
const DEFAULT_NOTE_NAME = '未命名笔记'
const DEFAULT_TEMPLATE_NAME = '未命名模板'
const SIDECAR_NAME = '.note-templates.json'
const MAX_TEMPLATES = 200
const MAX_RENAME_TRIES = 99
const MAX_RECENT = 8
const MAX_MRU_SHOWN = 3
const MAX_ASK_ROUNDS = 50

// 新建模板的脚手架(钉死的中文正文,英文界面下也是这份)。
// ⚠️ 这份内容**不过 renderTemplate** —— 它的产物是一个「模板」,不是一篇笔记:代入变量会把
// `# {{title}}` 变成 `# 未命名模板`、把说明行里的示例变成一串死日期,做出来的模板当场废掉。
// 这是与 §2.5「新建 = 字节副本」同源的一条不对称,README 与 CHANGELOG 都写了。
const TEMPLATE_SCAFFOLD = [
  '---',
  'created: {{date}}',
  '---',
  '',
  '# {{title}}',
  '',
  '> 这是一个模板。把 {{date}} {{time}} {{title}} 写进正文,插入时会被自动替换。',
  '> 支持:{{date:YYYY年MM月DD日}}、{{date:+1d:YYYY-MM-DD}}(偏移 d/w/m/y,正负都行)。',
  '',
  '## ',
  '',
].join('\n')

// ── 中英双语词表(zh/en 两侧键集合必须完全相等,check.mjs 有断言) ──────────────
// 翻的只有 UI 文案。**用户数据与一切路径绝不随语言变**:Templates 默认值 / 工作文件夹「模板库」/
// 未命名笔记 / 未命名模板 / .note-templates.json / 模板脚手架正文 / 全部贡献点 id。
// 占位符一律 {name} 形式(英文语序与中文不同,不能靠模板串拼)。
// 列表分隔符按语言取(listSep),别把中文顿号拼进英文句;计数走 countLabel —— 它装的是**整个计数
// 短语**(「共 3」/「3 template(s)」)而不是裸数字,所以两侧语序各写各的,也不硬套复数。
const MSG = {
  zh: {
    listSep: '、',
    appName: '模板库',
    viewTitle: '模板库',
    cmdOpen: '模板库:打开',
    cmdNew: '模板库:从模板新建笔记',
    slashLabel: '模板',
    slashHint: '从模板库插入一段结构',
    creatorLabel: '从模板新建',
    settingFolder: '模板文件夹',
    settingFolderDesc: '库内相对路径;这个文件夹里的每一篇笔记都是一个模板(含子文件夹)。留空或填库根会被拒绝并回退到 Templates。',
    settingAsk: '同名时先问我',
    settingAskDesc: '关:自动另存为「名字 2」「名字 3」并提示。开:弹出改名框。任何情况下都不会覆盖已有文件。',
    recentHeading: '最近使用',
    listHeading: '全部模板',
    searchPlaceholder: '搜索模板…',
    countLabel: '共 {c}',
    btnRescan: '重新扫描',
    btnNewTemplate: '新建一个模板',
    btnCreate: '用它新建',
    btnInsert: '插进当前笔记',
    previewTitle: '预览(变量已代入)',
    empty: '模板库还是空的',
    emptyHint: '把一篇写好骨架的普通笔记放进 {folder}/ 就行 —— 不需要任何特殊格式。',
    noEnum: '当前环境不支持枚举笔记库,列不出模板。请在桌面端打开一个笔记库后再试。',
    noActivePage: '先在编辑器里打开一篇笔记,才能往里插模板',
    hostTooOld: '宿主版本过旧,不支持工作台视图',
    pickerTitle: '选一个模板',
    pickerPlaceholder: '打字过滤,↑↓ 选择,Enter 确认,Esc 取消',
    pickerEmpty: '没有匹配的模板',
    promptNewTitle: '新笔记的名字',
    promptNewLabel: '会建在 {folder}',
    promptTplTitle: '新模板的名字',
    createdOk: '已建好:{path}',
    createdRenamed: '同名已存在,已另存为:{path}',
    insertedOk: '已插入:{name}',
    errTplGone: '模板不见了:{path}',
    errReadTpl: '读不到模板:{path}(读失败,不是不存在)',
    errProbe: '读不到目标文件,无法确认它是不是已经存在:{path} —— 已中止,没有写入任何内容',
    errWrite: '写入失败:{msg}',
    errTooLong: '这份模板有 {n} 个字符,超过宿主斜杠插入的 8192 上限,没有插入。请改用「从模板新建」,或把模板拆小。',
    errCtrlChar: '这份模板里有控制字符(制表与换行除外),宿主会拒绝插入。已中止,模板文件本身没有被改动。',
    errVerify: '写完读回来的内容对不上,已中止:{path}(没有打开它,也没有记进最近使用)',
    errInsert: '插入失败:当前没有可写入的笔记编辑器,或页面已经切走了',
    errNoName: '这个名字里没有可用字符,已改用默认名',
    errBadPath: '这个路径不合法(不能越出笔记库)',
    errTooMany: '同名文件太多了(已经试到 {c} 号),请换个名字',
    errActivePage: '目标正是你此刻打开的那篇笔记,已中止 —— 绝不覆盖你正在编辑的内容',
    warnRootFolder: '模板文件夹设置不合法(不能是库根或越界路径),已回退到 {folder}',
    warnTooBroad: '这个文件夹里有 {n} 篇笔记,只列出前 {c} 篇。把模板收进一个更小的文件夹会更好用。',
    mruUnreadable: '读不出已保存的「最近使用」记录,记录最近使用先停用,也不会保存改动,原来的记录没有动。这次用到的模板只在本次运行里列进「最近使用」,重启后不会留下。',
  },
  en: {
    listSep: ', ',
    appName: 'Note Templates',
    viewTitle: 'Note Templates',
    cmdOpen: 'Note Templates: Open',
    cmdNew: 'Note Templates: New from Template',
    slashLabel: 'Template',
    slashHint: 'Insert a structure from your template library',
    creatorLabel: 'New from Template',
    settingFolder: 'Templates folder',
    settingFolderDesc: 'A vault-relative path. Every note in this folder (subfolders included) is a template. Leaving it empty or pointing it at the vault root is refused and falls back to Templates.',
    settingAsk: 'Ask me when the name is taken',
    settingAskDesc: 'Off: saves as "Name 2", "Name 3" and tells you. On: opens a rename box. It never overwrites a file you already have.',
    recentHeading: 'Recent',
    listHeading: 'All templates',
    searchPlaceholder: 'Search templates…',
    countLabel: '{c} template(s)',
    btnRescan: 'Rescan',
    btnNewTemplate: 'New template',
    btnCreate: 'New note from this',
    btnInsert: 'Insert into current note',
    previewTitle: 'Preview (variables filled in)',
    empty: 'No templates yet',
    emptyHint: 'Drop an ordinary note with your skeleton into {folder}/ — no special format needed.',
    noEnum: 'This environment cannot enumerate the vault, so templates cannot be listed. Open a vault in the desktop app and try again.',
    noActivePage: 'Open a note in the editor first, then a template can be inserted into it',
    hostTooOld: 'This host is too old to open workbench views',
    pickerTitle: 'Pick a template',
    pickerPlaceholder: 'Type to filter, ↑↓ to move, Enter to confirm, Esc to cancel',
    pickerEmpty: 'No matching template',
    promptNewTitle: 'Name for the new note',
    promptNewLabel: 'It will be created in {folder}',
    promptTplTitle: 'Name for the new template',
    createdOk: 'Created: {path}',
    createdRenamed: 'That name was taken, so it was saved as: {path}',
    insertedOk: 'Inserted: {name}',
    errTplGone: 'That template is gone: {path}',
    errReadTpl: 'Could not read the template: {path} (a read failure, not a missing file)',
    errProbe: 'Could not read the target file, so whether it already exists is unknown: {path} — aborted, nothing was written',
    errWrite: 'Write failed: {msg}',
    errTooLong: 'This template is {n} characters, over the host slash-insert limit of 8192, so nothing was inserted. Use "New from template" instead, or split the template up.',
    errCtrlChar: 'This template contains control characters (other than tab and newline); the host refuses to insert it. Aborted — the template file itself was not touched.',
    errVerify: 'What came back after writing does not match, so it was aborted: {path} (it was not opened and not added to Recent)',
    errInsert: 'Insert failed: there is no writable note editor right now, or the page has already moved on',
    errNoName: 'That name has no usable characters, so the default name was used instead',
    errBadPath: 'That path is not allowed (it cannot escape the vault)',
    errTooMany: 'Too many files share that name (tried up to {c}). Please pick another name',
    errActivePage: 'The target is the very note you have open right now, so it was aborted — what you are editing is never overwritten',
    warnRootFolder: 'The templates folder setting is not valid (it cannot be the vault root or escape the vault), so it fell back to {folder}',
    warnTooBroad: 'That folder holds {n} notes; only the first {c} are listed. Templates are easier to use in a smaller folder.',
    mruUnreadable: 'Your saved list of recently used templates could not be read. Remembering recent templates is paused and nothing will be saved, so the original list is left as it was. Templates you use now show under Recent for this session only.',
  },
}

// ═══════════════════════════════════════════════════════════════════════════════
//  纯函数(全部经文末 __NOTE_TEMPLATES_TEST__ 暴露,check.mjs 逐向量断言)
// ═══════════════════════════════════════════════════════════════════════════════

const pad2 = (n) => (n < 10 ? '0' + n : String(n))

/** formatDate(d, fmt) —— 只认 YYYY MM DD HH mm ss 六个 token,**单趟正则**(替进去的数字不会被再吃一遍)。 */
function formatDate(d, fmt) {
  const map = {
    YYYY: String(d.getFullYear()),
    MM: pad2(d.getMonth() + 1),
    DD: pad2(d.getDate()),
    HH: pad2(d.getHours()),
    mm: pad2(d.getMinutes()),
    ss: pad2(d.getSeconds()),
  }
  return String(fmt == null ? '' : fmt).replace(/YYYY|MM|DD|HH|mm|ss/g, (m) => map[m])
}

/** shiftDate(base, n, unit) —— **正午锚定**(DST 三定式):裸 +86400000ms 在秋退日只会走到
 *  11-01T23:00,日期原地不动 = 经典 DST bug。月/年位移钳到目标月最后一天,不许 JS 默认的溢出翻月。 */
function shiftDate(base, n, unit) {
  const y = base.getFullYear()
  const mo = base.getMonth()
  const da = base.getDate()
  const k = Number(n) || 0
  if (unit === 'd') return new Date(y, mo, da + k, 12, 0, 0, 0)
  if (unit === 'w') return new Date(y, mo, da + k * 7, 12, 0, 0, 0)
  if (unit === 'm' || unit === 'y') {
    const anchor = unit === 'm' ? new Date(y, mo + k, 1, 12, 0, 0, 0) : new Date(y + k, mo, 1, 12, 0, 0, 0)
    const ty = anchor.getFullYear()
    const tm = anchor.getMonth()
    const last = new Date(ty, tm + 1, 0, 12, 0, 0, 0).getDate()
    return new Date(ty, tm, Math.min(da, last), 12, 0, 0, 0)
  }
  return new Date(y, mo, da, 12, 0, 0, 0)
}

const OFFSET_RE = /^([+-]\d+)([dwmy])$/
const OFFSET_LOOKS = /^[+-]\d/
const KNOWN_VARS = { date: 1, time: 1, title: 1, cursor: 1 }

/** parseVar(inner) —— `{{` 与 `}}` 之间那段。**未知一律 null**(调用方原样保留,绝不吃掉用户文本)。
 *  切分靠 split(':') + 判偏移 + 余下 join(':') 还原,所以 `{{date:+1d:HH:mm}}` 里格式的冒号不丢。 */
function parseVar(inner) {
  const s = String(inner == null ? '' : inner)
  const p = s.split(':')
  const kind = p[0]
  if (!Object.prototype.hasOwnProperty.call(KNOWN_VARS, kind)) return null
  let off = null
  let rest
  if (p.length > 1 && OFFSET_LOOKS.test(p[1])) {
    const m = OFFSET_RE.exec(p[1])
    if (!m) return null // 看着像偏移但单位不认 → 整条不认,原样保留
    off = { n: parseInt(m[1], 10), unit: m[2] }
    rest = p.slice(2)
  } else {
    rest = p.slice(1)
  }
  const fmt = rest.join(':') || null
  return { kind, off, fmt }
}

const VAR_RE = /\{\{([^{}\r\n]*)\}\}/g

/** renderTemplate(raw, {title, now}) —— **单趟正则**一次扫完,回调里算值。
 *  这是全插件最关键的一条纪律,与 t() 的占位符替换同源:分多趟(或先替 date 再替 title)会让先替
 *  进去的值被后面的轮次再吃一遍 —— 用户把笔记命名成 `{{date}}` 时他自己的标题就被当占位符吃掉。 */
function renderTemplate(raw, opts) {
  const o = opts || {}
  const now = new Date(o.now != null ? o.now : Date.now())
  const title = o.title != null ? String(o.title) : ''
  return String(raw == null ? '' : raw).replace(VAR_RE, (m, inner) => {
    const v = parseVar(inner)
    if (!v) return m
    if (v.kind === 'cursor') return ''
    if (v.kind === 'title') return title
    const anchor = v.off ? shiftDate(now, v.off.n, v.off.unit) : now
    // 日期部分取位移后的 Y/M/D,时分秒恒取真实 now 的
    const d = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate(), now.getHours(), now.getMinutes(), now.getSeconds(), 0)
    return formatDate(d, v.fmt || (v.kind === 'date' ? 'YYYY-MM-DD' : 'HH:mm'))
  })
}

/** splitFrontmatter(raw) —— 只认**文件开头第 0 字节**的 `---\n … \n---`(闭合必须在行首)。 */
function splitFrontmatter(raw) {
  const s = String(raw == null ? '' : raw)
  if (s.slice(0, 4) !== '---\n' && s.slice(0, 5) !== '---\r\n') return { fm: null, body: s }
  const lines = s.split('\n')
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---' || lines[i] === '---\r') {
      return { fm: lines.slice(0, i + 1).join('\n'), body: lines.slice(i + 1).join('\n') }
    }
  }
  return { fm: null, body: s }
}

const MARKER_LINE_RE = /^[ \t]*<!--\s*\/?a\s+[A-Za-z0-9_-]+\s*-->[ \t]*\r?\n?/gm
const MARKER_INLINE_RE = /<!--\s*\/?a\s+[A-Za-z0-9_-]+\s*-->/g

/** stripMarkers(text) —— 去掉 Amadeus 块标记 / 闭合锚。整行形态连同换行一起删,行内形态替成 ''。
 *  ⚠️ 只在**插入路线**上做:锚点键与目标笔记的键空间冲突是毁档类。新建路线必须保留。 */
function stripMarkers(text) {
  return String(text == null ? '' : text).replace(MARKER_LINE_RE, '').replace(MARKER_INLINE_RE, '')
}

/** 一行里:保留行首缩进,把缩进之后的连续空格压成一个,但跳过反引号行内 code span。 */
function collapseRunsOutsideCode(line) {
  const indent = /^[ \t]*/.exec(line)[0]
  const rest = line.slice(indent.length)
  let out = ''
  let i = 0
  while (i < rest.length) {
    const start = rest.indexOf('`', i)
    if (start < 0) {
      out += rest.slice(i).replace(/ {2,}/g, ' ')
      break
    }
    out += rest.slice(i, start).replace(/ {2,}/g, ' ')
    let n = 0
    while (rest[start + n] === '`') n++
    let fence = ''
    for (let k = 0; k < n; k++) fence += '`'
    const close = rest.indexOf(fence, start + n)
    if (close < 0) {
      out += rest.slice(start).replace(/ {2,}/g, ' ')
      break
    }
    out += rest.slice(start, close + n) // code span 原样
    i = close + n
  }
  return indent + out
}

/** sanitizeForInsert(md) —— 保证插进去的 markdown 能**原样往返**(连续空格被宿主压掉 → 宿主重载
 *  整篇 → 插件状态全没)。围栏代码块内整段不动;行首缩进保留;行尾空白清掉
 *  (markdown 的「两空格硬换行」因此降级为软换行 —— 有意的、有损但安全的取舍,README 写了)。 */
function sanitizeForInsert(md) {
  const s = String(md == null ? '' : md).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const lines = s.split('\n')
  const out = []
  let fence = null
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const fm = /^[ \t]*(```+|~~~+)/.exec(raw)
    if (fence) {
      out.push(raw)
      if (fm && fm[1][0] === fence[0] && fm[1].length >= fence.length) fence = null
      continue
    }
    if (fm) {
      fence = fm[1]
      out.push(raw.replace(/[ \t]+$/, ''))
      continue
    }
    out.push(collapseRunsOutsideCode(raw).replace(/[ \t]+$/, ''))
  }
  let a = 0
  let b = out.length
  while (a < b && out[a].trim() === '') a++
  while (b > a && out[b - 1].trim() === '') b--
  return out.slice(a, b).join('\n')
}

/** candidatePath(path, n) —— 在**最后一个** `.md` 之前插入 ` <n>`。 */
function candidatePath(p, n) {
  const s = String(p == null ? '' : p)
  const i = s.lastIndexOf('.md')
  if (i < 0) return s + ' ' + n + '.md'
  return s.slice(0, i) + ' ' + n + s.slice(i)
}

/** normalizeFolder(input, fallback) —— 库根防呆:空串 / `.` / `..` / 任何 `..` 段 / 盘符 一律拒绝
 *  并回退 fallback。把模板夹设成库根 = 整库笔记都被当模板,这是本插件最大的风险之一。 */
function normalizeFolder(input, fallback) {
  const fb = String(fallback == null ? DEFAULT_TPL_FOLDER : fallback)
  const rawTrim = String(input == null ? '' : input).trim()
  let s = rawTrim.replace(/\\/g, '/')
  s = s.replace(/\/{2,}/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
  const segs = s.split('/')
  const bad =
    s === '' ||
    /^[A-Za-z]:/.test(rawTrim) ||
    /^[A-Za-z]:/.test(s) ||
    segs.some((seg) => seg === '' || seg === '.' || seg === '..')
  if (bad) return { folder: fb, refused: true }
  return { folder: s, refused: false }
}

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** isUnderFolder(path, folder) —— **大小写不敏感**前缀匹配 `^<folder>/`。
 *  与宿主内置的 /^templates\//i 同口径:两套共用同一批模板文件,不会分裂成两个库。 */
function isUnderFolder(p, folder) {
  const f = String(folder == null ? '' : folder).replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
  if (!f) return false
  const target = String(p == null ? '' : p).replace(/\\/g, '/').replace(/^\/+/, '')
  return new RegExp('^' + escapeRe(f) + '/', 'i').test(target)
}

/** sanitizeFileName(name) —— 去掉 / \ : * ? " < > | 与控制字符,压掉连续空格,去掉开头的 `.`,截断 120。 */
function sanitizeFileName(name) {
  let s = String(name == null ? '' : name)
  s = s.replace(/[/\\:*?"<>|]/g, '')
  s = s.replace(/[\u0000-\u001f\u007f]/g, '')
  s = s.trim().replace(/\s+/g, ' ')
  s = s.replace(/^\.+/, '').trim()
  if (s.length > 120) s = s.slice(0, 120).trim()
  return s
}

const PATH_ESCAPE_RE = /(^|\/)\.\.(\/|$)/

/** resolveTarget(input, baseFolder) —— 产出 vault 相对、以 `.md` 结尾的路径;非法返回 null。
 *  这是我们**自己的防线**,不指望 readFile 返回 null 帮我们区分「不存在」和「越界」—— 那正是
 *  三态判定成立的前提。 */
function resolveTarget(input, baseFolder) {
  const s = String(input == null ? '' : input).replace(/\\/g, '/')
  if (!s.trim()) return null
  let segs
  if (s.charAt(0) === '/') segs = s.replace(/^\/+/, '').split('/')
  else if (s.indexOf('/') >= 0) segs = s.split('/')
  else {
    const base = String(baseFolder == null ? '' : baseFolder).replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
    segs = base ? base.split('/').concat([s]) : [s]
  }
  const clean = []
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]
    if (seg === '') continue
    if (seg === '.' || seg === '..') return null
    const c = sanitizeFileName(seg)
    if (!c) return null
    clean.push(c)
  }
  if (!clean.length) return null
  const lastIdx = clean.length - 1
  if (!/\.md$/i.test(clean[lastIdx])) clean[lastIdx] = clean[lastIdx] + '.md'
  const out = clean.join('/')
  if (PATH_ESCAPE_RE.test(out)) return null
  return out
}

const baseNoExt = (p) => {
  if (!p) return ''
  const b = String(p).replace(/\\/g, '/').split('/').pop() || ''
  return b.replace(/\.md$/i, '')
}

/** buildForInsert(raw, pagePath) —— **插入路线**。顺序钉死:
 *  剥 frontmatter → 代入变量 → 剥标记 → 空格归一。 */
function buildForInsert(raw, pagePath) {
  return sanitizeForInsert(
    stripMarkers(renderTemplate(splitFrontmatter(raw).body, { title: baseNoExt(pagePath), now: Date.now() })),
  )
}

const normPath = (p) => String(p == null ? '' : p).replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
const samePath = (a, b) => {
  const x = normPath(a)
  const y = normPath(b)
  return !!x && x.toLowerCase() === y.toLowerCase()
}

// ═══════════════════════════════════════════════════════════════════════════════
//  样式(只吃宿主 token,一律带回退值;旧文档里那个 secondary token 不存在,次级文字一律 --text-muted)
// ═══════════════════════════════════════════════════════════════════════════════
const STYLE = `
.ntp-root { color: inherit; display: flex; flex-direction: column; height: 100%; min-height: 0; box-sizing: border-box;
  font-size: 14px; line-height: 1.6; background: var(--bg, transparent); }
.ntp-root * { box-sizing: border-box; }
.ntp-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 12px 16px;
  border-bottom: 1px solid var(--border, rgba(128,128,128,.25)); }
.ntp-search { flex: 1 1 180px; min-width: 120px; padding: 6px 10px; font: inherit; color: inherit;
  background: var(--bg-card, transparent); border: 1px solid var(--border, rgba(128,128,128,.35));
  border-radius: var(--radius-sm); outline: none; }
.ntp-search:focus { border-color: var(--accent, #4a7dff); }
.ntp-count { color: var(--text-muted, #888); font-size: 12px; white-space: nowrap; }
.ntp-btn { padding: 6px 12px; font: inherit; font-size: 13px; color: inherit; cursor: pointer; white-space: nowrap;
  background: var(--bg-card, transparent); border: 1px solid var(--border, rgba(128,128,128,.35));
  border-radius: var(--radius-sm); }
.ntp-btn:hover:not(:disabled) { border-color: var(--accent, #4a7dff); }
.ntp-btn:disabled { opacity: .45; cursor: default; }
.ntp-btn.primary { background: var(--accent, #4a7dff); color: var(--on-accent, #f7f7f7);
  border-color: var(--accent, #4a7dff); }
.ntp-btn.primary:hover:not(:disabled) { background: var(--accent-hover, var(--accent, #4a7dff)); }
.ntp-warn { margin: 8px 16px 0; padding: 8px 10px; font-size: 12px; border-radius: var(--radius-md);
  color: var(--text, inherit); background: var(--accent-light, rgba(128,128,128,.12));
  border: 1px solid var(--border, rgba(128,128,128,.25)); }
.ntp-body { display: flex; flex: 1 1 auto; min-height: 0; gap: 0; flex-wrap: wrap; align-items: stretch; }
.ntp-list { flex: 1 1 240px; min-width: 200px; max-width: 380px; overflow-y: auto; padding: 8px 8px 16px;
  border-right: 1px solid var(--border, rgba(128,128,128,.25)); }
.ntp-side { flex: 2 1 320px; min-width: 240px; display: flex; flex-direction: column; min-height: 0; }
.ntp-head { padding: 10px 16px 6px; font-size: 12px; color: var(--text-muted, #888); }
.ntp-group { margin: 4px 4px 12px; font-size: 11px; letter-spacing: .04em; color: var(--text-faint, var(--text-muted, #999)); }
.ntp-item { display: block; width: 100%; text-align: left; padding: 7px 10px; margin-bottom: 2px; font: inherit;
  font-size: 13px; color: inherit; cursor: pointer; border: 1px solid transparent; border-radius: var(--radius-sm);
  background: transparent; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ntp-item:hover { background: var(--bg-card, rgba(128,128,128,.08)); }
.ntp-item.sel { background: var(--accent-light, rgba(128,128,128,.16)); color: var(--accent, inherit); font-weight: 600; }
.ntp-empty { padding: 24px 16px; color: var(--text-muted, #888); font-size: 13px; }
.ntp-empty b { display: block; margin-bottom: 6px; color: var(--text, inherit); font-size: 14px; }
.ntp-prev { flex: 1 1 auto; min-height: 0; overflow-y: auto; margin: 0 16px; padding: 14px 16px;
  background: var(--bg-card, transparent); border: 1px solid var(--border, rgba(128,128,128,.25));
  border-radius: var(--radius-md); box-shadow: var(--card-shadow, none); }
.ntp-acts { display: flex; gap: 8px; flex-wrap: wrap; padding: 12px 16px; }
.ntp-h { font-weight: 700; margin: 10px 0 4px; }
.ntp-h[data-level="1"] { font-size: 20px; }
.ntp-h[data-level="2"] { font-size: 17px; }
.ntp-h[data-level="3"] { font-size: 15px; }
.ntp-h[data-level="4"], .ntp-h[data-level="5"], .ntp-h[data-level="6"] { font-size: 14px; color: var(--text-muted, #888); }
.ntp-p { margin: 2px 0; white-space: pre-wrap; word-break: break-word; }
.ntp-li { margin: 2px 0; white-space: pre-wrap; word-break: break-word; }
.ntp-quote { margin: 4px 0; padding-left: 10px; color: var(--text-muted, #888);
  border-left: 3px solid var(--border, rgba(128,128,128,.35)); white-space: pre-wrap; }
.ntp-code { margin: 6px 0; padding: 8px 10px; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px;
  white-space: pre-wrap; word-break: break-word; background: var(--bg-glass, rgba(128,128,128,.1));
  border-radius: var(--radius-sm); }
.ntp-hr { height: 1px; margin: 10px 0; background: var(--border, rgba(128,128,128,.35)); }
.ntp-gap { height: 8px; }
.ntp-layer { position: fixed; inset: 0; z-index: 9000; pointer-events: none; display: flex;
  align-items: flex-start; justify-content: center; }
.ntp-layer > * { pointer-events: auto; }
.ntp-scrim { position: absolute; inset: 0; background: rgba(0,0,0,.28); }
.ntp-pop { position: relative; width: min(520px, 88vw); max-height: 66vh; margin-top: 12vh; display: flex;
  flex-direction: column; color: var(--text, inherit); background: var(--bg-card, #ffffff);
  border: 1px solid var(--border, rgba(128,128,128,.35)); border-radius: var(--radius-lg);
  box-shadow: var(--card-shadow, 0 12px 40px rgba(0,0,0,.28)); overflow: hidden; }
.ntp-pop-h { padding: 12px 14px 8px; font-size: 13px; font-weight: 600; }
.ntp-pop-in { margin: 0 14px 10px; padding: 7px 10px; font: inherit; color: inherit;
  background: var(--bg, transparent); border: 1px solid var(--border, rgba(128,128,128,.35));
  border-radius: var(--radius-sm); outline: none; }
.ntp-pop-in:focus { border-color: var(--accent, #4a7dff); }
.ntp-pop-list { overflow-y: auto; padding: 0 8px 10px; }
.ntp-pop-row { display: block; width: 100%; text-align: left; padding: 8px 10px; font: inherit; font-size: 13px;
  color: inherit; cursor: pointer; background: transparent; border: 1px solid transparent;
  border-radius: var(--radius-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ntp-pop-row.cur { background: var(--accent-light, rgba(128,128,128,.18)); color: var(--accent, inherit); }
.ntp-pop-empty { padding: 16px 14px; color: var(--text-muted, #888); font-size: 13px; }
`

// ═══════════════════════════════════════════════════════════════════════════════
//  DOM 小工具 + 预览渲染器(零 HTML 字符串注入,全程 createElement + textContent)
// ═══════════════════════════════════════════════════════════════════════════════
function h(tag, cls, text) {
  const el = document.createElement(tag)
  if (cls) el.className = cls
  if (text != null) el.textContent = text
  return el
}

/** renderPreview(el, md) —— 逐行轻量渲染,**行内 markdown 一律不解析**(原样文本)。
 *  这既是安全设计(不可能注入),也是诚实预览:用户看到的就是要插进去的字符。 */
function renderPreview(el, md) {
  el.textContent = ''
  const lines = String(md == null ? '' : md).split('\n')
  let fence = null
  let buf = null
  const flush = () => {
    if (buf == null) return
    el.appendChild(h('pre', 'ntp-code', buf.join('\n')))
    buf = null
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fm = /^[ \t]*(```+|~~~+)/.exec(line)
    if (fence) {
      if (fm && fm[1][0] === fence[0] && fm[1].length >= fence.length) {
        flush()
        fence = null
      } else if (buf) buf.push(line)
      continue
    }
    if (fm) {
      fence = fm[1]
      buf = []
      continue
    }
    if (!line.trim()) {
      el.appendChild(h('div', 'ntp-gap'))
      continue
    }
    const hm = /^(#{1,6})\s+(.*)$/.exec(line)
    if (hm) {
      const node = h('div', 'ntp-h', hm[2])
      node.setAttribute('data-level', String(hm[1].length))
      el.appendChild(node)
      continue
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      el.appendChild(h('div', 'ntp-hr'))
      continue
    }
    if (/^\s*>\s?/.test(line)) {
      el.appendChild(h('div', 'ntp-quote', line.replace(/^\s*>\s?/, '')))
      continue
    }
    const lm = /^(\s*)([-*+]\s+|\d+[.)]\s+)(.*)$/.exec(line)
    if (lm) {
      const node = h('div', 'ntp-li', lm[2].trim() + ' ' + lm[3])
      node.style.paddingLeft = 8 + lm[1].replace(/\t/g, '    ').length * 8 + 'px'
      el.appendChild(node)
      continue
    }
    el.appendChild(h('div', 'ntp-p', line))
  }
  flush()
  return el
}

// ═══════════════════════════════════════════════════════════════════════════════
//  运行期状态
// ═══════════════════════════════════════════════════════════════════════════════
let locale = (ctx.getLocale ? ctx.getLocale() : null) || 'zh'
const t = (k, vars) => {
  const d = MSG[locale] || MSG.zh
  const s = d[k] != null ? d[k] : MSG.zh[k] != null ? MSG.zh[k] : k
  // ⚠️ 必须**单趟**正则替换,未知键原样留着。逐个 split/join 是错的:先替进去的值会被后面的轮次
  // 再扫一遍 —— 用户把模板命名成 `{c}` 之类,他自己的数据就会被当占位符吃掉。
  return vars ? s.replace(/\{(\w+)\}/g, (m, key) => (key in vars ? String(vars[key]) : m)) : s
}

let disposed = false
let templates = [] // vault 相对路径,已按 localeCompare 升序
let enumSupported = true
let totalFound = 0
let warnedRootFolder = false
let mru = { v: 1, recent: [] }
let mruMemoryOnly = false
// 存过却读不出来(宿主 2026-11-17 起 loadData reject,code = 'plugin-data-unreadable':读出错 / 零字节 / 写到一半 / 被手改坏):
// 以前落到 sidecar / 空 MRU 接着用,下一次用模板就把存着的「最近使用」整份盖掉。现在本次运行里只记在内存、
// 不调 saveData 也不写 sidecar(不读 sidecar:那是旧宿主时代的另一份,拿它顶上会让人以为原来的回来了),提示一次;下次启动再读。
// 没存过(null)照旧去读 sidecar;旧宿主读不出来也回 null;别的读错误照旧落到 sidecar。
// 不拿 mruMemoryOnly 当闸:它在 sidecar 正被打开 / 写失败时也会置上,那两种情况之后还要接着试着写。
let mruUnreadable = false
const isDataUnreadable = (e) => !!e && typeof e === 'object' && e.code === 'plugin-data-unreadable'
let mruLoading = null // 启动那次读 MRU 还没回来时 = 它的 promise;没回来之前的 pushRecent 排在它后面(见 pushRecent)
let mruEarly = [] // 启动那次读回来之前用过的模板(按先后),读完一并记
let pickOverride = null // 仅 check.mjs 注入(生产环境 __NOTE_TEMPLATES_TEST__ 不存在 → 恒 null)
const watchers = []
const rerenders = new Set() // 已挂载视图的重画函数
let closeActivePicker = null

const say = (msg, opts) => {
  try {
    if (ctx.notify) {
      ctx.notify(msg, opts || {})
      return
    }
  } catch (e) {
    /* 通知面不该连坐主流程 */
  }
  try {
    if (ctx.app && ctx.app.notify) ctx.app.notify(msg)
  } catch (e) {
    /* 同上 */
  }
}

const readSetting = (key) => {
  try {
    return localStorage.getItem('plugin.' + PLUGIN_ID + '.' + key)
  } catch (e) {
    return null
  }
}

const workFolder = () => {
  try {
    return (ctx.app.workFolder ? ctx.app.workFolder() : '') || DEFAULT_WORK_FOLDER
  } catch (e) {
    return DEFAULT_WORK_FOLDER
  }
}

const tplFolderInfo = () => {
  const raw = readSetting('folder')
  if (raw == null) return { folder: DEFAULT_TPL_FOLDER, refused: false } // 没设过 ≠ 设成了空
  return normalizeFolder(raw, DEFAULT_TPL_FOLDER)
}

/** 取模板文件夹;设置不合法时回退 Templates 并**每会话只提示一次**(不刷屏)。 */
const tplFolder = () => {
  const info = tplFolderInfo()
  if (info.refused && !warnedRootFolder) {
    warnedRootFolder = true
    say(t('warnRootFolder', { folder: info.folder }), { level: 'warning' })
  }
  return info.folder
}

const askOnConflict = () => readSetting('askOnConflict') === 'true'

/** 唯一的读封装。三态,绝不折叠 —— 「读失败」当成「还没有文件」然后写一份新的 = 当场抹掉用户已有文件。 */
/**
 * 打开一篇**普通 .md 笔记**。
 * ⚠️ 不能用 ctx.app.openFile —— 宿主的 openFile 对「没有插件文件类型认领的」裸 .md 会回落到
 *    amadeus.openVaultFile(= 交给系统默认程序),新建的笔记会在 TextEdit 里弹出来。
 *    真源:desktop/frontend/src/amadeusNav.ts 的 openFile —— `if (!matchFileType(path)) openVaultFile(path)`。
 *    正解是 loadPage(宿主自己的新建路径就是 writeTextFile → refreshPages → loadPage)。
 * ⚠️ 顺序是安全约束:loadPage 对**不存在**的路径会落到主进程 newPage 凭空造出一篇 v3 笔记,
 *    所以只允许在「已确认存在」或「写盘并读回校验成功之后」调用。
 * 旧宿主没有 loadPage 时才退回 openFile(那种宿主上没有更好的路)。
 */
/**
 * 宿主对 registerSlashItem 的 run() 返回值有三道**硬闸**,任一不过直接 throw,错误会冒到宿主的
 * 斜杠处理里(真源:desktop/frontend/src/amadeus/unified/UnifiedPage.tsx:412-419):
 *   ① 必须是字符串  ② 长度 ≤ 8192  ③ 不含控制字符(放行 \t \n)
 * 我们自己先判,超限时**明说原因并返回 ''**(宿主对 '' 是安静不插入)。
 * ⚠️ 绝不静默截断 —— 插进去半份模板比不插更坏。
 */
/** 只判控制字符的那一半 —— `insertMarkdown` 没有长度上限,把 8192 那道闸带过去是**误闸**。
 *  宿主拒收控制字符的理由(UnifiedPage.tsx:414-419 的注释)是「NUL/控制字符会污染笔记文件」,
 *  这条对 `insertMarkdown` 这条写路径同样成立 —— 而它只判 token 与空串,没有任何内容闸。
 *  返回 true = 干净可插。 */
function ctrlCharClean(md) {
  for (const ch of String(md == null ? '' : md)) {
    const c = ch.charCodeAt(0)
    if (c < 32 && c !== 9 && c !== 10) {
      say(t('errCtrlChar'), { level: 'error' })
      return false
    }
  }
  return true
}
function guardSlashPayload(md) {
  if (typeof md !== 'string') return ''
  if (md.length > 8192) {
    say(t('errTooLong', { n: String(md.length) }), { level: 'error' })
    return ''
  }
  return ctrlCharClean(md) ? md : ''
}

function openNotePath(path) {
  try {
    if (ctx.app && typeof ctx.app.loadPage === 'function') { ctx.app.loadPage(path); return 'loadPage' }
    if (ctx.app && typeof ctx.app.openFile === 'function') { ctx.app.openFile(path); return 'openFile' }
  } catch (e) { /* 打开失败不影响已经落盘的产物 */ }
  return null
}

async function readFileSafe(p) {
  try {
    const s = await ctx.app.readFile(p)
    return s == null ? { kind: 'missing' } : { kind: 'ok', text: s }
  } catch (e) {
    return { kind: 'error', err: e }
  }
}

// ── MRU(派生物,可随时删) ─────────────────────────────────────────────────────
function normalizeMru(d) {
  const src = d && Array.isArray(d.recent) ? d.recent : []
  const seen = {}
  const out = []
  for (let i = 0; i < src.length; i++) {
    const p = src[i]
    if (typeof p !== 'string' || !p) continue
    if (Object.prototype.hasOwnProperty.call(seen, p)) continue
    seen[p] = 1
    out.push(p)
  }
  return { v: 1, recent: out.slice(0, MAX_RECENT) }
}

/** sidecar 路径;用户把它当笔记打开了 → 给 null(退回内存态,不报错)。 */
function sidecarPath() {
  const p = workFolder() + '/' + SIDECAR_NAME
  let active = null
  try {
    active = ctx.app.getActivePage ? ctx.app.getActivePage() : null
  } catch (e) {
    active = null
  }
  if (active && samePath(p, active)) return null
  return p
}

function loadMru() {
  const job = readMru()
    .catch(() => {
      /* 读 MRU 失败不该连坐启动 */
    })
    .then(() => {
      if (mruLoading === job) mruLoading = null
    })
  mruLoading = job
  return job
}

async function readMru() {
  mruUnreadable = false
  if (ctx.loadData) {
    try {
      const d = await ctx.loadData()
      if (d != null && typeof d === 'object') {
        mru = normalizeMru(d)
        return
      }
    } catch (e) {
      if (isDataUnreadable(e)) {
        mruUnreadable = true
        mruMemoryOnly = true
        if (!disposed) say(t('mruUnreadable'), { level: 'warning' })
        return
      }
      /* 别的读错误:落到 sidecar */
    }
  }
  const p = sidecarPath()
  if (!p) return
  const r = await readFileSafe(p)
  if (r.kind !== 'ok') return
  try {
    mru = normalizeMru(JSON.parse(r.text))
  } catch (e) {
    mru = { v: 1, recent: [] }
  }
}

async function saveMru() {
  if (mruUnreadable) {
    mruMemoryOnly = true // 存着的那份读不出来:一个字节都不写,saveData 和 sidecar 都不碰
    return
  }
  const blob = { v: 1, recent: mru.recent.slice(0, MAX_RECENT) }
  if (ctx.saveData) {
    try {
      await ctx.saveData(blob)
      return
    } catch (e) {
      /* 落到 sidecar */
    }
  }
  const p = sidecarPath()
  if (!p) {
    mruMemoryOnly = true
    return
  }
  try {
    await ctx.app.writeFile(p, JSON.stringify(blob, null, 2))
  } catch (e) {
    mruMemoryOnly = true // 丢一条 MRU 不是事故,不打扰用户
  }
}

function bumpRecent(p) {
  const next = [p]
  for (let i = 0; i < mru.recent.length; i++) if (mru.recent[i] !== p) next.push(mru.recent[i])
  mru = { v: 1, recent: next.slice(0, MAX_RECENT) }
}

async function pushRecent(p) {
  if (!p) return
  // 启动那次读还没回来:先排着,读完一并记、只存一次 —— 现在就写,写进去的是只有这一条的 MRU,存着的那份就被盖掉了;
  // 每条各存一次的话,几次保存同时在路上,后用的那条可能被先用的那份顶掉。
  // 不 await:读要是一直不回来,不能把「建好就打开 / 插进去之后的提示」也一起卡住
  if (mruLoading) {
    mruEarly.push(p)
    if (mruEarly.length === 1) void mruLoading.then(replayEarly)
    return
  }
  bumpRecent(p)
  await saveMru()
}

async function replayEarly() {
  if (mruLoading) {
    void mruLoading.then(replayEarly) // 又开始了一次读:等那一次
    return
  }
  const list = mruEarly
  mruEarly = []
  if (disposed || !list.length) return // 插件已经停用 / 重载:旧实例不再写,免得盖掉新实例存下的
  for (let i = 0; i < list.length; i++) bumpRecent(list[i])
  for (const fn of rerenders) {
    try {
      fn({}) // 开着的模板库里「最近使用」跟上
    } catch (e) {
      /* 重画出错不该挡住保存 */
    }
  }
  await saveMru()
}

// ── 模板枚举 ─────────────────────────────────────────────────────────────────
function clearWatchers() {
  while (watchers.length) {
    const off = watchers.pop()
    try {
      off()
    } catch (e) {
      /* 退订失败不该连坐 */
    }
  }
}

function attachWatchers() {
  clearWatchers()
  if (!ctx.app.watchFile) return
  for (let i = 0; i < templates.length; i++) {
    const p = templates[i]
    try {
      const off = ctx.app.watchFile(p, () => {
        if (disposed) return
        for (const fn of rerenders) fn({ refetch: p })
      })
      if (typeof off === 'function') watchers.push(off)
    } catch (e) {
      /* 单个文件挂不上不该连坐 */
    }
  }
}

/** 列举模板。⚠️ 只存路径名 —— 每次真正要用(插入 / 新建 / 预览)都现读一次,不缓存正文。
 *  listPages 缺席或给空数组 = 当前环境不支持枚举(BRIEF 口径),走 noEnum 降级而不是报错。 */
async function scanTemplates() {
  const folder = tplFolder()
  if (!ctx.app.listPages) {
    enumSupported = false
    templates = []
    totalFound = 0
    clearWatchers()
    return templates
  }
  let all = []
  try {
    all = (await ctx.app.listPages()) || []
  } catch (e) {
    all = []
  }
  if (!all.length) {
    enumSupported = false
    templates = []
    totalFound = 0
    clearWatchers()
    return templates
  }
  enumSupported = true
  const hits = []
  for (let i = 0; i < all.length; i++) {
    const p = all[i]
    if (typeof p !== 'string') continue
    if (!/\.md$/i.test(p)) continue
    if (!isUnderFolder(p, folder)) continue
    hits.push(p)
  }
  hits.sort((a, b) => a.localeCompare(b))
  totalFound = hits.length
  templates = hits.slice(0, MAX_TEMPLATES)
  attachWatchers()
  return templates
}

const relLabel = (p, folder) => String(p).slice(String(folder).length + 1)

/** MRU 段:按 recent 顺序取列表里**还存在**的,最多 3 条。 */
function recentInList() {
  const out = []
  for (let i = 0; i < mru.recent.length && out.length < MAX_MRU_SHOWN; i++) {
    if (templates.indexOf(mru.recent[i]) >= 0) out.push(mru.recent[i])
  }
  return out
}

// ═══════════════════════════════════════════════════════════════════════════════
//  写路径:七步流程(三态探测 → 同名另存 → 活动页硬闸 → 写 + 读回自校验 → 落 MRU)
// ═══════════════════════════════════════════════════════════════════════════════

/** 探测目标是否可用。返回 {kind:'free',path} | {kind:'taken',suggest} | {kind:'error',path} | {kind:'toomany'} */
async function probeTarget(want, ask) {
  const first = await readFileSafe(want)
  if (first.kind === 'error') return { kind: 'error', path: want } // ⚠️ 读失败 ≠ 不存在,中止
  if (first.kind === 'missing') return { kind: 'free', path: want }
  for (let n = 2; n <= MAX_RENAME_TRIES; n++) {
    const cand = candidatePath(want, n)
    const probe = await readFileSafe(cand)
    if (probe.kind === 'error') return { kind: 'error', path: cand }
    if (probe.kind === 'missing') return ask ? { kind: 'taken', suggest: cand } : { kind: 'free', path: cand }
  }
  return { kind: 'toomany' }
}

/**
 * 七步的第 2~7 步。`tplPath` 为 null 表示这是「新建一个模板」(产物是模板,不是笔记)。
 * `renderVars` = false 时正文逐字节原样落盘(新建模板脚手架走这条,理由见 TEMPLATE_SCAFFOLD 注释)。
 */
async function createFrom(raw, tplPath, baseFolder, initialName, promptTitleKey, fallbackName, renderVars) {
  // 2. 问名字
  let name
  try {
    name = await ctx.app.prompt(t(promptTitleKey), initialName, { label: t('promptNewLabel', { folder: baseFolder || '/' }) })
  } catch (e) {
    return null
  }
  if (name == null || !String(name).trim()) return null // 静默取消,不报错

  // 3. 定路径
  const asked = String(name).replace(/\\/g, '/')
  if (PATH_ESCAPE_RE.test(asked)) {
    say(t('errBadPath'), { level: 'error' })
    return null
  }
  let want = resolveTarget(asked, baseFolder)
  if (!want) {
    // 名字里没有一个可用字符(例如全是 `...`)→ 用钉死的中文默认名,不报错退出
    say(t('errNoName'), { level: 'warning' })
    want = resolveTarget(fallbackName, baseFolder)
    if (!want) {
      say(t('errBadPath'), { level: 'error' })
      return null
    }
  }

  // 4. 三态探测 + 同名策略(askOnConflict 模式下用户改完**重新走第 3~5 步**)
  let final = null
  let renamed = false
  for (let round = 0; round < MAX_ASK_ROUNDS; round++) {
    const pr = await probeTarget(want, askOnConflict())
    if (pr.kind === 'error') {
      say(t('errProbe', { path: pr.path }), { level: 'error' })
      return null
    }
    if (pr.kind === 'toomany') {
      say(t('errTooMany', { c: MAX_RENAME_TRIES }), { level: 'error' })
      return null
    }
    if (pr.kind === 'free') {
      final = pr.path
      renamed = pr.path !== want
      break
    }
    let again
    try {
      again = await ctx.app.prompt(t(promptTitleKey), baseNoExt(pr.suggest), { label: t('promptNewLabel', { folder: baseFolder || '/' }) })
    } catch (e) {
      return null
    }
    if (again == null || !String(again).trim()) return null
    const nextAsked = String(again).replace(/\\/g, '/')
    if (PATH_ESCAPE_RE.test(nextAsked)) {
      say(t('errBadPath'), { level: 'error' })
      return null
    }
    const nx = resolveTarget(nextAsked, baseFolder)
    if (!nx) {
      say(t('errBadPath'), { level: 'error' })
      return null
    }
    want = nx
  }
  if (!final) return null

  // 5. 活动页硬闸(第二道:防 askOnConflict 模式下用户手打活动页名字而该文件恰被外部删掉)
  let active = null
  try {
    active = ctx.app.getActivePage ? ctx.app.getActivePage() : null
  } catch (e) {
    active = null
  }
  if (active && samePath(final, active)) {
    say(t('errActivePage'), { level: 'error' })
    return null
  }

  // 6. 写 + 读回自校验(⚠️ title 用**改名后**的最终 basename)
  const body = renderVars === false ? String(raw) : renderTemplate(raw, { title: baseNoExt(final), now: Date.now() })
  try {
    await ctx.app.writeFile(final, body)
  } catch (e) {
    say(t('errWrite', { msg: String((e && e.message) || e) }), { level: 'error' })
    return null
  }
  const back = await readFileSafe(final)
  if (back.kind !== 'ok' || back.text !== body) {
    // ⚠️ 不 openFile、不进 MRU —— 失败绝不记成功,下一轮还能重来
    say(t('errVerify', { path: final }), { level: 'error' })
    return null
  }

  // 7. 成功
  if (tplPath) await pushRecent(tplPath)
  openNotePath(final)
  try {
    if (ctx.activity) {
      if (tplPath) ctx.activity.log('create', { tpl: tplPath, path: final })
      else ctx.activity.log('new-template', { path: final })
    }
  } catch (e) {
    /* 埋点不该连坐 */
  }
  if (renamed) say(t('createdRenamed', { path: final }), { level: 'warning' })
  else say(t('createdOk', { path: final }), { level: 'success' })
  for (const fn of rerenders) fn({})
  return final
}

/** 完整七步:先现读模板(读失败 / 不存在都中止,一个字都不写)。 */
async function createFromTemplate(tplPath, baseFolder) {
  const r = await readFileSafe(tplPath)
  if (r.kind === 'error') {
    say(t('errReadTpl', { path: tplPath }), { level: 'error' })
    return null
  }
  if (r.kind === 'missing') {
    say(t('errTplGone', { path: tplPath }), { level: 'error' })
    return null
  }
  return await createFrom(r.text, tplPath, baseFolder, baseNoExt(tplPath), 'promptNewTitle', DEFAULT_NOTE_NAME, true)
}

/** 新建一个模板:同一套七步,只是 base = tplFolder、正文 = 钉死的脚手架、**不代入变量**。 */
async function createTemplate() {
  const folder = tplFolder()
  const p = await createFrom(TEMPLATE_SCAFFOLD, null, folder, DEFAULT_TEMPLATE_NAME, 'promptTplTitle', DEFAULT_TEMPLATE_NAME, false)
  if (p) await scanTemplates()
  for (const fn of rerenders) fn({})
  return p
}

/** 先选模板 → 再问名字(顺序钉死;反过来会让用户在还不知道用哪个模板时先起名)。 */
async function newFromTemplateFlow(baseFolder) {
  const tpl = await pickTemplate()
  if (!tpl) return null
  return await createFromTemplate(tpl, baseFolder)
}

// ═══════════════════════════════════════════════════════════════════════════════
//  模板选择浮层(不许挂裸 document.body —— 挂到最近的 .am-app)
// ═══════════════════════════════════════════════════════════════════════════════
function layerHost() {
  for (const fn of rerenders) {
    const el = fn.__root
    if (el && el.closest) {
      const app = el.closest('.am-app')
      if (app) return app
    }
  }
  if (typeof document !== 'undefined' && document.body && document.body.closest) {
    const app = document.body.closest('.am-app')
    if (app) return app
  }
  return document.body
}

async function pickTemplate() {
  if (pickOverride) return await pickOverride()
  await scanTemplates()
  if (!enumSupported) {
    say(t('noEnum'), { level: 'warning' })
    return null
  }
  if (!templates.length) {
    say(t('empty') + ' ' + t('emptyHint', { folder: tplFolder() }), { level: 'warning' })
    return null
  }
  if (closeActivePicker) closeActivePicker(null)

  const folder = tplFolder()
  const ordered = recentInList().concat(templates.filter((p) => recentInList().indexOf(p) < 0))

  return new Promise((resolve) => {
    let settled = false
    const layer = h('div', 'ntp-layer')
    const styleEl = h('style')
    styleEl.textContent = STYLE
    layer.appendChild(styleEl)
    const scrim = h('div', 'ntp-scrim')
    layer.appendChild(scrim)
    const pop = h('div', 'ntp-pop')
    layer.appendChild(pop)
    pop.appendChild(h('div', 'ntp-pop-h', t('pickerTitle')))
    const input = document.createElement('input')
    input.className = 'ntp-pop-in'
    input.setAttribute('type', 'text')
    input.setAttribute('placeholder', t('pickerPlaceholder'))
    pop.appendChild(input)
    const listBox = h('div', 'ntp-pop-list')
    pop.appendChild(listBox)

    let shown = ordered.slice()
    let cursor = 0

    const finish = (val) => {
      if (settled) return
      settled = true
      closeActivePicker = null
      try {
        if (typeof document !== 'undefined' && document.removeEventListener) document.removeEventListener('keydown', onKey, true)
      } catch (e) {
        /* 垫片环境可能没有 */
      }
      try {
        layer.remove()
      } catch (e) {
        /* 已被摘掉 */
      }
      resolve(val)
    }

    const paint = () => {
      listBox.textContent = ''
      if (!shown.length) {
        listBox.appendChild(h('div', 'ntp-pop-empty', t('pickerEmpty')))
        return
      }
      for (let i = 0; i < shown.length; i++) {
        const p = shown[i]
        const row = h('button', 'ntp-pop-row' + (i === cursor ? ' cur' : ''), relLabel(p, folder))
        row.setAttribute('type', 'button')
        row.setAttribute('title', p)
        row.setAttribute('data-path', p)
        row.addEventListener('click', () => finish(p))
        row.addEventListener('mouseenter', () => {
          cursor = i
        })
        listBox.appendChild(row)
      }
    }

    const filter = () => {
      const q = String(input.value || '').trim().toLowerCase()
      shown = q ? ordered.filter((p) => relLabel(p, folder).toLowerCase().indexOf(q) >= 0) : ordered.slice()
      cursor = 0
      paint()
    }

    function onKey(ev) {
      if (settled) return
      const k = ev.key
      if (k === 'Escape') {
        if (ev.preventDefault) ev.preventDefault()
        if (ev.stopPropagation) ev.stopPropagation()
        finish(null)
        return
      }
      if (k === 'ArrowDown' || k === 'ArrowUp') {
        if (ev.preventDefault) ev.preventDefault()
        if (!shown.length) return
        cursor = (cursor + (k === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length
        paint()
        return
      }
      if (k === 'Enter') {
        if (ev.preventDefault) ev.preventDefault()
        if (shown.length) finish(shown[cursor])
        return
      }
    }

    input.addEventListener('input', filter)
    scrim.addEventListener('click', () => finish(null))
    try {
      if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('keydown', onKey, true)
    } catch (e) {
      /* 垫片环境可能没有 */
    }

    paint()
    layerHost().appendChild(layer)
    try {
      input.focus()
    } catch (e) {
      /* 无焦点环境 */
    }
    closeActivePicker = finish
    if (globalThis.__NOTE_TEMPLATES_TEST__) globalThis.__NOTE_TEMPLATES_TEST__._picker = { layer, input, listBox, onKey, finish }
  })
}

// ═══════════════════════════════════════════════════════════════════════════════
//  视图
// ═══════════════════════════════════════════════════════════════════════════════
function mountLibrary(el) {
  el.textContent = ''
  const root = h('div', 'ntp-root')
  const styleEl = h('style')
  styleEl.textContent = STYLE
  root.appendChild(styleEl)

  // ── 常驻元素(mount 时建一次;语言切换只改文案,不重建 → 用户没提交的输入活得下来) ──
  const bar = h('div', 'ntp-bar')
  const search = document.createElement('input')
  search.className = 'ntp-search'
  search.setAttribute('type', 'text')
  bar.appendChild(search)
  const countEl = h('span', 'ntp-count')
  bar.appendChild(countEl)
  const btnRescan = h('button', 'ntp-btn')
  btnRescan.setAttribute('type', 'button')
  bar.appendChild(btnRescan)
  const btnNewTpl = h('button', 'ntp-btn')
  btnNewTpl.setAttribute('type', 'button')
  bar.appendChild(btnNewTpl)
  root.appendChild(bar)

  const warnEl = h('div', 'ntp-warn')
  root.appendChild(warnEl)

  const body = h('div', 'ntp-body')
  const listBox = h('div', 'ntp-list')
  body.appendChild(listBox)
  const side = h('div', 'ntp-side')
  const sideHead = h('div', 'ntp-head')
  side.appendChild(sideHead)
  const prevBox = h('div', 'ntp-prev')
  side.appendChild(prevBox)
  const acts = h('div', 'ntp-acts')
  const btnCreate = h('button', 'ntp-btn primary')
  btnCreate.setAttribute('type', 'button')
  acts.appendChild(btnCreate)
  const btnInsert = h('button', 'ntp-btn')
  btnInsert.setAttribute('type', 'button')
  acts.appendChild(btnInsert)
  side.appendChild(acts)
  body.appendChild(side)
  root.appendChild(body)
  el.appendChild(root)

  // ── 视图局部状态 ──
  let selected = null
  let selRaw = null
  let selErr = null // 'gone' | 'read' | null
  let busy = false

  const hasActivePage = () => {
    try {
      const pg = ctx.app.getPage ? ctx.app.getPage() : null
      // ⚠️ 只读 path/token —— 本插件一次都不读 blocks / order / text
      return !!(pg && pg.path)
    } catch (e) {
      return false
    }
  }

  const paintList = () => {
    const folder = tplFolder()
    const q = String(search.value || '').trim().toLowerCase()
    const match = (p) => !q || relLabel(p, folder).toLowerCase().indexOf(q) >= 0
    const keepTop = listBox.scrollTop || 0
    listBox.textContent = ''
    if (!enumSupported) {
      const box = h('div', 'ntp-empty')
      box.appendChild(h('b', null, t('noEnum')))
      listBox.appendChild(box)
      listBox.scrollTop = keepTop
      return
    }
    if (!templates.length) {
      const box = h('div', 'ntp-empty')
      box.appendChild(h('b', null, t('empty')))
      box.appendChild(h('div', null, t('emptyHint', { folder })))
      listBox.appendChild(box)
      listBox.scrollTop = keepTop
      return
    }
    const rec = recentInList().filter(match)
    const all = templates.filter(match)
    if (!rec.length && !all.length) {
      listBox.appendChild(h('div', 'ntp-empty', t('pickerEmpty')))
      listBox.scrollTop = keepTop
      return
    }
    const addRow = (p) => {
      const row = h('button', 'ntp-item' + (p === selected ? ' sel' : ''), relLabel(p, folder))
      row.setAttribute('type', 'button')
      row.setAttribute('title', p)
      row.setAttribute('data-path', p)
      row.addEventListener('click', () => {
        void select(p)
      })
      listBox.appendChild(row)
    }
    if (rec.length) {
      listBox.appendChild(h('div', 'ntp-group', t('recentHeading')))
      rec.forEach(addRow)
    }
    if (all.length) {
      listBox.appendChild(h('div', 'ntp-group', t('listHeading')))
      all.forEach(addRow)
    }
    listBox.scrollTop = keepTop
  }

  const paintPreview = () => {
    if (selErr === 'gone') renderPreview(prevBox, t('errTplGone', { path: selected || '' }))
    else if (selErr === 'read') renderPreview(prevBox, t('errReadTpl', { path: selected || '' }))
    else if (selRaw == null) renderPreview(prevBox, '')
    else renderPreview(prevBox, buildForInsert(selRaw, activePagePath()))
  }

  const activePagePath = () => {
    try {
      const pg = ctx.app.getPage ? ctx.app.getPage() : null
      return pg && pg.path ? pg.path : null
    } catch (e) {
      return null
    }
  }

  const paintChrome = () => {
    search.setAttribute('placeholder', t('searchPlaceholder'))
    countEl.textContent = enumSupported ? t('countLabel', { c: templates.length }) : ''
    btnRescan.textContent = t('btnRescan')
    btnNewTpl.textContent = t('btnNewTemplate')
    btnCreate.textContent = t('btnCreate')
    btnInsert.textContent = t('btnInsert')
    sideHead.textContent = t('previewTitle')
    const over = totalFound > templates.length
    warnEl.textContent = over ? t('warnTooBroad', { c: templates.length, n: totalFound }) : ''
    warnEl.style.display = over ? '' : 'none'
    const ok = !!selected && !selErr && selRaw != null && !busy
    btnCreate.disabled = !ok
    btnInsert.disabled = !ok || !hasActivePage()
    btnInsert.setAttribute('title', hasActivePage() ? t('btnInsert') : t('noActivePage'))
    btnNewTpl.disabled = busy
    btnRescan.disabled = busy
  }

  const render = () => {
    paintChrome()
    paintList()
    paintPreview()
  }

  async function select(p) {
    selected = p
    selRaw = null
    selErr = null
    render()
    const r = await readFileSafe(p)
    if (disposed) return
    if (selected !== p) return
    if (r.kind === 'ok') selRaw = r.text
    else selErr = r.kind === 'missing' ? 'gone' : 'read'
    render()
  }

  async function refresh(opts) {
    const o = opts || {}
    if (o.rescan) {
      busy = true
      render()
      await scanTemplates()
      busy = false
      if (selected && templates.indexOf(selected) < 0) {
        selected = null
        selRaw = null
        selErr = null
      }
    }
    if (o.refetch && o.refetch === selected) {
      await select(selected)
      return
    }
    render()
  }

  search.addEventListener('input', () => {
    paintList()
  })
  btnRescan.addEventListener('click', () => {
    void refresh({ rescan: true })
  })
  btnNewTpl.addEventListener('click', () => {
    void (async () => {
      busy = true
      render()
      try {
        await createTemplate()
      } finally {
        busy = false
        render()
      }
    })()
  })
  btnCreate.addEventListener('click', () => {
    if (!selected) return
    void (async () => {
      busy = true
      render()
      try {
        await createFromTemplate(selected, workFolder())
      } finally {
        busy = false
        render()
      }
    })()
  })
  btnInsert.addEventListener('click', () => {
    if (!selected) return
    // ⚠️ 点击那一刻钉住「插的是哪个模板」:下面每个 await 里用户都可能已经改选别的,
    //    之后再读 selected 就会把「刚选上的那个」错记进 MRU / 提示文案。
    const tpl = selected
    void (async () => {
      // ⚠️ 令牌**点击那一刻现取**,绝不缓存;任何 await 之后要用令牌必须重新 getPage()
      const r = await readFileSafe(tpl)
      if (r.kind !== 'ok') {
        if (selected === tpl) selErr = r.kind === 'missing' ? 'gone' : 'read'
        say(t(r.kind === 'missing' ? 'errTplGone' : 'errReadTpl', { path: tpl }), { level: 'error' })
        render()
        return
      }
      let pg = null
      try {
        pg = ctx.app.getPage ? ctx.app.getPage() : null
      } catch (e) {
        pg = null
      }
      if (!pg || !pg.path) {
        say(t('noActivePage'), { level: 'warning' })
        render()
        return
      }
      const md = buildForInsert(r.text, pg.path)
      // ⚠️ 两条插入路线必须同一口径:斜杠那条过 guardSlashPayload,按钮这条以前什么都不判,
      //    于是同一份模板在斜杠里被拒、在按钮里原样插进用户正在写的笔记(评审 Finding 1)。
      if (!ctrlCharClean(md)) return
      const ok = ctx.app.insertMarkdown ? ctx.app.insertMarkdown(pg.token, md, 'cursor') : false
      // ⚠️ 插不进去就报错,**绝不**回退到 writeFile —— 那是「读全文改整篇写回」的另一张脸
      if (!ok) {
        say(t('errInsert'), { level: 'error' })
        return
      }
      await pushRecent(tpl)
      try {
        if (ctx.activity) ctx.activity.log('insert', { tpl })
      } catch (e) {
        /* 埋点不该连坐 */
      }
      say(t('insertedOk', { name: relLabel(tpl, tplFolder()) }), { level: 'success' })
      render()
    })()
  })
  root.addEventListener('pointerenter', () => {
    paintChrome()
  })

  const rerender = (opts) => {
    void refresh(opts)
  }
  rerender.__root = root
  rerenders.add(rerender)

  render()
  void (async () => {
    await scanTemplates()
    if (disposed) return
    render()
  })()

  return () => {
    rerenders.delete(rerender)
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  贡献点注册
// ═══════════════════════════════════════════════════════════════════════════════
// ⚠️ 贡献点的标题是**注册时**的单字符串,宿主不做运行时重解析 → 切语言后命令面板 / 斜杠菜单 /
// 视图标题 / 设置项要等重启才跟上(宿主已知缺口,README 如实写了)。不许为此做重注册。
if (ctx.registerView) {
  ctx.registerView({ id: 'library', title: t('viewTitle'), singleton: true, mount: mountLibrary, workspaceSource: 'template-list' })
}

// ── 统一左栏列表源(宿主 2026-08-25+;可选链,老宿主静默跳过) ─────────────────────
// 模板清单交给宿主统一左栏渲染(与会话/笔记行同一套 UI)。**点一行 = 打开模板本身**(导航,安全);
// 「用它新建」这条会落盘的动作放右键菜单里,不给单击 —— 列表里点一下就凭空多一篇笔记不是好交互。
// 插件对界面无状态:搜索词由宿主持有,经 items({query}) 回传。
if (ctx.registerListSource) {
  const listSubs = new Set()
  const fireList = () => listSubs.forEach((f) => { try { f() } catch { /* ignore */ } })
  // ⚠️ 只在 setup 里扫一次不行:插件是在宿主**启动期**装的,那时活动库还没恢复,
  //    listPages() 此刻给空数组(宿主契约:没有活动库不抛错,给空)→ 列表永久空着
  //    (青鸟 2026-08-28 实报的同一个坑的枚举面版本)。宿主挂载列表面 / 切库都会重订阅。
  const listReload = () => scanTemplates().then(fireList, () => { /* 保留上一份 */ })
  ctx.registerListSource({
    id: 'template-list',
    title: t('viewTitle'),
    search: true,
    // templates 是 scanTemplates 维护的同步快照(只有路径,不含正文)—— items() 每次渲染都被调,绝不读盘。
    items: (f) => {
      const q = ((f && f.query) || '').trim().toLowerCase()
      return templates
        .filter((p) => !q || String(p).toLowerCase().includes(q))
        .map((p) => ({ key: p, title: (p.split('/').pop() || p).replace(/\.md$/i, ''), icon: 'template' }))
    },
    actions: [{ id: 'new', label: t('btnNewTemplate'), run: () => { void createTemplate() } }],
    itemMenu: (item) => [{ id: 'create', label: t('btnCreate'), run: () => { void createFromTemplate(item.key, workFolder()) } }],
    subscribe: (cb) => { listSubs.add(cb); void listReload(); return () => listSubs.delete(cb) },
    open: (item) => openNotePath(item.key), // 裸 .md 一律 loadPage,openFile 会被系统默认程序抢走
  })
}

ctx.registerCommand({
  id: 'note-templates-open',
  title: t('cmdOpen'),
  keywords: 'template 模板 muban mb library 模板库 骨架',
  run: () => {
    if (!ctx.registerView || !ctx.openView) {
      say(t('hostTooOld'), { level: 'error' })
      return
    }
    ctx.openView('library')
  },
})

ctx.registerCommand({
  id: 'note-templates-new',
  title: t('cmdNew'),
  keywords: 'template 模板 新建 new note 从模板 muban',
  run: () => {
    void newFromTemplateFlow(workFolder())
  },
})

ctx.registerSlashItem({
  id: 'note-templates-insert',
  label: t('slashLabel'),
  hint: t('slashHint'),
  icon: 'template',
  group: '插件',
  keywords: 'template 模板 muban mb 骨架 结构 套用 snippet boilerplate',
  // ⚠️ 这里**不要**自己调 insertMarkdown —— 返回字符串让宿主插,这是 v4 上唯一干净的路径。
  async run(cx) {
    const tpl = await pickTemplate()
    if (!tpl) return ''
    const r = await readFileSafe(tpl)
    if (r.kind !== 'ok') {
      say(t(r.kind === 'missing' ? 'errTplGone' : 'errReadTpl', { path: tpl }), { level: 'error' })
      return ''
    }
    // ⚠️ 先过闸再落痕迹(P0 模板 3):以前顺序反了 —— 一份**永远插不进去**的模板照样进「最近使用」
    //    (经 saveData 落盘,重启还在)并往活动日志里记一条 `insert`,而笔记里一个字没变。
    //    失败与成功两次的持久痕迹逐字节相同,事后无法区分。
    const out = guardSlashPayload(buildForInsert(r.text, cx && cx.pagePath))
    if (!out) return ''
    await pushRecent(tpl)
    try {
      if (ctx.activity) ctx.activity.log('insert', { tpl })
    } catch (e) {
      /* 埋点不该连坐 */
    }
    for (const fn of rerenders) fn({})
    return out
  },
})

ctx.registerFileCreator({
  id: 'note-templates-new-from',
  label: t('creatorLabel'),
  icon: 'template',
  // base = parentFolder(用户右键了哪个文件夹就落哪儿),不是 workFolder
  run: (parentFolder) => newFromTemplateFlow(parentFolder || ''),
})

ctx.registerSetting({
  key: 'folder',
  label: t('settingFolder'),
  type: 'text',
  default: DEFAULT_TPL_FOLDER,
  description: t('settingFolderDesc'),
})
ctx.registerSetting({
  key: 'askOnConflict',
  label: t('settingAsk'),
  type: 'boolean',
  default: false,
  description: t('settingAskDesc'),
})

// ── 订阅(disposer 里全部退掉) ─────────────────────────────────────────────────
let offLocale = null
if (ctx.subscribeLocale) {
  try {
    offLocale = ctx.subscribeLocale((l) => {
      locale = l === 'en' ? 'en' : 'zh'
      // 就地重画(视图不重挂);常驻元素(搜索框 / 选中项 / 滚动位置)因此原封不动
      for (const fn of rerenders) fn({})
    })
  } catch (e) {
    offLocale = null
  }
}

let offPage = null
if (ctx.app.subscribePage) {
  try {
    offPage = ctx.app.subscribePage(() => {
      // 只用来刷新「插进当前笔记」的可用态 —— 一个字段都不从快照里取正文
      for (const fn of rerenders) fn({})
    })
  } catch (e) {
    offPage = null
  }
}

// ── 启动(不阻塞 setup;check.mjs 经 __NOTE_TEMPLATES_TEST__.ready 等它) ──────────
const ready = (async () => {
  try {
    await loadMru()
    await scanTemplates()
  } catch (e) {
    /* 启动扫描失败不该让 setup 抛 */
  }
})()

if (globalThis.__NOTE_TEMPLATES_TEST__) {
  Object.assign(globalThis.__NOTE_TEMPLATES_TEST__, {
    formatDate,
    shiftDate,
    parseVar,
    renderTemplate,
    splitFrontmatter,
    stripMarkers,
    sanitizeForInsert,
    candidatePath,
    normalizeFolder,
    sanitizeFileName,
    resolveTarget,
    isUnderFolder,
    buildForInsert,
    ctrlCharClean,
    guardSlashPayload,
    openNotePath,
    renderPreview,
    samePath,
    baseNoExt,
    t,
    MSG,
    TEMPLATE_SCAFFOLD,
    ready,
    scanTemplates,
    createFromTemplate,
    createTemplate,
    newFromTemplateFlow,
    pickTemplate,
    pushRecent,
    loadMru,
    saveMru,
    readFileSafe,
    tplFolder,
    workFolder,
    setLocale: (l) => {
      locale = l
    },
    setPick: (fn) => {
      pickOverride = fn
    },
    state: () => ({
      locale,
      templates: templates.slice(),
      enumSupported,
      totalFound,
      mru: { v: mru.v, recent: mru.recent.slice() },
      mruMemoryOnly,
      warnedRootFolder,
      watchers: watchers.length,
      views: rerenders.size,
    }),
  })
}

return () => {
  disposed = true
  try {
    if (offLocale) offLocale()
  } catch (e) {
    /* 退订失败不该连坐 */
  }
  try {
    if (offPage) offPage()
  } catch (e) {
    /* 同上 */
  }
  clearWatchers()
  if (closeActivePicker) {
    try {
      closeActivePicker(null)
    } catch (e) {
      /* 同上 */
    }
  }
  rerenders.clear()
}
