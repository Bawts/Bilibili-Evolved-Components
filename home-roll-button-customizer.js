/**
 * Bilibili-Evolved 第三方组件 · 换一换按钮位置自定义
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
  const Z_INDEX = 1001
  const SCAN_TIMEOUT = 3000

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

  /* ---------------------------------------------------------------- 运行状态 */

  let options = {}
  let running = false

  let button = null
  let buttonBase = null
  let originalCssText = null
  let clickHandler = null

  // 定位模式: none=原样 / fixed=position:fixed / float=滚动跟随
  let mode = 'none'
  let fixedWorks = null // null=尚未测试, true/false=已测
  let floatBase = ''
  let targetLeft = 0
  let targetTop = 0
  let lastDx = 0
  let lastDy = 0

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
  }

  const resetStyle = () => {
    if (originalCssText) {
      button.setAttribute('style', originalCssText)
    } else {
      button.removeAttribute('style')
    }
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
  const buildFloatBase = () => {
    const parts = []
    if (isStaticPositioned()) {
      parts.push('position: relative')
    }
    parts.push(`z-index: ${Z_INDEX}`)
    parts.push('transition-duration: 0s')
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
    setButtonStyle(`${floatBase};transform: translate(${dx}px, ${dy}px) !important;`)
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

  const fixedCss = (left, top) =>
    [
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
      .map((decl) => `${decl} !important`)
      .join(';')

  const positionMatches = (left, top) => {
    const rect = button.getBoundingClientRect()
    return Math.abs(rect.left - left) <= 2 && Math.abs(rect.top - top) <= 2
  }

  /* ---------------------------------------------------------------- 按钮生命周期 */

  const restoreButton = () => {
    stopFloat()
    mode = 'none'
    fixedWorks = null
    if (clickHandler && button) {
      button.removeEventListener('click', clickHandler)
    }
    clickHandler = null
    if (button) {
      resetStyle()
    }
    button = null
    buttonBase = null
    originalCssText = null
  }

  const ensureButton = () => {
    if (button && D.contains(button)) {
      return true
    }
    restoreButton()
    const found = findButton()
    if (!found) {
      return false
    }
    button = found
    originalCssText = button.getAttribute('style')
    buttonBase = measureBase()
    fixedWorks = null
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

    const offsetX = toNumber(options.offsetX, 0)
    const offsetY = toNumber(options.offsetY, 0)

    if (!options.fixed) {
      stopFloat()
      mode = 'none'
      resetStyle()
      // 两个偏移都是 0 时干脆什么都不加, 保证按钮与原生状态完全一致
      if (offsetX !== 0 || offsetY !== 0) {
        setButtonStyle(`transform: translate(${offsetX}px, ${offsetY}px) !important;`)
      }
      return
    }

    const maxLeft = Math.max(0, W.innerWidth - buttonBase.width)
    const maxTop = Math.max(0, W.innerHeight - buttonBase.height)
    targetLeft = clamp(buttonBase.left + offsetX, 0, maxLeft)
    targetTop = clamp(buttonBase.top + offsetY, 0, maxTop)

    // 方案 (a): position: fixed
    if (fixedWorks !== false) {
      stopFloat()
      mode = 'none'
      resetStyle()
      setButtonStyle(fixedCss(targetLeft, targetTop))
      if (positionMatches(targetLeft, targetTop)) {
        fixedWorks = true
        mode = 'fixed'
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
        displayName: '左右位置 (像素)',
        slider: { min: -1000, max: 1000, step: 1 },
      },
      offsetY: {
        defaultValue: 0,
        displayName: '上下位置 (像素)',
        slider: { min: -1000, max: 1000, step: 1 },
      },
      fixed: {
        defaultValue: false,
        displayName: '固定显示 (不随页面滚动)',
      },
      scrollToTopOnClick: {
        defaultValue: true,
        displayName: '点击后回到页面顶部',
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
        ;['offsetX', 'offsetY', 'fixed', 'scrollToTopOnClick', 'buttonSelector'].forEach((key) => {
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
