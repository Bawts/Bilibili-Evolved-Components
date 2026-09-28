/**
 * Bilibili Evolved 自定义组件：换一换 · 刷新更多卡片  feed-refresh-boost  (v3.2)
 *
 * v3.2 修复：刷新后有时点开的仍是旧视频（href 被 Vue 按旧数据回写）
 *   线上 bundle（laputa-home/assets/index-*.js，BiliVideoCard）实测：
 *     · 封面/标题锚点的 href 不是静态值，而是 computed pageUrlWithProgress
 *         = info.url（旧 bvid） + (currentSeekTime>5 ? '?t=' + 进度 : '') + trackid
 *     · 悬浮预览播放时底层每隔 1s 抛 time-update → onPlayerSeek → currentSeekTime++
 *     · currentSeekTime 一变，pageUrlWithProgress 就变 → Vue 重渲染时把 href
 *       按 **props.info（旧视频）** 重新写回 DOM（本脚本改的是 DOM，Vue 数据没变）
 *     · 实测：computed 值没变时 Vue 不会写 href（脚本的改写能留住）；
 *             computed 值一变就立刻写回 —— 即预览播到第 6 秒后**每秒都被打回旧视频**
 *     · 而 v3.1 的守卫对"正在悬浮预览的卡片"是整卡跳过的（怕掐掉预览），
 *       恰好就是用户鼠标停在卡上、准备点击的那一刻 → 点下去打开旧视频。
 *   修复：① 预览活跃时也做"轻量修复"（只写回链接，不碰播放器）；
 *         ② 点击捕获阶段兜底 —— 卡片展示的仍是我们的内容、链接却指着旧视频时，
 *            拦下默认跳转，自己按正确地址打开（见 onFeedClick）。
 */
;(function (global) {
  'use strict'

  // ==================== WBI 签名 ====================
  var MIXIN_KEY_ENC_TAB = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
    27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
    37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
    22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
  ]
  var MD5_S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ]
  var MD5_K = (function () {
    var k = []
    for (var i = 0; i < 64; i++) k.push(Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0)
    return k
  })()

  function md5Hex(str) {
    var bytes = new TextEncoder().encode(String(str))
    var bitLen = bytes.length * 8
    var total = (((bytes.length + 8) >> 6) + 1) << 6
    var padded = new Uint8Array(total)
    padded.set(bytes)
    padded[bytes.length] = 0x80
    var dv = new DataView(padded.buffer)
    dv.setUint32(total - 8, bitLen >>> 0, true)
    dv.setUint32(total - 4, Math.floor(bitLen / 4294967296), true)
    var a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476
    for (var off = 0; off < total; off += 64) {
      var M = []
      for (var j = 0; j < 16; j++) M.push(dv.getUint32(off + j * 4, true))
      var A = a0, B = b0, C = c0, D = d0
      for (var i = 0; i < 64; i++) {
        var F, g
        if (i < 16) { F = (B & C) | (~B & D); g = i }
        else if (i < 32) { F = (B & D) | (C & ~D); g = (5 * i + 1) % 16 }
        else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16 }
        else { F = C ^ (B | ~D); g = (7 * i) % 16 }
        F = (F + A + MD5_K[i] + M[g]) >>> 0
        A = D; D = C; C = B
        B = (B + ((F << MD5_S[i]) | (F >>> (32 - MD5_S[i])))) >>> 0
      }
      a0 = (a0 + A) >>> 0
      b0 = (b0 + B) >>> 0
      c0 = (c0 + C) >>> 0
      d0 = (d0 + D) >>> 0
    }
    function hexWord(n) {
      var s = ''
      for (var i = 0; i < 4; i++) {
        var b = (n >>> (i * 8)) & 0xff
        s += (b < 16 ? '0' : '') + b.toString(16)
      }
      return s
    }
    return hexWord(a0) + hexWord(b0) + hexWord(c0) + hexWord(d0)
  }

  function getMixinKey(orig) {
    var s = ''
    for (var i = 0; i < MIXIN_KEY_ENC_TAB.length; i++) s += orig.charAt(MIXIN_KEY_ENC_TAB[i])
    return s.slice(0, 32)
  }

  function encWbi(params, imgKey, subKey) {
    var mixinKey = getMixinKey(imgKey + subKey)
    var out = {}
    Object.keys(params).forEach(function (k) { out[k] = params[k] })
    delete out.w_rid
    delete out.wts
    out.wts = Math.round(Date.now() / 1000)
    var keys = Object.keys(out).sort()
    var parts = []
    for (var i = 0; i < keys.length; i++) {
      var v = String(out[keys[i]]).replace(/[!'()*]/g, '')
      parts.push(encodeURIComponent(keys[i]) + '=' + encodeURIComponent(v))
    }
    var query = parts.join('&')
    return query + '&w_rid=' + md5Hex(query + mixinKey)
  }

  // ==================== 工具 ====================
  var RCMD_DEFAULT_PATH = 'https://api.bilibili.com/x/web-interface/wbi/index/top/feed/rcmd'

  function parseQuery(url) {
    var out = {}
    var idx = url.indexOf('?')
    if (idx === -1) return out
    url.slice(idx + 1).split('&').forEach(function (kv) {
      if (!kv) return
      var p = kv.indexOf('=')
      if (p === -1) return
      out[decodeURIComponent(kv.slice(0, p))] = decodeURIComponent(kv.slice(p + 1))
    })
    return out
  }

  function toHttps(u) {
    if (!u) return ''
    if (u.indexOf('//') === 0) return 'https:' + u
    return u.replace(/^http:\/\//, 'https://')
  }

  function coverUrl(pic) {
    var u = toHttps(pic)
    if (!u) return ''
    if (u.indexOf('@') === -1) u += '@672w_378h_1c.webp'
    return u
  }

  // 封面文件名（去掉 CDN 目录与 @ 参数），用来判断"这张卡展示的还是不是我们那条内容"
  function coverFile(pic) {
    try { return coverUrl(pic).split('/').pop().split('@')[0] } catch (e) { return '' }
  }

  // 首页卡片的官方链接形状：//www.bilibili.com/video/BVxxx/
  function videoPageUrl(bvid) {
    return '//www.bilibili.com/video/' + bvid + '/'
  }

  function formatCount(n) {
    n = Number(n) || 0
    if (n >= 100000000) return (n / 100000000).toFixed(1).replace(/\.0$/, '') + '亿'
    if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + '万'
    return String(n)
  }

  function formatDuration(sec) {
    sec = Number(sec)
    if (!isFinite(sec) || sec <= 0) return ''
    var h = Math.floor(sec / 3600)
    var m = Math.floor((sec % 3600) / 60)
    var s = Math.floor(sec % 60)
    function pad(x) { return x < 10 ? '0' + x : String(x) }
    return h > 0 ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s)
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms) }) }

  // ==================== 组件 ====================
  function createComponent(coreApis, componentsTags) {
    var define = coreApis.componentApis.define
    var addComponentListener = coreApis.settings.addComponentListener

    var optionsMeta = {
      刷新数量: {
        displayName: '刷新数量 (张)',
        defaultValue: 15,
        slider: { min: 1, max: 60, step: 1 },
      },
      手动输入数量: {
        displayName: '手动输入数量（填数字优先，留空用滑块）',
        defaultValue: '',
      },
      显示提示: { displayName: '显示提示', defaultValue: true },
      过渡动画: { displayName: '切换动画（默认关闭 = 官方同款直换；开启为短暂淡入淡出）', defaultValue: false },
      预取下一批: { displayName: '预取下一批（点击零等待）', defaultValue: true },
      调试日志: { displayName: '调试日志（控制台）', defaultValue: true },
    }
    var options = define.defineOptionsMetadata(optionsMeta)

    var state = { count: 15, manual: '', toast: true, debug: true, fade: true, prefetch: true }

    function getCount() {
      var m = parseInt(state.manual, 10)
      if (!isNaN(m) && m > 0) return Math.min(m, 60)
      return Math.max(1, Number(state.count) || 15)
    }

    function log() {
      if (!state.debug) return
      try {
        var args = ['[换一换扩展]']
        for (var i = 0; i < arguments.length; i++) args.push(arguments[i])
        console.log.apply(console, args)
      } catch (e) { /* 忽略 */ }
    }

    function toast(msg, ms) {
      if (!state.toast) return
      try {
        var el = document.createElement('div')
        el.textContent = msg
        el.style.cssText =
          'position:fixed;right:24px;bottom:80px;z-index:2147483000;max-width:320px;' +
          'background:rgba(0,0,0,.85);color:#fff;padding:8px 14px;border-radius:8px;' +
          'font-size:13px;line-height:1.5;pointer-events:none;transition:opacity .3s'
        document.body.appendChild(el)
        setTimeout(function () {
          el.style.opacity = '0'
          setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el) }, 400)
        }, ms || 4000)
      } catch (e) { /* 忽略 */ }
    }

    // 预加载封面：把图片先下载进缓存，改写时才能"同一帧"一起变脸，
    // 否则标题先变、封面后到，看起来就是各自刷新 + 重影
    function preloadCovers(items, ms) {
      return new Promise(function (resolve) {
        var urls = []
        items.forEach(function (it) {
          if (it && it.pic) urls.push(coverUrl(it.pic))
        })
        if (!urls.length) return resolve()
        var left = urls.length
        var finished = false
        function finish() {
          if (finished) return
          finished = true
          resolve()
        }
        var timer = setTimeout(finish, ms || 1800)
        urls.forEach(function (u) {
          var im = new Image()
          im.onload = im.onerror = function () {
            left--
            if (left <= 0) {
              clearTimeout(timer)
              finish()
            }
          }
          im.src = u
        })
      })
    }

    // 可选的过渡：先淡出再淡入，让 15 张看起来是"整体刷新"而不是逐张替换
    function fadeCards(cards, n, on) {
      if (!state.fade) return
      try {
        for (var i = 0; i < n && i < cards.length; i++) {
          cards[i].style.transition = 'opacity .15s ease'
          cards[i].style.opacity = on ? '0.15' : ''
        }
        if (!on) {
          setTimeout(function () {
            for (var k = 0; k < n && k < cards.length; k++) cards[k].style.transition = ''
          }, 250)
        }
      } catch (e) { /* 忽略 */ }
    }

    // ---- 抓取到的接口信息 ----
    var lastParams = null
    var lastPath = RCMD_DEFAULT_PATH
    var lastNativeItems = []
    var lastNativeAt = 0
    var btnEl = null
    var busy = false
    var pendingBoost = false
    var prefetched = []
    var prefetchedAt = 0
    var warming = false

    // ---- 卡片改写 ----
    var FEED_SELECTORS = [
      'main > .feed2 > .recommended-container_floor-aside > .container',
      '#i_cecream .recommended-container_floor-aside > .container',
      '.recommended-container_floor-aside > .container',
      '.recommended-container_floor-aside .container',
      'main .recommended-container_floor-aside',
      '.recommended-container_floor-aside',
      'main > .feed2',
      '#i_cecream',
    ]

    var lastCardsSelector = ''
    var lastCardsRaw = 0

    // 过滤掉"看不见的卡片"：轮播区内部、被隐藏的、尺寸异常的
    // （首页轮播 .recommended-swipe 里的卡片也是 .bili-video-card，排在 DOM 最前面，
    //   不过滤的话会白白吃掉前几张的名额）
    function usableCard(el) {
      try {
        var p = el.parentElement
        for (var i = 0; i < 6 && p; i++) {
          var cls = typeof p.className === 'string' ? p.className : ''
          if (cls && /recommended-swipe|swipe|carousel|bili-live-card/.test(cls)) return false
          p = p.parentElement
        }
        var r = el.getBoundingClientRect()
        if (r.width < 60 || r.height < 60) return false
        if (el.offsetParent === null) {
          var cs = global.getComputedStyle ? global.getComputedStyle(el) : null
          if (!cs || cs.position !== 'fixed') return false
        }
        return true
      } catch (e) {
        return true
      }
    }

    function getCards() {
      var i, all = []
      for (i = 0; i < FEED_SELECTORS.length; i++) {
        var el = document.querySelector(FEED_SELECTORS[i])
        if (!el) continue
        var found = el.querySelectorAll('.bili-video-card')
        if (found && found.length) {
          lastCardsSelector = FEED_SELECTORS[i]
          all = Array.prototype.slice.call(found)
          break
        }
      }
      if (!all.length) {
        lastCardsSelector = 'document'
        all = Array.prototype.slice.call(document.querySelectorAll('.bili-video-card'))
      }
      lastCardsRaw = all.length
      var out = all.filter(usableCard)
      return out.length ? out : all
    }

    var dumped = false
    function dumpCardHtml(cards) {
      if (dumped || !state.debug) return
      dumped = true
      try {
        log('卡片数：过滤前 ' + lastCardsRaw + '，过滤后 ' + cards.length + '，容器 ' + lastCardsSelector)
        if (cards[0]) log('卡片1 HTML: ' + cards[0].outerHTML.slice(0, 1400))
        if (cards[9]) log('卡片10 HTML: ' + cards[9].outerHTML.slice(0, 1400))
      } catch (e) { /* 忽略 */ }
    }

    function bvidOf(card) {
      if (!card) return ''
      var a = card.querySelector('a[href*="/video/"]')
      if (!a) return ''
      var m = (a.getAttribute('href') || '').match(/(BV[0-9A-Za-z]+)/)
      return m ? m[1] : ''
    }

    function screenBvids(max) {
      var out = {}
      getCards().slice(0, max || 60).forEach(function (c) {
        var b = bvidOf(c)
        if (b) out[b] = true
      })
      return out
    }

    function isValidItem(it) {
      return !!(it && it.bvid && it.pic && it.title)
    }

    // 线上实现（首页 index-*.js / index-legacy-*.js 的 v-inline-player 指令）实测：
    //   1) 卡片挂载时 new oG(el, {aid, bvid, cid...}, config)，实例挂到 el.__INLINE_PLAYER__，
    //      并往 el 里插入 <div class="v-inline-player"> 作为播放器容器（el 就是
    //      .bili-video-card__image--wrap）；
    //   2) 鼠标移入 → 适配器(nG / az).initPlayer(option, config) 用
    //      JSON.stringify({...option, random}) 生成 playerId，把 [playerId, 播放器实例]
    //      放进 window.blInlinePlayers；上限是 config.maxCache，而它来自
    //      inject('maxInlinePlayerIns', 8) —— 应用根组件 provide 的是 **1**
    //      （源码：ze("maxInlinePlayerIns",1) / h=Ce("maxInlinePlayerIns",8)），
    //      所以登记表里**永远只有 1 条**：每次 hover 都会把上一条 splice 掉并 disconnect；
    //   3) 再次移入同一张卡：只有 playerId 在 blInlinePlayers 里查不到时才重建播放器，
    //      否则直接复用旧实例 —— connect() 中 status === 'closed' && connected 时走
    //      replay() 续播，压根不会重新读 option.bvid。
    // 这就是"刷新后同一位置预览还是旧视频"的根因：只改了 option，没有作废旧播放器实例，
    // 它就一直把旧媒体的 replay() 放给我们看。
    // （"先看一个别的视频再回来看就正常"：因为 maxCache=1，hover 别的卡会把这一条
    //   挤掉并 disconnect，回来时 playerId 查不到 → 重建 → 才读到新的 option。）
    // 修复：改写卡片时把该位置的实例从登记表摘掉并完整释放，下次 hover 必然重建。

    // 完整释放一个播放器实例（官方类 iz / iG）：无条件先断开 nano，再走官方 disconnect，
    // 最后兜底清状态（官方 disconnect 有 connected 守卫，未连接时会漏掉 nano）。
    function killInstance(inst) {
      if (!inst) return
      try {
        var nano = inst.player
        if (nano && typeof nano.disconnect === 'function') nano.disconnect()
      } catch (e) { /* 忽略 */ }
      try { if (typeof inst.disconnect === 'function') inst.disconnect() } catch (e) { /* 忽略 */ }
      try {
        inst.connected = false
        inst.status = 'unload'
        inst.player = null
        inst.onDisconnect = null
      } catch (e) { /* 忽略 */ }
    }

    // 播放器实例 / 适配器是否挂在这个 wrap 下
    // （两者的 .element 都是那个 .v-inline-player 容器 div）
    function belongsTo(node, wrap) {
      try {
        var el = node && node.element
        if (!el || !wrap) return false
        return el === wrap || (wrap.contains ? wrap.contains(el) : false)
      } catch (e) {
        return false
      }
    }

    // 作废某张卡片上"已经存在"的悬浮预览，让下一次 hover 按新 option 重建。
    // 注意：容器 div 本身不能删（适配器还持有它），只清掉里面的旧 <video> 和续播进度。
    function purgeInlinePlayer(wrap) {
      var killed = 0
      try {
        if (!wrap) return 0
        var reg = global.blInlinePlayers
        if (reg && reg.length) {
          for (var i = reg.length - 1; i >= 0; i--) {
            var inst = reg[i] && reg[i][1]
            if (!inst || !belongsTo(inst, wrap)) continue
            killInstance(inst)
            reg.splice(i, 1) // ← 关键：摘出登记表，下次 hover 的 findIndex 必然落空
            killed++
          }
        }
        // 全局"当前正在播"指针若指向这张卡，一并清掉
        var act = global.blActiveInlinePlayer
        if (act && (belongsTo(act, wrap) || belongsTo(act.instance, wrap))) {
          global.blActiveInlinePlayer = {}
        }
        // 容器残留：旧的 <video> 元素 + data-player-seek-time 续播进度。
        // 进度属性无条件清（新建播放器会 seek 到它上面）；
        // 但 DOM 只在真的释放掉实例后才清 —— 见上面的"关键教训"。
        var boxes = wrap.querySelectorAll('.v-inline-player, .v-inline-live-player')
        for (var k = 0; k < boxes.length; k++) {
          try {
            boxes[k].removeAttribute('data-player-seek-time')
            if (killed > 0) {
              if (boxes[k].classList) boxes[k].classList.remove('visible', 'mouse-in')
              if (boxes[k].children && boxes[k].children.length) boxes[k].innerHTML = ''
            }
          } catch (e) { /* 忽略 */ }
        }
      } catch (e) { /* 忽略 */ }
      return killed
    }

    // ==================== 悬浮预览：把旧播放器彻底作废 ====================
    // ------------------------------------------------------------------
    // 为什么需要"桥"：脚本（Bilibili Evolved）很可能跑在隔离世界(isolated world)里 ——
    // DOM 树是共享的，但**页面 JS 的全局变量和 DOM 上的扩展属性（expando）看不到**。
    // 而我们要动的两样东西恰好都是这类：
    //   · window.blInlinePlayers（页面 JS 全局）
    //   · el.__INLINE_PLAYER__（DOM 扩展属性）
    // 实测日志"清理旧播放器 0 个"+"实际=null"正是看不到它们的表现。
    // 解决办法：往页面里注入一段跑在**主世界**的脚本（bridge），由它来做脏活；
    // 本组件只通过在卡片上写 data-* 属性（属性跨世界共享）给它下命令。
    // 若两者本来就同世界，桥照样工作，只是重复做一遍，无害。
    // ------------------------------------------------------------------

    // ⚠ 关键教训（v3.1）：**播放器实例还活着的时候，绝不能清空它容器的 DOM**。
    // 实测：无条件 innerHTML='' 会把还活着的 nano 播放器的 <video> 从容器里挖掉，
    // 而 nano 是按容器元素复用播放器的 —— 结果就是这个位置"彻底放不出预览"。
    // 所以只有真的把实例 disconnect 掉了（killed > 0）才清容器；
    // 没找到实例时，说明它早被登记表淘汰并 disconnect 过，DOM 也已释放，别动它。
    // 另外 data-player-seek-time 一定要清：config.continuous 为 true，
    // 新建的播放器 connect() 会 seek 到这个旧进度上。

    // ---- 桥：跑在页面主世界，能碰到 __INLINE_PLAYER__ / blInlinePlayers ----
    // 注意：这个函数会被 toString() 后注入页面，里面**不能引用任何闭包变量**。
    function bridgeMain() {
      if (window.__beBoostBridge) return
      function belongsTo(node, wrap) {
        try {
          var el = node && node.element
          if (!el || !wrap) return false
          return el === wrap || wrap.contains(el)
        } catch (e) {
          return false
        }
      }
      function kill(inst) {
        try {
          var p = inst.player
          if (p && typeof p.disconnect === 'function') p.disconnect()
        } catch (e) {}
        try {
          if (typeof inst.disconnect === 'function') inst.disconnect()
        } catch (e) {}
        try {
          inst.connected = false
          inst.status = 'unload'
          inst.player = null
          inst.onDisconnect = null
        } catch (e) {}
      }
      function purge(wrap) {
        var killed = 0
        try {
          var reg = window.blInlinePlayers
          if (reg && reg.length) {
            for (var i = reg.length - 1; i >= 0; i--) {
              var inst = reg[i] && reg[i][1]
              if (!inst || !belongsTo(inst, wrap)) continue
              kill(inst)
              reg.splice(i, 1)
              killed++
            }
          }
          var act = window.blActiveInlinePlayer
          if (act && (belongsTo(act, wrap) || belongsTo(act.instance, wrap))) {
            window.blActiveInlinePlayer = {}
          }
          var boxes = wrap.querySelectorAll('.v-inline-player, .v-inline-live-player')
          for (var k = 0; k < boxes.length; k++) {
            try {
              boxes[k].removeAttribute('data-player-seek-time')
              // 只有真释放掉实例了才动 DOM，否则这个位置会彻底放不出预览
              if (killed > 0) {
                if (boxes[k].classList) boxes[k].classList.remove('visible', 'mouse-in')
                boxes[k].innerHTML = ''
              }
            } catch (e) {}
          }
        } catch (e) {}
        return killed
      }
      function apply(card) {
        try {
          var bv = card.getAttribute('data-be-boost-bv')
          if (!bv) return -1
          var wrap = card.querySelector('.bili-video-card__image--wrap') || card
          var pl = wrap.__INLINE_PLAYER__
          if (pl && pl.option && typeof pl.option === 'object') {
            var aid = card.getAttribute('data-be-boost-aid')
            var cid = card.getAttribute('data-be-boost-cid')
            pl.option.bvid = bv
            if (aid && !isNaN(Number(aid))) pl.option.aid = Number(aid)
            if (cid && !isNaN(Number(cid))) pl.option.cid = Number(cid)
            // 先按官方方式收起正在播的预览（顺带去掉 mouse-in/visible 标记）
            try {
              if (typeof pl.cancel === 'function') pl.cancel()
            } catch (e) {}
          }
          return purge(wrap)
        } catch (e) {
          return -1
        }
      }
      var mo = new MutationObserver(function (ms) {
        for (var i = 0; i < ms.length; i++) {
          var el = ms[i].target
          if (!el || !el.getAttribute) continue
          var card = el.closest ? el.closest('.bili-video-card') : null
          if (!card) continue
          var v = card.getAttribute('data-be-boost-bv')
          if (!v) continue
          // 不做"同值跳过"：卡片被 Vue 重新挂载后预览会退回旧数据，
          // 守卫会再次改写同一张卡（bvid 不变），这时必须再作废一次。
          try {
            apply(card)
          } catch (e) {}
        }
      })
      try {
        mo.observe(document.documentElement, {
          subtree: true,
          attributes: true,
          attributeFilter: ['data-be-boost-bv'],
        })
      } catch (e) {}
      window.__beBoostBridge = { apply: apply, purge: purge, v: 1 }
    }

    function injectBridge() {
      try {
        var code = '(' + bridgeMain.toString() + ')();'
        var s = document.createElement('script')
        s.setAttribute('data-be-boost-bridge', '1')
        s.textContent = code
        ;(document.head || document.documentElement).appendChild(s)
        setTimeout(function () {
          try {
            s.parentNode && s.parentNode.removeChild(s)
          } catch (e) {}
        }, 0)
      } catch (e) { /* 忽略 */ }
    }

    // 给卡片下命令：写 data-* 属性（跨世界可见），桥收到后在主世界改 option + 作废播放器
    function requestPreviewSwap(card, item) {
      if (!card || !item || !item.bvid) return
      try {
        card.setAttribute('data-be-boost-aid', item.aid != null && !isNaN(Number(item.aid)) ? String(Number(item.aid)) : '')
        card.setAttribute('data-be-boost-cid', item.cid != null && !isNaN(Number(item.cid)) ? String(Number(item.cid)) : '')
        card.setAttribute('data-be-boost-bv', String(item.bvid))
      } catch (e) { /* 忽略 */ }
      // 同世界的话桥对象可直接看见，顺手同步调一次（更快）
      try {
        if (global.__beBoostBridge && global.__beBoostBridge.apply) global.__beBoostBridge.apply(card)
      } catch (e) { /* 忽略 */ }
    }


    // ---- 防伪标记：把"这张卡显示的是谁"钉在元素上 ----
    // 为什么要钉：本脚本改的是 DOM，Vue 的 props.info 没变，所以只要它那侧有个
    // reactive 值在变（首页就是悬浮预览的播放进度），重渲染就会把 href 按旧视频写回去。
    // 而**标题文字** Vue 不会回写（文本节点是"值不同才写"，它的值一直没变过），
    // 于是"标题还是我们写的那句"就成了"这位置展示的确实是我们的内容"的可靠凭证；
    // 封面文件名与目标 URL 一并记下，前者作老版本卡片的兜底判据，后者供点击兜底直接跳转。
    function markBoosted(card, item) {
      try {
        card.setAttribute('data-be-boosted', String(item.bvid))
        card.setAttribute('data-be-boost-title', String(item.title || ''))
        card.setAttribute('data-be-boost-pic', coverFile(item.pic))
        card.setAttribute('data-be-boost-url', videoPageUrl(item.bvid))
      } catch (e) { /* 忽略 */ }
    }

    // 轻量修复：只把"会被 Vue 重渲染写回"的两项写回去 —— 视频链接 href 与标题框 title。
    // 悬浮预览播放中（容器带 mouse-in/visible）时整卡 patchCard 会 cancel/purge 播放器，
    // 把用户正在看的预览掐掉，所以 v3.1 是直接跳过；但恰恰是这个时候首页的 href 正被
    // Vue 按旧视频回写（预览播到第 6 秒后每秒一次），跳过 = 放任点错视频。
    function patchLinksOnly(card, item) {
      if (!card || !item || !item.bvid) return false
      var changed = false
      try {
        var href = '/video/' + item.bvid
        var links = card.querySelectorAll('a[href*="/video/"]')
        for (var i = 0; i < links.length; i++) {
          if (links[i].getAttribute('href') !== href) {
            links[i].setAttribute('href', href)
            changed = true
          }
          if (!links[i].getAttribute('target')) links[i].setAttribute('target', '_blank')
        }
        var tB = card.querySelector('.bili-video-card__info--tit')
        if (tB && item.title && tB.getAttribute('title') !== item.title) {
          tB.setAttribute('title', item.title)
          changed = true
        }
        markBoosted(card, item)
      } catch (e) { /* 忽略 */ }
      return changed
    }

    function titleTextOf(card) {
      try {
        var tA = card.querySelector('.bili-video-card__info--tit a, h3 a')
        return tA ? String(tA.textContent || '').trim() : ''
      } catch (e) { return '' }
    }

    function coverFileOfCard(card) {
      try {
        var img = card.querySelector('picture img, img')
        var src = img ? String(img.getAttribute('src') || '') : ''
        return src ? src.split('/').pop().split('@')[0] : ''
      } catch (e) { return '' }
    }

    // ---- 点击兜底：点下去的那一刻，"谁在显示"就打开谁 ----
    // 捕获阶段接管，早于锚点自身的 onClick，也早于浏览器按 href 跳转。
    // 只在"卡片展示的仍是我们的内容、但链接指着旧视频"时才动手，其余一律放行。
    function onFeedClick(e) {
      try {
        if (e.button !== 0 && e.button !== 1) return
        if (e.defaultPrevented) return
        var t = e.target
        if (!t || !t.closest) return
        // 只接管"视频链接"上的点击：UP 名（space.bilibili.com）等一律不碰
        var a = t.closest('a[href*="/video/"]')
        if (!a) return
        var card = a.closest('.bili-video-card')
        if (!card || !card.getAttribute) return
        var want = card.getAttribute('data-be-boosted')
        if (!want) return
        // 卡片内还有别的可点控件（稍后再看 bili-watch-later / 不感兴趣面板等）也长在封面
        // 锚点里，它们点了不是"打开视频"，一律放行；封面遮罩里的统计区不算控件，不排除。
        for (var d = 0, node = t; d < 5 && node && node !== card; d++) {
          var cls = typeof node.className === 'string' ? node.className : ''
          if (node.tagName === 'BUTTON' || /watch-later|watchLater|no-interest|complain|tips/.test(cls)) return
          node = node.parentElement
        }
        // 凭证校验：**标题文字是主凭证** —— 文案只有在 Vue 那侧的数据真的变了时才会被
        // 重写（文本节点是"值不同才写"），而封面图由懒加载组件 VImg 托管、可能被它按
        // props 重新写回，不适合当门禁。所以：
        //   标题标记存在 → 标题必须对得上；标记缺失（老版本留下的卡）时才退回看封面。
        // 标题对不上 = 这位置已经真的换成别的视频了（例如原生换一换），一律放行。
        var wantTitle = card.getAttribute('data-be-boost-title') || ''
        var wantPic = card.getAttribute('data-be-boost-pic') || ''
        var okTitle = !!wantTitle && titleTextOf(card) === wantTitle
        var okPic = !!wantPic && coverFileOfCard(card) === wantPic
        if (!(wantTitle ? okTitle : okPic)) return
        // 链接本来就是新视频 → 完全交给浏览器默认行为，不做任何干预
        if (bvidOf(card) === want) return

        var url = card.getAttribute('data-be-boost-url') || videoPageUrl(want)
        log('点击兜底：链接已被回写成旧视频，按卡片展示内容打开 ' + url)
        e.preventDefault()
        e.stopPropagation()
        if (e.stopImmediatePropagation) e.stopImmediatePropagation()
        // 顺手把 DOM 也扶正（不影响本次跳转，只让下次点击/中键不再踩坑）
        try {
          var links = card.querySelectorAll('a[href*="/video/"]')
          for (var k = 0; k < links.length; k++) links[k].setAttribute('href', url)
        } catch (e2) { /* 忽略 */ }
        // 官方点击副作用里唯一有用的一项：清掉续播进度，免得下次悬浮接着上次播
        try {
          var bx = card.querySelectorAll('.v-inline-player, .v-inline-live-player')
          for (var b = 0; b < bx.length; b++) bx[b].removeAttribute('data-player-seek-time')
        } catch (e3) { /* 忽略 */ }
        var newTab = e.button === 1 || e.ctrlKey || e.metaKey ||
          String(a.getAttribute('target') || '') === '_blank'
        if (newTab) {
          var w = null
          try { w = global.open(url, '_blank') } catch (e4) { w = null }
          if (!w) global.location.href = url
        } else {
          global.location.href = url
        }
      } catch (e5) { /* 忽略 */ }
    }

    function patchCard(card, item, verbose) {
      var hit = { img: 0, title: 0, up: 0, stats: 0, dur: 0, links: 0 }
      try {
        if (!card || !item) return false
        var bvid = item.bvid
        var href = '/video/' + bvid

        var vlinks = card.querySelectorAll('a[href*="/video/"]')
        var i
        for (i = 0; i < vlinks.length; i++) {
          vlinks[i].setAttribute('href', href)
          if (!vlinks[i].getAttribute('target')) vlinks[i].setAttribute('target', '_blank')
          hit.links++
        }

        if (item.pic) {
          var cover = coverUrl(item.pic)
          var img =
            card.querySelector('.bili-video-card__image img') ||
            card.querySelector('.bili-video-card__cover img') ||
            card.querySelector('picture img') ||
            card.querySelector('img')
          if (img) {
            hit.img = 1
            img.removeAttribute('srcset')
            img.removeAttribute('data-src')
            img.setAttribute('src', cover)
            img.setAttribute('alt', item.title)
            // picture > source 会抢在 img 前面生效，必须一起改
            var sources = card.querySelectorAll('picture source')
            for (i = 0; i < sources.length; i++) {
              sources[i].removeAttribute('srcset')
              sources[i].setAttribute('srcset', cover)
            }
          } else {
            // 极端情况：卡片里没有 img，直接给图片容器铺背景图
            var wrap = card.querySelector(
              '.bili-video-card__image, .bili-video-card__image--wrap, .bili-video-card__cover'
            )
            if (wrap) {
              hit.img = 2
              wrap.style.backgroundImage = 'url("' + cover + '")'
              wrap.style.backgroundSize = 'cover'
            }
          }
        }

        var titleA =
          card.querySelector('.bili-video-card__info--tit a') ||
          card.querySelector('h3 a') ||
          (vlinks.length ? vlinks[vlinks.length - 1] : null)
        if (titleA && item.title) {
          hit.title = 1
          titleA.textContent = item.title
          titleA.setAttribute('title', item.title)
          // 【必须有】标题框 h3 上的 title 属性也要一起换代。
          // B站 全局样式里有这类规则（text-indent 会被继承，而标题框又是
          // overflow:hidden + 固定两行高）：
          //   [title^=「],[title^=『],[title^=【]{text-indent:-.6em}
          //   .win [title^=《]{text-indent:-.5em}   .win [title^=“]{text-indent:-.1em}
          //   .win [title^=～]{text-indent:-.25em}  .mac [title^=《]{text-indent:-.4em}
          // 这些规则本来是给"标题以《/【 开头"时对齐标点墨迹用的。但 h3 上留着的
          // 还是上个视频的旧标题，旧标题以《/【/～/“ 开头、新标题不是时，首行会被
          // 左移 0.5em 左右，再被 h3 的 overflow:hidden 裁掉 —— 表现出来就是
          // "第一个字少了半个"。同步 title 后这套规则会按新标题正确命中。
          var titleBox =
            (titleA.closest && titleA.closest('.bili-video-card__info--tit')) ||
            card.querySelector('.bili-video-card__info--tit')
          if (titleBox) {
            titleBox.setAttribute('title', item.title)
            // 新标题不以那几类标点开头时，把继承来的 text-indent 显式归零，彻底不左移
            titleBox.style.textIndent = /^[「『【《～“]/.test(item.title) ? '' : '0'
          }
          if (verbose) log('   标题元素: ' + titleA.outerHTML.slice(0, 240))
        }

        if (item.owner && item.owner.name) {
          // 新版首页卡片里, UP 名是 <span class="...info--author">, 真正可点的
          // 链接是它外面那层 <a class="bili-video-card__info--owner" href="//space.bilibili.com/xxx">。
          // 旧实现只改了 span 的文字、没改外层 <a> 的 href, 导致点击 UP 名永远跳去
          // 该位置原来那个视频的 UP 主页。这里把文字和链接一起改成新数据。
          var nameEl = card.querySelector(
            '.bili-video-card__info--author, [class*="info--author"]'
          )
          var upLink =
            card.querySelector(
              'a.bili-video-card__info--owner, a[class*="info--owner"], ' +
                'a[class*="info--up"], a[href*="space.bilibili.com"]'
            )
          if (!upLink && nameEl) {
            var anchorEl = nameEl.tagName === 'A' ? nameEl : null
            if (!anchorEl) {
              var pn = nameEl.parentElement
              for (var ai = 0; ai < 4 && pn; ai++) {
                if (pn.tagName === 'A') { anchorEl = pn; break }
                pn = pn.parentElement
              }
            }
            upLink = anchorEl
          }
          if (nameEl) {
            hit.up = 1
            nameEl.textContent = item.owner.name
            nameEl.setAttribute('title', item.owner.name)
          }
          if (upLink && item.owner.mid) {
            hit.upLink = 1
            upLink.setAttribute('href', '//space.bilibili.com/' + item.owner.mid)
            if (!upLink.getAttribute('target')) upLink.setAttribute('target', '_blank')
          }
        }

        var stats = card.querySelectorAll('.bili-video-card__stats--text')
        if (stats.length === 0) stats = card.querySelectorAll('.bili-video-card__stats span')
        if (item.stat) {
          if (stats[0] && item.stat.view !== undefined) stats[0].textContent = formatCount(item.stat.view)
          if (stats[1] && item.stat.danmaku !== undefined) stats[1].textContent = formatCount(item.stat.danmaku)
          hit.stats = stats.length
        }
        if (item.duration) {
          var dur = card.querySelector('.bili-video-card__stats__duration, [class*="stats__duration"]')
          var ds = formatDuration(item.duration)
          if (dur && ds) { hit.dur = 1; dur.textContent = ds }
        }

        // ---- 悬浮预览同步 ----
        // 首页悬浮预览是 .bili-video-card__image--wrap 上的 v-inline-player 指令实现的:
        // 挂载时把 aid/cid/bvid 快照进 element.__INLINE_PLAYER__.option, 鼠标移上去时才
        // 用这份快照去建播放器。纯 DOM 改写盖不掉它, 所以刷新后悬浮预览放的一直是旧数据。
        // 这里做两件事: 1) 把快照改成新视频的 aid/cid/bvid; 2) 把该位置已经建好的旧播放器
        // 作废(摘出 window.blInlinePlayers + 释放 nano + 清掉容器里的旧 <video>) ——
        // 只改快照是不够的, 只要旧实例还在登记表里, 下次 hover 就会走 replay() 续播旧媒体。
        try {
          var iwWrap =
            card.querySelector('.bili-video-card__image--wrap') ||
            card.querySelector('.bili-video-card__image') ||
            card
          var inlPl = iwWrap && iwWrap.__INLINE_PLAYER__
          var inlOpt = inlPl && (inlPl.option || null)
          if (inlOpt && typeof inlOpt === 'object') {
            if (item.aid != null && !isNaN(Number(item.aid))) inlOpt.aid = Number(item.aid)
            if (item.cid != null && !isNaN(Number(item.cid))) inlOpt.cid = Number(item.cid)
            if (item.bvid) inlOpt.bvid = String(item.bvid)
            hit.prev = 1
          }
          // 真正的作废动作交给页面主世界的桥去做（本世界看不到 __INLINE_PLAYER__ /
          // blInlinePlayers 时，下面这行同世界调用只是空转，桥会通过属性变化接管）。
          requestPreviewSwap(card, item)
          // 同世界时本地也走一遍（幂等，且只在真杀掉实例时才清容器）
          purgeInlinePlayer(iwWrap)
        } catch (e3) { /* 忽略 */ }

        markBoosted(card, item)
        if (verbose) log('  卡片细节 ' + JSON.stringify(hit))
        return true
      } catch (e) {
        if (verbose) log('  卡片改写异常', e)
        return false
      }
    }

    function applyItems(items, verboseIdx) {
      var cards = getCards()
      var n = Math.min(items.length, cards.length)
      var done = 0
      for (var i = 0; i < n; i++) {
        var verbose = verboseIdx && verboseIdx.indexOf(i) !== -1
        if (verbose) log('  第 ' + (i + 1) + ' 张卡片改写：')
        if (patchCard(cards[i], items[i], verbose)) done++
      }
      return done
    }

    // ---- 守卫：改完后 15 秒内逐张校验，被 Vue 覆盖就改回来 ----
    var guardItems = []
    var guardUntil = 0
    var lastBoostAt = 0
    var repairCount = 0

    function armGuard(items) {
      guardItems = items.slice()
      guardUntil = Date.now() + 15000
      lastBoostAt = Date.now()
      repairCount = 0
    }

    // 该卡片是否正处于悬浮预览播放中(容器带 mouse-in/visible)?
    // 是的话守卫跳过改写 —— 播放中动 DOM/cancel 会把用户正在看的预览掐掉,
    // 这也是"刷新后预览时好时坏"的一大来源。
    function isCardPreviewActive(card) {
      try {
        var bx = card.querySelector('.v-inline-player, .v-inline-live-player')
        if (!bx || !bx.className) return false
        var cs = ' ' + bx.className + ' '
        return cs.indexOf(' mouse-in ') !== -1 || cs.indexOf(' visible ') !== -1
      } catch (e) {
        return false
      }
    }

    function verifyAndRepair() {
      if (!guardItems.length) return
      if (Date.now() > guardUntil) {
        guardItems = []
        return
      }
      var cards = getCards()
      var fixedFull = 0
      var fixedLight = 0
      for (var i = 0; i < guardItems.length && i < cards.length; i++) {
        if (cardMatches(cards[i], guardItems[i])) continue
        if (isCardPreviewActive(cards[i])) {
          // 正在悬浮预览：不能整卡改写（会 cancel/purge 掉用户正看的播放器），
          // 但**链接必须修** —— 预览播到第 6 秒起，Vue 每秒都会把 href 按旧视频
          // 写回去；不管它，用户此刻（鼠标就停在卡上）一点就是旧视频。
          if (patchLinksOnly(cards[i], guardItems[i])) fixedLight++
        } else {
          patchCard(cards[i], guardItems[i])
          fixedFull++
        }
      }
      if (fixedFull && repairCount < 6) {
        repairCount++
        log('守卫修复 ' + fixedFull + ' 张（第 ' + repairCount + ' 轮）' +
          (fixedLight ? '，另有 ' + fixedLight + ' 张预览中只修链接' : ''))
      }
    }

    // 判断某张卡片是否已经是我们想要的内容（BV 号 + 封面文件名都要对得上，
    // 另外 UP 主页链接与悬浮预览快照也要对得上，否则 Vue 一重渲染就退回旧数据）
    function cardMatches(card, item) {
      if (!card || !item) return true
      var cb = bvidOf(card)
      if (cb !== item.bvid) return false
      try {
        var img = card.querySelector('picture img, img')
        var src = card.querySelector('picture source')
        if (img && item.pic) {
          var want = coverUrl(item.pic).split('/').pop().split('@')[0]
          if (!want) return true
          var cur = (img.getAttribute('src') || '') + '|' + (src ? src.getAttribute('srcset') || '' : '')
          if (cur.indexOf(want) === -1) return false
        }
      } catch (e) { /* 忽略 */ }
      if (item.owner && item.owner.mid) {
        try {
          var upA =
            card.querySelector(
              'a.bili-video-card__info--owner, a[class*="info--owner"], a[href*="space.bilibili.com"]'
            )
          if (upA) {
            var hrefSeg = String(upA.getAttribute('href') || '').split('/').pop().split('?')[0]
            if (hrefSeg && hrefSeg !== String(item.owner.mid)) return false
          }
        } catch (e) { /* 忽略 */ }
      }
      try {
        // 标题文字 + 标题框上的 title 属性都要校验：Vue 重渲染把标题写回旧值时，
        // 单靠 BV/封面是发现不了的（封面往往没变），而那种"文字是新的、title 属性是旧的"
        // 状态正是首字被裁的成因，必须让守卫把它修回来。
        var tA = card.querySelector('.bili-video-card__info--tit a, h3 a')
        if (tA && item.title && (tA.textContent || '') !== item.title) return false
        var tB = card.querySelector('.bili-video-card__info--tit')
        if (tB && item.title && tB.getAttribute('title') !== item.title) return false
      } catch (e) { /* 忽略 */ }
      try {
        var plW = card.querySelector('.bili-video-card__image--wrap')
        var pl = plW && plW.__INLINE_PLAYER__
        var po = pl && pl.option
        if (po && po.bvid && item.bvid && po.bvid !== item.bvid) return false
      } catch (e) { /* 忽略 */ }
      return true
    }

    function startGuard() {
      if (global.__beBoostGuard) return
      global.__beBoostGuard = true
      // 250ms 一轮: Vue 悬停重渲染会把 href/预览快照退回旧值, 收得越紧, 用户可感知的错位窗口越小
      setInterval(verifyAndRepair, 250)
    }

    // ---- WBI key ----
    var wbiKeys = null
    function getWbiKeys() {
      if (wbiKeys) return Promise.resolve(wbiKeys)
      return fetch('https://api.bilibili.com/x/web-interface/nav', { credentials: 'include' })
        .then(function (r) { return r.json() })
        .then(function (json) {
          var w = json && json.data && json.data.wbi_img
          if (!w || !w.img_url || !w.sub_url) {
            log('nav 未返回 wbi_img，json.code =', json && json.code)
            return null
          }
          function base(u) { return String(u).split('/').pop().split('.')[0] }
          wbiKeys = { img: base(w.img_url), sub: base(w.sub_url) }
          log('WBI key 获取成功')
          return wbiKeys
        })
        .catch(function (e) { log('nav 请求失败', e); return null })
    }

    function defaultParams() {
      var w = global.screen ? global.screen.width : 1920
      var h = global.screen ? global.screen.height : 1080
      return {
        web_location: '1430654',
        feed_version: 'V8',
        homepage_ver: '1',
        fresh_type: '4',
        brush: '1',
        fresh_idx: '1',
        fresh_idx_1h: '1',
        fetch_row: '1',
        y_num: '4',
        last_y_num: '5',
        screen: w + '-' + h,
      }
    }

    function buildParams(ps, round) {
      var p = lastParams ? Object.assign({}, lastParams) : defaultParams()
      p.ps = ps
      if ('fresh_idx' in p) p.fresh_idx = String((parseInt(p.fresh_idx, 10) || 0) + round)
      if ('fresh_idx_1h' in p) p.fresh_idx_1h = String((parseInt(p.fresh_idx_1h, 10) || 0) + round)
      if ('brush' in p) p.brush = '1'
      return p
    }

    function requestBatch(ps, round) {
      return getWbiKeys().then(function (keys) {
        if (!keys) return []
        var params = buildParams(ps, round)
        var url = lastPath + '?' + encWbi(params, keys.img, keys.sub)
        log('补货请求 ps=' + ps, url.slice(0, 200))
        return fetch(url, { credentials: 'include' })
          .then(function (r) { return r.json() })
          .then(function (json) {
            if (!json || json.code !== 0) {
              log('补货失败 code=' + (json && json.code) + ' msg=' + (json && json.message))
              return []
            }
            var items = (json.data && json.data.item) || []
            log('补货返回 ' + items.length + ' 条')
            return items
          })
          .catch(function (e) { log('补货请求异常', e); return [] })
      })
    }

    // 空闲时先把下一批数据和封面准备好，点击时就能立刻改写，不用等网络
    function warmup() {
      if (!state.prefetch || warming || prefetched.length) return
      warming = true
      var target = getCount()
      requestBatch(Math.min(target + 8, 30), 1)
        .then(function (items) {
          prefetched = items || []
          prefetchedAt = Date.now()
          warming = false
          log('已预取 ' + prefetched.length + ' 条，后台预热封面')
          return preloadCovers(prefetched.slice(0, target), 4000)
        })
        .catch(function () { warming = false })
    }

    // ---- 主流程 ----
    function scheduleBoost(reason) {
      if (busy) {
        // 上一次还没结束：记下这次点击，结束后只补一次，不丢点击也不连点
        pendingBoost = true
        log('排队一次刷新（上一次还未完成）')
        return
      }
      boost(reason)
    }

    // 收尾：解除忙碌标记；期间用户又点了「换一换」的话，结束后补这一次
    function finish() {
      busy = false
      if (pendingBoost) {
        pendingBoost = false
        setTimeout(function () { boost('click') }, 120)
      }
    }

    function boost(reason) {
      if (busy) { log('正在处理中，忽略触发：' + reason); return }
      busy = true
      log('开始刷新，触发来源：' + reason)

      var target = getCount()
      var screen = screenBvids(60)
      var pool = []
      var seen = {}

      function push(items) {
        if (!items || !items.length) return 0
        var added = 0
        items.forEach(function (it) {
          if (!isValidItem(it)) return
          if (seen[it.bvid]) return
          if (screen[it.bvid]) return
          seen[it.bvid] = true
          pool.push(it)
          added++
        })
        return added
      }

      // 第一批：之前预取好的（最快，几乎零等待）
      if (prefetched.length) {
        log('用上预取的 ' + prefetched.length + ' 条')
        push(prefetched)
        prefetched = []
      }

      // 第二批：原生刚返回的那批（如果有）
      if (Date.now() - lastNativeAt < 5000) {
        log('取用原生返回的 ' + lastNativeItems.length + ' 条')
        push(lastNativeItems)
      }

      // 第二批：自己带签名请求
      var round = 0
      function fillByRequest() {
        if (pool.length >= target || round >= 4) return Promise.resolve()
        round++
        var need = Math.min(Math.max(target - pool.length + 5, 8), 30)
        return requestBatch(need, round).then(function (items) {
          var before = pool.length
          push(items)
          if (pool.length === before) return Promise.resolve()
          return fillByRequest()
        })
      }

      // 兜底：自有接口一条都没取到时，才放行一次原生换一换（平时不打扰原生，避免两套刷新打架造成闪烁）
      function fallbackNative() {
        if (pool.length || !btnEl) return Promise.resolve()
        log('自有接口没取到数据，放行一次原生换一换兜底')
        // 程序化点击 isTrusted=false，上面的点击接管逻辑会自动放行、且不会再次触发刷新
        try { btnEl.click() } catch (e) { /* 忽略 */ }
        return sleep(900).then(function () { push(lastNativeItems) })
      }

      fillByRequest()
        .then(fallbackNative)
        .then(function () {
          var use = pool.slice(0, target)
          var cards = getCards()
          dumpCardHtml(cards)
          log('准备改写：目标 ' + target + ' 张，可用数据 ' + pool.length + ' 条，页面卡片 ' + cards.length + ' 张（过滤前 ' + lastCardsRaw + '）')
          if (!use.length) {
            log('没有拿到任何新数据，本次不做改动')
            toast('换一换扩展：没拿到新数据（详见控制台日志）')
            finish()
            return
          }
          if (!cards.length) {
            log('没找到视频卡片容器')
            toast('换一换扩展：没找到卡片容器（详见控制台日志）')
            finish()
            return
          }

          function doneSwap(done) {
            armGuard(use)
            log('完成，实际改写 ' + done + ' 张')
            if (done < target) {
              toast('换一换：只刷了 ' + done + ' / ' + target + ' 张（接口给的新数据不够或卡片不足）')
            } else if (state.toast) {
              toast('换一换：已刷新 ' + done + ' 张卡片', 2000)
            }
            finish()
            setTimeout(warmup, 1200)
          }

          // 官方式整帧替换：封面先全部进缓存（预加载期间画面保持不动），改写只在一个
          // 同步帧内完成 —— 图片已在缓存里，换内容的那一帧不会出现“空白→加载”的闪白/闪黑。
          var t0 = Date.now()
          return preloadCovers(use, 1800).then(function () {
            log('封面预加载耗时 ' + (Date.now() - t0) + 'ms')
            var c2 = getCards()
            if (!c2.length) { finish(); return }
            if (state.fade) {
              // 只有用户手动打开「过渡动画」时才做一次约 0.1s 的短促压暗过渡
              fadeCards(c2, Math.min(use.length, c2.length), true)
              setTimeout(function () {
                try {
                  var done = applyItems(use, [0, 8, 12])
                  fadeCards(getCards(), Math.min(use.length, c2.length), false)
                  doneSwap(done)
                } catch (e) { log('改写异常', e); finish() }
              }, 110)
            } else {
              try {
                doneSwap(applyItems(use, [0, 8, 12]))
              } catch (e) { log('改写异常', e); finish() }
            }
          })
        })
        .catch(function (e) {
          log('流程异常', e)
          finish()
        })
    }

    // ---- 请求/响应拦截 ----
    function isRcmdUrl(url) {
      return typeof url === 'string' && url.indexOf('top/feed/rcmd') !== -1
    }

    function remember(url) {
      lastParams = parseQuery(url)
      lastPath = url.split('?')[0]
      if (lastPath.indexOf('http') !== 0) {
        lastPath = 'https://api.bilibili.com' + (lastPath.charAt(0) === '/' ? '' : '/') + lastPath
      }
      log('抓到推荐流接口参数：', Object.keys(lastParams).join(','))
    }

    function onRcmdResponse(json) {
      try {
        if (!json || json.code !== 0 || !json.data || !json.data.item) return
        lastNativeItems = json.data.item
        lastNativeAt = Date.now()
        log('抓到原生返回 ' + json.data.item.length + ' 条')
      } catch (e) { /* 忽略 */ }
    }

    function installHooks() {
      if (global.__beBoostHooked) return
      global.__beBoostHooked = true

      var origFetch = global.fetch
      if (origFetch) {
        global.fetch = function (input, init) {
          var url = typeof input === 'string' ? input : (input && input.url) || ''
          var hit = isRcmdUrl(url)
          if (hit) remember(url)
          var p = origFetch.apply(this, arguments)
          if (hit && p && typeof p.then === 'function') {
            try {
              p.then(function (res) {
                try {
                  if (res && res.clone) {
                    res.clone().json().then(function (j) { onRcmdResponse(j) }).catch(function () {})
                  }
                } catch (e) { /* 忽略 */ }
              }).catch(function () {})
            } catch (e) { /* 忽略 */ }
          }
          return p
        }
        log('fetch 已接管')
      }

      var XHR = global.XMLHttpRequest
      if (XHR) {
        var origOpen = XHR.prototype.open
        XHR.prototype.open = function (method, url) {
          try { this.__beUrl = String(url) } catch (e) { /* 忽略 */ }
          return origOpen.apply(this, arguments)
        }
        var origSend = XHR.prototype.send
        XHR.prototype.send = function () {
          var self = this
          try {
            if (this.__beUrl && isRcmdUrl(this.__beUrl)) {
              remember(this.__beUrl)
              this.addEventListener('loadend', function () {
                try {
                  var data = typeof self.response === 'string' ? JSON.parse(self.response) : self.response
                  onRcmdResponse(data)
                } catch (e) { /* 忽略 */ }
              })
            }
          } catch (e) { /* 忽略 */ }
          return origSend.apply(this, arguments)
        }
        log('XHR 已接管')
      }

      // 识别“真正的”换一换按钮，而不是 Evolved 设置面板里同名文字的行
      // （本组件「换一换 · 刷新更多卡片」、位置自定义组件「换一换按钮位置自定义」的
      //   设置条目都含“换一换”，若按文字兜底匹配会把它们的点击吞掉 → 设置页打不开）：
      //   1) 命中按钮专属类名（roll-btn / change-btn / feed-roll-btn…）一定算；
      //   2) 文字 / aria-label 命中时，必须真的落在首页推荐流容器
      //      .recommended-container_floor-aside 里才算（设置面板是 overlay，不在容器内）。
      function findRollButton(target) {
        var el = target
        var i
        for (i = 0; i < 8 && el; i++) {
          if (el.nodeType !== 1) { el = el.parentElement; continue }
          var cls = typeof el.className === 'string' ? el.className : ''
          if (cls.indexOf('feed-roll') !== -1 || /(^|\s)(roll-btn|change-btn)(\s|$)/.test(cls)) {
            return el
          }
          el = el.parentElement
        }
        var inFeed = false
        el = target
        for (i = 0; i < 8 && el; i++) {
          if (el.nodeType !== 1) { el = el.parentElement; continue }
          try {
            if (el.classList && el.classList.contains('recommended-container_floor-aside')) {
              inFeed = true
              break
            }
          } catch (err) { /* 忽略 */ }
          el = el.parentElement
        }
        if (!inFeed) return null
        el = target
        for (i = 0; i < 8 && el; i++) {
          if (el.nodeType !== 1) { el = el.parentElement; continue }
          var txt = (el.textContent || '').trim()
          var label = ''
          try { label = (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title')) || '') } catch (err) { label = '' }
          if ((txt && txt.length <= 12 && txt.indexOf('换一换') !== -1) || (label && label.indexOf('换一换') !== -1)) {
            return el
          }
          el = el.parentElement
        }
        return null
      }

      // ==================== 原生动画还原 ====================
      // 官方「换一换」的箭头转圈并不是 CSS 动画: 每次点击都把按钮内 svg 的内联
      // transform 增加 360°(Vue RollButton: rotate(count*360deg)), 再借
      // .roll-btn svg 的 transition: transform .5s ease 转上一圈。本组件的点击接管会
      // 把官方 Vue 回调整个拦掉, 这里照官方逻辑补上这一圈 —— 观感与原生完全一致,
      // 只动 svg 自身的内联样式, 不影响按钮外观与按压动画。
      function svgCurrentDeg(svg) {
        var s = ''
        try {
          s = svg.style && svg.style.transform ? svg.style.transform : ''
        } catch (err) {
          s = ''
        }
        if (!s || s === 'none') return 0
        // 官方与本组件写入的格式都是 rotate(Ndeg), 直接解析这个累加值即可。
        // 千万别用矩阵反解角度(atan2): 它只能给出 -180~180 的主值, 360/720…
        // 会被读成 0°, 导致下一次写入与当前相同的值, transition 不再触发,
        // 表现就是“只有第一下会转”。
        var mm = String(s).match(/rotate\(\s*(-?\d*\.?\d+)deg\s*\)/)
        if (mm) return parseFloat(mm[1]) || 0
        return 0
      }

      function playNativeSpin(btn) {
        try {
          var scope = btn
          for (var i = 0; i < 4 && scope; i++) {
            var svg = scope.querySelector && scope.querySelector('svg')
            if (svg) {
              svg.style.transform = 'rotate(' + (svgCurrentDeg(svg) + 360) + 'deg)'
              return
            }
            scope = scope.parentElement
          }
        } catch (err) { /* 忽略 */ }
      }

      // 「换一换按钮位置自定义」会把按钮或它的外层容器写成 translate / position:fixed,
      // 该组件的“点击后回顶”监听同样被拦截拦掉; 这里向上多找几层, 样式命中了再补回顶。
      function hasMoveStyle(node) {
        var el = node
        for (var i = 0; i < 5 && el; i++) {
          try {
            var st = el.getAttribute ? (el.getAttribute('style') || '') : ''
            if (/translate\(|position:\s*fixed/i.test(st)) return true
          } catch (err) { /* 忽略 */ }
          el = el.parentElement
        }
        return false
      }

      // 点击「换一换」按钮：由本组件整体接管这次刷新。阻止原生“整列替换”与组件改写同时进行
      // （两套动作打架 = “换完又被换回去 / 二次加载”的闪烁根源）。内部兜底的
      // 程序化点击（isTrusted=false）自动放行，只记录按钮位置、不再触发新一轮刷新。
      document.addEventListener('click', function (e) {
        var btn = findRollButton(e.target)
        if (!btn) return
        btnEl = btn
        log('检测到点击「换一换」', (btn.className || '') || (btn.textContent || '').trim())
        if (e.isTrusted !== false) {
          try {
            e.preventDefault()
            e.stopPropagation()
            if (e.stopImmediatePropagation) e.stopImmediatePropagation()
          } catch (err) { /* 忽略 */ }
          // 原生动画还原: 官方箭头自转的 Vue 回调被上面拦掉, 手动补一圈(只动 svg)
          playNativeSpin(btn)
          // 「换一换按钮位置自定义」把按钮/外层容器移过位或固定时, 其“点击后回顶”副作用
          // 也会被上面的 stopPropagation 一并拦掉, 这里向上多找几层补一次(命中了才补)。
          try {
            if (hasMoveStyle(btn)) {
              setTimeout(function () {
                try { global.scrollTo({ top: 0, behavior: 'smooth' }) } catch (err) { global.scrollTo(0, 0) }
              }, 0)
            }
          } catch (err) { /* 忽略 */ }
          setTimeout(function () { scheduleBoost('click') }, 60)
        }
      }, true)

      // 点击兜底：接管"链接已被 Vue 回写成旧视频"的那一次跳转（含中键/新标签页）
      document.addEventListener('click', onFeedClick, true)
      document.addEventListener('auxclick', onFeedClick, true)

      // 备份触发：卡片被整体换掉（原生刷新）时自动补
      var lastFirst = ''
      setInterval(function () {
        if (busy || Date.now() - lastBoostAt < 4000) return
        var cards = getCards()
        if (!cards.length) return
        var first = bvidOf(cards[0])
        if (!first) return
        // 刚改写完的守卫期内：DOM 若被别处动过，交给守卫静默修复，
        // 绝不再自动补一轮刷新 —— 这是“换完又闪一下/二次刷新”的另一来源
        if (Date.now() < guardUntil) {
          lastFirst = first
          return
        }
        var expected = guardItems.length ? guardItems[0].bvid : ''
        if (lastFirst && first !== lastFirst && first !== expected) {
          log('检测到首卡变化 → 自动补刷')
          lastFirst = first
          boost('dom')
          return
        }
        lastFirst = first
      }, 800)

      // 悬停核对: 捕获阶段先于 B 站自己的 mouseenter 处理执行, 只做诊断与兜底 ——
      // 不再在 hover 那一刻去动容器(实测会把预览弄成"彻底不出")。
      // 700ms 后看登记表里为这张卡建出来的实例, option.bvid 是不是我们想要的新视频;
      // 只有确实建出来了、且是别的视频时才补一次 leave/enter 重进(同卡同视频只补一次)。
      // 看不到登记表时 got 恒为 null, 直接跳过, 不瞎干预。
      try {
        if (!global.__beBoostHoverProbe) {
          global.__beBoostHoverProbe = true
          document.addEventListener(
            'mouseenter',
            function (e) {
              try {
                if (!e.isTrusted) return
                var t = e.target
                var wrap = t && t.closest ? t.closest('.bili-video-card__image--wrap') : null
                if (!wrap) return

                if (!guardItems.length || Date.now() > guardUntil) return
                var card = wrap.closest ? wrap.closest('.bili-video-card') : null
                if (!card) return
                var cds = getCards()
                var idx = cds.indexOf(card)
                if (idx < 0 || idx >= guardItems.length) return
                var want = guardItems[idx]
                var pl = wrap.__INLINE_PLAYER__
                var snap = pl && pl.option ? pl.option.bvid : '(无)'
                if (state.debug) {
                  log('[hover] 卡#' + idx + ' 期望=' + want.bvid + ' 快照=' + snap)
                }

                // ② 结果核对: 700ms 后看真正建出来的播放器用的是哪个 bvid
                setTimeout(function () {
                  try {
                    if (!wrap.isConnected || Date.now() > guardUntil) return
                    var stillIn = false
                    var boxes = wrap.querySelectorAll('.v-inline-player, .v-inline-live-player')
                    for (var b = 0; b < boxes.length; b++) {
                      if ((boxes[b].className || '').indexOf('mouse-in') !== -1) stillIn = true
                    }
                    if (!stillIn) return // 人已经移开了, 不用管
                    var reg = global.blInlinePlayers || []
                    var mine = null
                    for (var i = 0; i < reg.length; i++) {
                      var inst = reg[i] && reg[i][1]
                      if (inst && belongsTo(inst, wrap)) { mine = inst; break }
                    }
                    var got = mine && mine.option ? mine.option.bvid : null
                    if (state.debug) {
                      log('[hover结果] 卡#' + idx + ' 期望=' + want.bvid + ' 实际=' + got)
                    }
                    if (got === want.bvid) return // 已经是新视频, 收工
                    // 看不到登记表/扩展属性时 got 恒为 null，这时乱补 leave+enter 只会帮倒忙
                    if (!got) return
                    if (wrap.__beHealed === want.bvid) return
                    wrap.__beHealed = want.bvid
                    log('[hover修复] 卡#' + idx + ' 预览是 ' + got + ' 不是 ' + want.bvid + '，重新改写并重进')
                    try { patchCard(card, want) } catch (e1) { /* 忽略 */ }
                    try { purgeInlinePlayer(wrap) } catch (e1) { /* 忽略 */ }
                    try {
                      wrap.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false, cancelable: true }))
                    } catch (err3) { /* 忽略 */ }
                    setTimeout(function () {
                      try {
                        if (wrap.isConnected) {
                          wrap.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, cancelable: true }))
                        }
                      } catch (err3) { /* 忽略 */ }
                    }, 160)
                  } catch (err2) { /* 忽略 */ }
                }, 700)
              } catch (err) { /* 忽略 */ }
            },
            true,
          )
        }
      } catch (err) { /* 忽略 */ }
    }

    var entry = async ({ metadata, settings }) => {
      if (location.pathname !== '/') return
      log('组件启动', location.href)

      Object.keys(settings.options).forEach(function (optionName) {
        addComponentListener(
          metadata.name + '.' + optionName,
          function (value) {
            if (optionName === '刷新数量') state.count = Number(value) || 15
            else if (optionName === '手动输入数量') state.manual = String(value == null ? '' : value)
            else if (optionName === '显示提示') state.toast = !!value
            else if (optionName === '过渡动画') state.fade = !!value
            else if (optionName === '预取下一批') state.prefetch = !!value
            else if (optionName === '调试日志') state.debug = !!value
          },
          true,
        )
      })

      installHooks()
      startGuard()
      injectBridge()
      setTimeout(warmup, 2000)
      // 环境自检：确认能不能看到页面的 JS 全局 / DOM 扩展属性（隔离世界的话两者都看不到）
      if (state.debug) {
        setTimeout(function () {
          try {
            var uw = typeof unsafeWindow !== 'undefined' ? unsafeWindow : null
            var cards0 = getCards()
            var w0 = cards0[0] && cards0[0].querySelector('.bili-video-card__image--wrap')
            log(
              '[环境自检] 同世界=' + (uw ? String(uw === global) : '无unsafeWindow') +
                ' | blInlinePlayers 条数=' + ((global.blInlinePlayers || []).length) +
                ' | 桥对象=' + (global.__beBoostBridge ? '可见 v' + global.__beBoostBridge.v : '不可见(靠属性通知)') +
                ' | __INLINE_PLAYER__=' + (w0 && w0.__INLINE_PLAYER__ ? '可见' : '不可见') +
                ' | 预览容器数=' + (w0 ? w0.querySelectorAll('.v-inline-player').length : -1)
            )
          } catch (e) { /* 忽略 */ }
        }, 1200)
      }
    }

    return define.defineComponentMetadata({
      name: 'feed-refresh-boost',
      author: { name: 'WorkBuddy', link: 'https://www.bilibili.com' },
      tags: [componentsTags.style],
      displayName: '换一换 · 刷新更多卡片',
      entry: entry,
      options: options,
      description: {
        'zh-CN': () =>
          Promise.resolve(
            '自定义首页「换一换」按钮刷新视频卡片的数量（默认 15 张），' +
              '不刷新页面、不会白屏。支持滑块或手动输入数量，带调试日志。',
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
    exports['style/feed-refresh-boost'] = factory()
  } else {
    global['style/feed-refresh-boost'] = factory()
  }
})(typeof globalThis !== 'undefined' ? globalThis : window)
