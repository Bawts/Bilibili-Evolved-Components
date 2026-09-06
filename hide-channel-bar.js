/**
 * Bilibili Evolved 自定义组件：隐藏首页分区导航栏  hide-channel-bar
 */
;(function (global) {
  'use strict'

  var STYLE_ID = 'be-hide-channel-bar-style'

  // 需要隐藏的导航栏。新版首页有两条：
  //   .bili-header__channel（页头文档流内）
  //   .header-channel（position: fixed 的变体）
  // 隐藏后可能残留的占位块 fixed-channel-shim 也要一并清掉
  var HIDE_CSS =
    '.bili-header__channel, .header-channel { display: none !important; }' +
    'main > .fixed-channel-shim { display: none !important; height: 0 !important; min-height: 0 !important; }'

  // 「与顶部的间距」的作用目标：按数组顺序取第一个命中的元素，只处理一个，避免 margin 叠加
  var GAP_TARGET_SELECTORS = [
    'main > .feed2', // 2025+ 新版首页
    'main > .feed4',
    '#i_cecream > .recommended-container_floor-aside', // 2023-2025 feed4 版首页
    '.recommended-container_floor-aside', // 通用兜底
  ]

  function throttle(fn, wait) {
    var timer = null
    return function () {
      if (timer) return
      timer = setTimeout(function () {
        timer = null
        fn()
      }, wait)
    }
  }

  function createComponent(coreApis, componentsTags) {
    var define = coreApis.componentApis.define
    var addComponentListener = coreApis.settings.addComponentListener

    var optionsMeta = {
      隐藏分区导航栏: { displayName: '隐藏分区导航栏', defaultValue: true },
      与顶部的间距: {
        displayName: '与顶部的间距 (px)',
        defaultValue: 12,
        slider: { min: 0, max: 100, step: 1 },
      },
      仅首页生效: { displayName: '仅首页生效', defaultValue: true },
    }
    var options = define.defineOptionsMetadata(optionsMeta)

    var state = {
      hide: true,
      gap: 12,
      onlyHome: true,
    }

    var styleEl = null
    var gapTarget = null

    function shouldRun() {
      return state.onlyHome ? location.pathname === '/' : true
    }

    function findGapTarget() {
      for (var i = 0; i < GAP_TARGET_SELECTORS.length; i++) {
        var el = document.querySelector(GAP_TARGET_SELECTORS[i])
        if (el) return el
      }
      return null
    }

    function clearGap() {
      if (gapTarget) {
        try {
          gapTarget.style.removeProperty('margin-top')
        } catch (e) {
          /* 元素已被移除，忽略 */
        }
        gapTarget = null
      }
    }

    function applyGap() {
      clearGap()
      // 只在生效页面 + 开启隐藏时应用间距；关闭隐藏则还原为 B 站默认间距
      if (!state.hide || !shouldRun()) return
      var el = findGapTarget()
      if (!el) return
      el.style.setProperty('margin-top', (Number(state.gap) || 0) + 'px', 'important')
      gapTarget = el
    }

    function sync() {
      if (styleEl) styleEl.disabled = !(state.hide && shouldRun())
      applyGap()
    }

    var entry = async ({ metadata, settings }) => {
      // 注入隐藏导航栏的样式（全站注入，用 disabled 控制启用，避免来回增删 <style>）
      if (!document.getElementById(STYLE_ID)) {
        styleEl = document.createElement('style')
        styleEl.id = STYLE_ID
        styleEl.textContent = HIDE_CSS
        ;(document.head || document.documentElement).appendChild(styleEl)
      } else {
        styleEl = document.getElementById(STYLE_ID)
      }

      Object.keys(settings.options).forEach(function (optionName) {
        addComponentListener(
          metadata.name + '.' + optionName,
          function (value) {
            if (optionName === '隐藏分区导航栏') {
              state.hide = !!value
            } else if (optionName === '与顶部的间距') {
              state.gap = Number(value) || 0
            } else if (optionName === '仅首页生效') {
              state.onlyHome = !!value
            }
            sync()
          },
          true,
        )
      })

      sync()

      // 首页内容客户端渲染，容器可能晚出现；元素被重建时也需要重新打上间距
      var onDomChange = throttle(function () {
        if (gapTarget && !gapTarget.isConnected) gapTarget = null
        if (!gapTarget) applyGap()
      }, 300)
      new MutationObserver(onDomChange).observe(document.documentElement, {
        childList: true,
        subtree: true,
      })

      // SPA / 地址栏变化（例如从首页跳到视频页再返回）
      var lastHref = location.href
      setInterval(function () {
        if (location.href !== lastHref) {
          lastHref = location.href
          sync()
        }
      }, 1000)
    }

    return define.defineComponentMetadata({
      name: 'hide-channel-bar',
      author: {
        name: 'RieN7 (clear-home) 衍生',
        link: 'https://github.com/rien7',
      },
      tags: [componentsTags.style],
      displayName: '隐藏首页分区导航栏',
      entry: entry,
      options: options,
      description: {
        'zh-CN': () =>
          Promise.resolve(
            '隐藏首页顶部分区导航栏,并用滑块调整推荐流与顶部的间距（0-100px，即时生效）。',
          ),
      },
    })
  }

  // ---- 导出：兼容 Bilibili Evolved 安装沙箱（注入 exports）与普通页面环境 ----
  var metadata = null
  function factory() {
    if (!metadata) {
      metadata = createComponent(coreApis, componentsTags)
    }
    return metadata
  }
  if (typeof module === 'object' && module && module.exports) {
    module.exports = factory()
  } else if (typeof exports === 'object') {
    exports['style/hide-channel-bar'] = factory()
  } else {
    global['style/hide-channel-bar'] = factory()
  }
})(typeof globalThis !== 'undefined' ? globalThis : window)
