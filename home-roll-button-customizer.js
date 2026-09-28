/**
 * Bilibili-Evolved 第三方组件 · 换一换按钮位置自定义
 *
 * v2 修复：移动后的按钮"没有手型光标、也没有按下去动画"
 *   真实页面 + 真实指针事件实测（无头 Firefox，逐场景对比）：
 *     · 官方按钮结构：<div class="feed-roll-btn"><button class="roll-btn">…
 *       手型光标与按压缩放来自官方 CSS（.primary-btn 一类规则），动画挂在**按钮本体**上
 *     · 不动位置 / 只用 transform 位移 → hovered=true、active=true、指针落点 self=true，一切正常
 *     · 一开「固定显示」→ hovered=false、active=false，指针中心落点是 **DIV.title**，
 *       它的祖先 DIV.lt-row 是 position:fixed; z-index:10000 的**透明浮层**（登录提示层）
 *     · 原因：组件只给了 z-index: 1001，被页面里这些 z-index: 10000 级的浮层盖住。
 *       按钮照样画在屏幕上（浮层是透明的），但鼠标落点是浮层 →
 *       既没有手型光标，也进不了 :active（按压动画消失），点击同样打不到按钮。
 *     · 把 z-index 抬到 2147483000 后立刻恢复：指针落点 self=true，按下 active=true。
 *   修复：① 悬浮/固定一律用最大层叠序，并在应用后做**指针落点自检**，被盖住就自动升级
 *          并打印一行可操作的自检日志（谁盖的、它的层级）；
 *         ② 按钮本体绝不再写 transform（否则官方 :active 的按压缩放会被内联 !important
 *           覆盖，按压动画直接消失），改用 left/top 定位；
 *         ③ 官方没给手型光标时补上 cursor: pointer。
 */

(() => {
  'use strict'

  const W = (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window
  const D = W.document

  const raf = W.requestAnimationFrame
    ? W.requestAnimationFrame.bind(W)
    : (fn) => W.setTimeout(fn, 16)
  const caf = W.cancelAnimationFrame ? W.cancelAnimationFrame.bind(W) : (id) => W.clearTimeout(id)

  const COMPONENT_NAME = 'homeRollButtonCustomizer'
  // 页面里有 z-index:10000 级别的固定浮层，1001 会被盖住（见文件头说明），所以用最大层叠序。
  const Z_INDEX = 2147483000
  const SCAN_TIMEOUT = 3000
  const LOG_PREFIX = '[换一换按钮] '
  // 定位/过渡分工：官方按压反馈与悬浮换色都挂在按钮自己的 transition 上，
  // 所以被移动的是按钮本体时不能整体掐掉过渡，只把我们用来定位的属性排除出去。
  const TRANSITION_KEEP =
    'transition-property: transform, background-color, color, border-color, box-shadow, opacity'

  // 「换一换」按钮可能出现的各种选择器, 从具体到宽泛依次尝试
  const BUTTON_SELECTORS = [
    '.feed-roll-btn .primary-btn.roll-btn',
    '.feed-roll-btn .roll-btn',
    '.recommended-container_floor-aside .roll-btn',
    '.feed-roll-btn',
    '.roll-btn',
    '.change-btn',
  ]

  // 官方组件标签: 样式
  const STYLE_TAG = {
    name: 'style',
    displayName: '样式',
    color: '#8BC34A',
    icon: 'mdi-palette-outline',
    order: 2,
  }

  const clamp = (value, min, max) => (max < min ? min : Math.min(Math.max(value, min), max))
  const toNumber = (value, fallback) =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback

  const isHomePage = () => {
    const { hostname, pathname } = W.location
    return hostname === 'www.bilibili.com' && (pathname === '/' || pathname === '/index.html')
  }

  /* ---------------------------------------------------------------- 查找按钮 */

  let lastTextScanAt = 0

  // 兜底: 所有选择器都失效时, 按文字内容 + 尺寸特征去找「换一换」
  const findByText = () => {
    const now = Date.now()
    if (now - lastTextScanAt < 1000) {
      return null
    }
    lastTextScanAt = now
    let best = null
    let bestArea = Infinity
    const candidates = D.querySelectorAll('button, a, [class*="roll"], [class*="change"]')
    for (let i = 0; i < candidates.length; i++) {
      const el = candidates[i]
      if ((el.textContent || '').trim() !== '换一换') {
        continue
      }
      const rect = el.getBoundingClientRect()
      if (rect.width < 8 || rect.height < 8 || rect.width > 320 || rect.height > 140) {
        continue
      }
      const area = rect.width * rect.height
      if (area < bestArea) {
        bestArea = area
        best = el
      }
    }
    return best
  }

  // B 站有时把图标做成按钮的兄弟节点(如 .feed-roll-btn > 图标 + > .roll-btn)。
  // 只移动 .roll-btn 的话图标就落下了, 所以这里判断一下: 如果父节点只是个紧凑的小
  // 外壳、且文字内容与子节点基本一致, 就往上提一层, 把整个控件一起搬。
  const promoteToWrapper = (el) => {
    const parent = el && el.parentNode
    if (!parent || parent === D.body || typeof parent.getBoundingClientRect !== 'function') {
      return el
    }
    const parentRect = parent.getBoundingClientRect()
    const selfRect = el.getBoundingClientRect()
    if (parentRect.width < 1 || parentRect.height < 1) {
      return el
    }
    if (parentRect.width * parentRect.height > selfRect.width * selfRect.height * 3) {
      return el
    }
    // 父节点里必须真有别的、占地方的兄弟内容(多半就是那两个箭头图标), 否则说明它
    // 只是个带内边距的空壳, 提升上去反而会让定位锚点偏出去一截。
    const siblings = Array.prototype.filter.call(parent.childNodes, (child) => {
      if (child === el || typeof child.getBoundingClientRect !== 'function') {
        return false
      }
      const rect = child.getBoundingClientRect()
      return rect.width > 1 && rect.height > 1
    })
    if (siblings.length === 0) {
      return el
    }
    const parentText = (parent.textContent || '').trim()
    const selfText = (el.textContent || '').trim()
    if (parentText.length > selfText.length + 2) {
      return el
    }
    return parent
  }

  const findButton = () => {
    const custom =
      typeof options.buttonSelector === 'string' ? options.buttonSelector.trim() : ''
    if (custom) {
      try {
        const el = D.querySelector(custom)
        if (el && el.getBoundingClientRect().width > 0) {
          return promoteToWrapper(el)
        }
      } catch (e) {
        /* 选择器不合法, 走自动识别 */
      }
    }
    for (let i = 0; i < BUTTON_SELECTORS.length; i++) {
      const el = D.querySelector(BUTTON_SELECTORS[i])
      if (el && el.getBoundingClientRect().width > 0) {
        return promoteToWrapper(el)
      }
    }
    const byText = findByText()
    return byText ? promoteToWrapper(byText) : null
  }

  // 官方通常把「换一换」按钮放在一个自带的绝对定位容器里(典型如 .feed-roll-btn),
  // 按钮只是容器的子元素。优先把位移写到这个容器上 —— 按钮元素自身不带任何内联样式,
  // 官方的 hover 背景、按压反馈(:active 的 transform: scale(.95)) 与点击后图标自转
  // 动画就全部保持原样, 真正做到「只改位置, 不改样式」。
  const CONTROL_SELECTORS = ['.feed-roll-btn']

  const findControl = () => {
    const el = findButton()
    if (!el) {
      return null
    }
    for (let i = 0; i < CONTROL_SELECTORS.length; i++) {
      try {
        const wrap = el.closest(CONTROL_SELECTORS[i])
        if (wrap && wrap !== el && wrap !== D.body && wrap.getBoundingClientRect().width > 0) {
          return wrap
        }
      } catch (e) {
        /* 选择器不合法则忽略 */
      }
    }
    // 没有官方容器时退回原来的智能提升; 仍找不到合适的壳才直接动按钮(极端兜底)
    return promoteToWrapper(el) || el
  }

  /* ---------------------------------------------------------------- 运行状态 */

  let options = {}
  let running = false

  let button = null
  let buttonBase = null
  let originalCssText = null
  let clickHandler = null
  // 官方样式没给这个按钮手型光标时（实测计算值就是 default），由组件补上 —— 用户要的"移上去变小手"
  let needCursor = false
  let rollButtonEl = null // 真正那个 <button>（被移动的可能是它的容器）
  let cursorCaptured = false
  let cursorPrevInline = null
  let currentOffsetX = 0
  let currentOffsetY = 0

  // 定位模式: none=原样 / fixed=position:fixed / float=滚动跟随
  let mode = 'none'
  let fixedWorks = null // null=尚未测试, true/false=已测
  let floatBase = ''
  // transform=把位移写在容器 transform 上 / offset=用 left/top（被移动的就是按钮本体时只能用它）
  let floatStrategy = 'transform'
  let targetLeft = 0
  let targetTop = 0
  let lastDx = 0
  let lastDy = 0

  // 落点自检用
  let bumpedAncestors = [] // 抬过 z-index 的祖先（卸载时还原）
  let liftTried = false
  let lastBlockedKey = ''

  let observer = null
  let resizeHandler = null
  let scrollHandler = null
  let floatFrame = null

  const debounce = (fn, wait) => {
    let timer = null
    return (...args) => {
      if (timer !== null) {
        W.clearTimeout(timer)
      }
      timer = W.setTimeout(() => {
        timer = null
        fn(...args)
      }, wait)
    }
  }

  const setButtonStyle = (css) => {
    const head = originalCssText ? `${originalCssText.replace(/;\s*$/, '')};` : ''
    button.setAttribute('style', head + css)
    applyCursor()
  }

  const resetStyle = () => {
    if (originalCssText) {
      button.setAttribute('style', originalCssText)
    } else {
      button.removeAttribute('style')
    }
  }

  // 「移上去变小手」：官方没给才补，官方给了就不动。
  // 关键：必须写在**按钮本体**上 —— 浏览器的 UA 样式表对 <button> 有自己的 cursor 声明，
  // 写在容器上不会被按钮继承（实测容器 pointer、按钮仍 default）。
  const applyCursor = () => {
    if (!rollButtonEl || !needCursor || options.showHandCursor === false) {
      return
    }
    try {
      if (!cursorCaptured && rollButtonEl !== button) {
        cursorPrevInline = rollButtonEl.getAttribute('style')
        cursorCaptured = true
      }
      rollButtonEl.style.setProperty('cursor', 'pointer', 'important')
    } catch (e) {
      /* 忽略 */
    }
  }

  const clearCursor = () => {
    if (!rollButtonEl) {
      return
    }
    try {
      if (cursorCaptured) {
        if (cursorPrevInline === null) {
          rollButtonEl.removeAttribute('style')
        } else {
          rollButtonEl.setAttribute('style', cursorPrevInline)
        }
      }
      // 被移动的就是按钮本体时，它的 style 由 resetStyle() 负责还原
    } catch (e) {
      /* 忽略 */
    }
    cursorCaptured = false
    cursorPrevInline = null
  }

  // 在「未施加任何自定义样式」的状态下量一次按钮的原始几何信息(文档坐标), 作为偏移基准。
  // 用文档坐标而不是视口坐标, 这样开启固定模式的时机就不会影响最终位置。
  const measureBase = () => {
    const current = button.getAttribute('style')
    resetStyle()
    const rect = button.getBoundingClientRect()
    const base = {
      left: rect.left + W.scrollX,
      top: rect.top + W.scrollY,
      width: rect.width,
      height: rect.height,
    }
    if (current === null) {
      button.removeAttribute('style')
    } else {
      button.setAttribute('style', current)
    }
    return base
  }

  /* ------------------------------------------------------------ 滚动跟随方案 */

  const isStaticPositioned = () => {
    try {
      return W.getComputedStyle(button).position === 'static'
    } catch (e) {
      return false
    }
  }

  // transform 是相对元素自身坐标系的, 不会像 fixed 那样受祖先 transform 干扰;
  // 但每帧都要更新, 所以必须掐掉过渡动画, 否则按钮会拖在滚动后面。
  // （被移动的是按钮本体时改走 left/top，用过渡白名单而不是整体掐掉，保住官方的按压过渡。）
  const buildFloatBase = () => {
    const parts = []
    if (isStaticPositioned()) {
      parts.push('position: relative')
    }
    parts.push(`z-index: ${Z_INDEX}`)
    parts.push(floatStrategy === 'offset' ? TRANSITION_KEEP : 'transition-duration: 0s')
    return parts.map((decl) => `${decl} !important`).join(';')
  }

  // 用「实际测量到的位置 - 上一次施加的位移」反推元素的自然位置, 因此布局发生任何
  // 变化(卡片插入、栏位高度变化)都能自动跟上, 不需要重新测量基准。
  const updateFloat = () => {
    if (mode !== 'float' || !button || !D.contains(button)) {
      return
    }
    const rect = button.getBoundingClientRect()
    const naturalLeft = rect.left - lastDx
    const naturalTop = rect.top - lastDy
    const dx = targetLeft - naturalLeft
    const dy = targetTop - naturalTop
    if (Math.abs(dx - lastDx) < 0.5 && Math.abs(dy - lastDy) < 0.5) {
      return
    }
    lastDx = dx
    lastDy = dy
    const move =
      floatStrategy === 'offset'
        ? `left: ${dx}px !important;top: ${dy}px !important;`
        : `transform: translate(${dx}px, ${dy}px) !important;`
    setButtonStyle(`${floatBase};${move}`)
  }

  const startFloat = () => {
    if (scrollHandler) {
      return
    }
    scrollHandler = () => {
      if (floatFrame !== null) {
        return
      }
      floatFrame = raf(() => {
        floatFrame = null
        updateFloat()
      })
    }
    W.addEventListener('scroll', scrollHandler, { passive: true })
  }

  const stopFloat = () => {
    if (scrollHandler) {
      W.removeEventListener('scroll', scrollHandler)
      scrollHandler = null
    }
    if (floatFrame !== null) {
      caf(floatFrame)
      floatFrame = null
    }
    lastDx = 0
    lastDy = 0
  }

  /* ------------------------------------------------------------ position:fixed 方案 */

  const fixedCss = (left, top) => {
    const parts = [
      'position: fixed',
      `left: ${left}px`,
      `top: ${top}px`,
      `width: ${buttonBase.width}px`,
      `height: ${buttonBase.height}px`,
      'box-sizing: border-box',
      'max-width: none',
      'margin: 0',
      `z-index: ${Z_INDEX}`,
    ]
    if (!isButtonElement()) {
      // 官方容器 .feed-roll-btn 自带 translate(10px) 之类的 transform, fixed 落位后必须清掉,
      // 否则实测位置会整体偏移, 永远匹配不上 → 白白退回滚动跟随方案。
      // 但被移动的是按钮本体时绝不能写 transform: none —— 那会把官方 :active 的按压缩放一起清掉。
      parts.splice(1, 0, 'transform: none')
    }
    return parts.map((decl) => `${decl} !important`).join(';')
  }

  // 读取被移动元素「官方自带」的 CSS transform 平移量(调用前必须已清掉本组件的内联样式)。
  // 官方给容器写了 translateX(10px) 之类的位移, 若直接覆盖, 视觉上会突然跳一下;
  // 把用户偏移叠加在官方位移之上, 才能做到零跳变。
  const readNativeTranslate = () => {
    try {
      const cs = W.getComputedStyle(button).transform
      if (!cs || cs === 'none') {
        return { x: 0, y: 0 }
      }
      if (typeof W.DOMMatrix === 'function') {
        const m = new W.DOMMatrix(cs)
        return { x: m.e || 0, y: m.f || 0 }
      }
      const mm = cs.match(/matrix\(([^)]+)\)/)
      if (mm) {
        const p = mm[1].split(',').map((s) => Number(s.trim()))
        return { x: p[4] || 0, y: p[5] || 0 }
      }
    } catch (e) {
      /* 忽略 */
    }
    return { x: 0, y: 0 }
  }

  const positionMatches = (left, top) => {
    const rect = button.getBoundingClientRect()
    return Math.abs(rect.left - left) <= 2 && Math.abs(rect.top - top) <= 2
  }

  // 位移样式（"只改位置"模式），两条路：
  //   · 目标是官方容器 → 用 transform，并叠加容器官方的 translate(px)（零跳变）；
  //   · 目标是**按钮本体** → 一律改用 left/top。因为官方按压反馈是按钮上的
  //     :active { transform: scale(.95) }，只要按钮上有内联 transform（哪怕不带 !important）
  //     就会被覆盖，按压动画直接消失。left/top 与 :active 的 transform 互不干扰。
  // 附带把过渡限制成白名单：官方的按压/悬浮过渡留着，我们用来定位的属性不参与过渡
  // （否则每帧定位会拖着滚动跑）。
  const offsetCss = (offsetX, offsetY) => {
    const native = readNativeTranslate()
    const x = native.x + offsetX
    const y = native.y + offsetY
    if (isButtonElement()) {
      const parts = ['left: ' + x + 'px', 'top: ' + y + 'px', TRANSITION_KEEP]
      if (isStaticPositioned()) {
        parts.push('position: relative')
      }
      return parts.map((decl) => `${decl} !important`).join(';')
    }
    return `transform: translate(${x}px, ${y}px) !important;`
  }

  /* ------------------------------------------------- 落点自检（本轮修复的核心） */

  // 被移动的元素是不是「按钮本体」（而不是官方容器 .feed-roll-btn）。
  // 是本体的话**绝不能**写 transform：官方按压反馈是按钮上的 :active { transform: scale(.95) }，
  // 内联 !important 的 transform 会把它彻底压掉，按压动画就没了。这种情况改用 left/top 定位。
  const isButtonElement = () =>
    !!(button && (button.tagName === 'BUTTON' || button.classList.contains('roll-btn') || button.classList.contains('change-btn')))

  const describeEl = (el) => {
    if (!el) {
      return '(无)'
    }
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 3).join('.') : ''
    let cs = null
    try {
      cs = W.getComputedStyle(el)
    } catch (e) {
      cs = null
    }
    const pos = cs ? cs.position : '?'
    const z = cs && cs.zIndex !== 'auto' ? ` z-index:${cs.zIndex}` : ''
    return `<${el.tagName.toLowerCase()}${cls ? ' .' + cls : ''}> ${pos}${z}`
  }

  const inViewport = (x, y) => x >= 1 && y >= 1 && x <= W.innerWidth - 1 && y <= W.innerHeight - 1

  // 指针落点自检：以**中心点**为准（用户就是照着中心点去指、去点的），
  // 中心点跑到视口外时退而取最近的可见点。浮层透明时"看得见按钮"≠"点得到按钮"，
  // 这正是本次 bug 的伪装。
  const hitTest = () => {
    if (!button || !D.contains(button) || typeof D.elementFromPoint !== 'function') {
      return null
    }
    const rect = button.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) {
      return null
    }
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const candidates = [
      [cx, cy],
      [cx, rect.top + 3],
      [cx, rect.bottom - 3],
      [rect.left + 3, cy],
      [rect.right - 3, cy],
    ].filter((pt) => inViewport(pt[0], pt[1]))
    if (!candidates.length) {
      return null // 按钮整块在视口外，测不了
    }
    let hit = null
    try {
      hit = D.elementFromPoint(candidates[0][0], candidates[0][1])
    } catch (e) {
      return null
    }
    if (!hit || hit === button || button.contains(hit)) {
      return null
    }
    return { blocker: hit }
  }

  // 升级手段：把"已经是层叠上下文"的已定位祖先抬一层。
  // 只动这类祖先（z-index 非 auto 的已定位元素）——抬它不会改布局；
  // position:relative + z-index:auto 的祖先本来就不创建层叠上下文，我们的最大 z-index 能直接越过去。
  const liftPositionedAncestors = () => {
    if (liftTried || !button) {
      return
    }
    liftTried = true
    let el = button.parentElement
    let depth = 0
    while (el && el !== D.body && depth < 12) {
      let cs = null
      try {
        cs = W.getComputedStyle(el)
      } catch (e) {
        cs = null
      }
      if (cs && cs.position !== 'static' && cs.zIndex !== 'auto') {
        bumpedAncestors.push({ el: el, cssText: el.getAttribute('style') })
        el.style.setProperty('z-index', String(Z_INDEX), 'important')
      }
      el = el.parentElement
      depth++
    }
    return bumpedAncestors.length
  }

  const restoreLiftedAncestors = () => {
    for (let i = 0; i < bumpedAncestors.length; i++) {
      const it = bumpedAncestors[i]
      if (it.cssText === null) {
        it.el.removeAttribute('style')
      } else {
        it.el.setAttribute('style', it.cssText)
      }
    }
    bumpedAncestors = []
    liftTried = false
    lastBlockedKey = ''
  }

  // 应用完样式后立刻自检：被盖住 → 自动升级 + 打印一行可操作日志（同一种情况只报一次）
  const verifyReachability = () => {
    // 位置一个都没动时不插手（除了补光标），免得平白给页面加层叠序
    if (mode === 'none' && currentOffsetX === 0 && currentOffsetY === 0) {
      return
    }
    const bad = hitTest()
    if (!bad) {
      lastBlockedKey = ''
      return
    }
    const blocker = bad.blocker
    const key = describeEl(blocker) + '@' + describeEl(button)
    if (lastBlockedKey === key) {
      return
    }
    lastBlockedKey = key
    const zBefore = W.getComputedStyle(button).zIndex
    // 升级一：固定/悬浮模式本来就已经是最大层叠序（根因就是 1001 太小），
    // 这里只处理"只改位置"模式 —— 它刻意不碰层叠序，被盖住时补上 position + 最大 z-index。
    if (mode !== 'fixed' && mode !== 'float') {
      let css = offsetCss(currentOffsetX, currentOffsetY)
      if (W.getComputedStyle(button).position === 'static') {
        css += ';position: relative !important'
      }
      css += `;z-index: ${Z_INDEX} !important`
      setButtonStyle(css)
    }
    // 升级二：仍被盖住时，抬"已创建层叠上下文"的已定位祖先
    let lifted = 0
    if (hitTest()) {
      lifted = liftPositionedAncestors() || 0
    }
    const stillBad = hitTest()
    const how =
      !stillBad
        ? lifted
          ? `已自动修复（抬起了 ${lifted} 个上层容器）`
          : '已自动修复（层叠序提到最大）'
        : '仍被遮挡，需要继续排查'
    console.warn(
      `${LOG_PREFIX}按钮被别的元素盖住了：指针落点是 ${describeEl(blocker)}，` +
        `按钮自身 z-index 原为 ${zBefore}。这会导致「没有小手、没有按压动画、点了没反应」。${how}`
    )
  }



  /* ---------------------------------------------------------------- 按钮生命周期 */

  const restoreButton = () => {
    stopFloat()
    mode = 'none'
    fixedWorks = null
    restoreLiftedAncestors()
    lastBlockedKey = ''
    if (clickHandler && button) {
      button.removeEventListener('click', clickHandler)
    }
    clickHandler = null
    if (button) {
      resetStyle()
    }
    clearCursor()
    button = null
    rollButtonEl = null
    buttonBase = null
    originalCssText = null
    needCursor = false
    currentOffsetX = 0
    currentOffsetY = 0
  }

  const ensureButton = () => {
    if (button && D.contains(button)) {
      return true
    }
    restoreButton()
    const found = findControl()
    if (!found) {
      return false
    }
    button = found
    originalCssText = button.getAttribute('style')
    buttonBase = measureBase()
    fixedWorks = null
    // 真正那个按钮（被移动的可能是它的官方容器），"小手"必须写在它身上
    rollButtonEl =
      button.tagName === 'BUTTON' || button.classList.contains('roll-btn') || button.classList.contains('change-btn')
        ? button
        : button.querySelector('button, .roll-btn, .change-btn') || button
    // 官方样式给没给手型光标？（实测 2026 版首页的 .roll-btn 计算值是 default，没给）
    try {
      needCursor = W.getComputedStyle(rollButtonEl).cursor !== 'pointer'
    } catch (e) {
      needCursor = false
    }
    clickHandler = (event) => {
      if (!options.scrollToTopOnClick) {
        return
      }
      if (typeof event.button === 'number' && event.button !== 0) {
        return
      }
      try {
        W.scrollTo({ top: 0, behavior: 'smooth' })
      } catch (e) {
        W.scrollTo(0, 0)
      }
    }
    button.addEventListener('click', clickHandler)
    return true
  }

  /* ---------------------------------------------------------------- 应用设置 */

  const apply = () => {
    if (!running) {
      return
    }
    if (!isHomePage()) {
      restoreButton()
      return
    }
    if (!ensureButton()) {
      return
    }

    // 粗调 + 微调两个滑块相加, 旧的“像素”设置语义不变
    const offsetX =
      toNumber(options.offsetX, 0) + toNumber(options.offsetXFine, 0)
    const offsetY =
      toNumber(options.offsetY, 0) + toNumber(options.offsetYFine, 0)

    currentOffsetX = offsetX
    currentOffsetY = offsetY

    if (!options.fixed) {
      stopFloat()
      mode = 'none'
      resetStyle()
      // 两个偏移都是 0 时除了补一个手型光标什么都不加, 位置与原生完全一致
      if (offsetX !== 0 || offsetY !== 0) {
        // 位移优先写在外层容器上（并叠加容器官方的 translate）。按钮元素自身绝不能出现
        // 内联 transform —— 官方按压反馈是按钮上的 :active { transform: scale(.95) }，
        // 只要按钮上有内联 transform(哪怕不带 !important)就会被覆盖，按压动画即消失；
        // 而 svg 的转圈动画属于 svg 自身，也不要去动它。
        setButtonStyle(offsetCss(offsetX, offsetY))
      } else {
        // 位置一个都不动，只把官方缺失的手型光标补上（不改位置、不改官方任何样式）
        applyCursor()
      }
      verifyReachability()
      return
    }

    // 固定/滚动跟随前重新量一次自然位置, 避免窗口或页面布局变化后停留在旧坐标
    buttonBase = measureBase()
    const maxLeft = Math.max(0, W.innerWidth - buttonBase.width)
    const maxTop = Math.max(0, W.innerHeight - buttonBase.height)
    targetLeft = clamp(buttonBase.left + offsetX, 0, maxLeft)
    targetTop = clamp(buttonBase.top + offsetY, 0, maxTop)
    floatStrategy = isButtonElement() ? 'offset' : 'transform'

    // 方案 (a): position: fixed
    if (fixedWorks !== false) {
      stopFloat()
      mode = 'none'
      resetStyle()
      setButtonStyle(fixedCss(targetLeft, targetTop))
      if (positionMatches(targetLeft, targetTop)) {
        fixedWorks = true
        mode = 'fixed'
        verifyReachability()
        return
      }
      fixedWorks = false
    }

    // 方案 (b): 祖先元素创建了包含块, fixed 落不到位, 改用滚动跟随。
    // 元素依旧留在原来的父节点里, 样式不受任何影响。
    if (mode !== 'float') {
      mode = 'float'
      lastDx = 0
      lastDy = 0
      resetStyle()
      floatBase = buildFloatBase()
      setButtonStyle(floatBase)
      startFloat()
    }
    updateFloat()
    verifyReachability()
  }

  const scheduleApply = debounce(apply, 150)

  const start = () => {
    if (!D.body) {
      return
    }
    running = true
    if (!observer) {
      observer = new W.MutationObserver(scheduleApply)
      observer.observe(D.body, { childList: true, subtree: true })
    }
    if (!resizeHandler) {
      resizeHandler = debounce(apply, 200)
      W.addEventListener('resize', resizeHandler)
    }
  }

  const stop = () => {
    running = false
    if (observer) {
      observer.disconnect()
      observer = null
    }
    if (resizeHandler) {
      W.removeEventListener('resize', resizeHandler)
      resizeHandler = null
    }
    restoreButton()
  }

  const waitForButton = () =>
    new Promise((resolve) => {
      const begin = Date.now()
      const check = () => {
        let found = null
        try {
          found = findButton()
        } catch (e) {
          found = null
        }
        if (found || Date.now() - begin >= SCAN_TIMEOUT) {
          resolve(found)
          return
        }
        W.setTimeout(check, 120)
      }
      check()
    })

  return {
    name: COMPONENT_NAME,
    displayName: '换一换按钮位置自定义',
    description:
      '用左右 / 上下两个滑块自由摆放首页「换一换」按钮, 并可让它固定悬浮、点击后自动回到顶部。',
    tags: [STYLE_TAG],
    enabledByDefault: true,
    urlInclude: [/^https:\/\/www\.bilibili\.com\/$/, /^https:\/\/www\.bilibili\.com\/index\.html$/],
    options: {
      offsetX: {
        defaultValue: 0,
        displayName: '左右位置 (粗调)',
        slider: { min: -1000, max: 1000, step: 1 },
      },
      offsetXFine: {
        defaultValue: 0,
        displayName: '左右微调 (±30, 拖到大概位置后用这个精确定位)',
        slider: { min: -30, max: 30, step: 1 },
      },
      offsetY: {
        defaultValue: 0,
        displayName: '上下位置 (粗调)',
        slider: { min: -1000, max: 1000, step: 1 },
      },
      offsetYFine: {
        defaultValue: 0,
        displayName: '上下微调 (±30, 拖到大概位置后用这个精确定位)',
        slider: { min: -30, max: 30, step: 1 },
      },
      fixed: {
        defaultValue: false,
        displayName: '固定显示 (不随页面滚动)',
      },
      scrollToTopOnClick: {
        defaultValue: true,
        displayName: '点击后回到页面顶部',
      },
      showHandCursor: {
        defaultValue: true,
        displayName: '鼠标移上去显示小手 (官方样式没给，由本组件补上)',
      },
      buttonSelector: {
        defaultValue: '',
        displayName: '按钮选择器 (留空自动识别)',
      },
    },
    entry: async ({ settings, coreApis }) => {
      options = (settings && settings.options) || {}
      start()
      await waitForButton()
      apply()

      // 选项变化时立即生效(滑块在设置面板里有 200ms 防抖)
      const settingsApi = coreApis && coreApis.settings
      if (settingsApi && typeof settingsApi.addComponentListener === 'function') {
        ;[
          'offsetX',
          'offsetY',
          'offsetXFine',
          'offsetYFine',
          'fixed',
          'scrollToTopOnClick',
          'showHandCursor',
          'buttonSelector',
        ].forEach((key) => {
          settingsApi.addComponentListener(`${COMPONENT_NAME}.${key}`, () => apply())
        })
      }
      return {}
    },
    reload: () => {
      start()
      apply()
    },
    unload: () => {
      stop()
    },
  }
})()
