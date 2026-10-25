/* 行知录 · 主应用：路由 / 渲染 / 上传 / 编辑 / AI 状态轮询 */
(function () {
  'use strict';

  var app = document.getElementById('app');
  var store = {
    site: null,
    places: null,   // 索引数组
    pollTimer: null
  };
  var CN_NUM = ['壹', '贰', '叁'];

  /* ---------- 小工具 ---------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function esc(s) { return MiniMD.esc(String(s == null ? '' : s)); }
  function fmtDate(d) {
    if (!d) return '';
    var m = String(d).match(/^(\d{4})-(\d{1,2})/);
    if (m) return m[1] + ' 年 ' + parseInt(m[2], 10) + ' 月';
    return String(d);
  }
  function jget(url) {
    return fetch(url + (url.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now())
      .then(function (r) {
        if (!r.ok) throw new Error('加载失败 ' + r.status);
        return r.json();
      });
  }
  function toast(msg, ms) {
    var root = document.getElementById('toast-root');
    var t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    root.appendChild(t);
    setTimeout(function () { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; }, (ms || 2600));
    setTimeout(function () { t.remove(); }, (ms || 2600) + 350);
  }
  function modal(html) {
    var root = document.getElementById('modal-root');
    root.innerHTML = '<div class="modal-mask"><div class="modal">' + html + '</div></div>';
    var mask = root.firstChild;
    mask.addEventListener('click', function (e) { if (e.target === mask) closeModal(); });
    return mask;
  }
  function closeModal() { document.getElementById('modal-root').innerHTML = ''; }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeModal(); closeLightbox(); }
  });

  /* ---------- 图片压缩 ---------- */
  var MAX_SIDE = 2560, QUALITY = 0.86;
  async function compressImage(file) {
    if (!/^image\//.test(file.type)) throw new Error('「' + file.name + '」不是图片文件');
    if (/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name)) {
      throw new Error('「' + file.name + '」是 HEIC 格式，浏览器无法处理。iPhone 请到 设置→相机→格式 选「兼容性最佳」后重拍，或先转换成 JPG。');
    }
    var bmp = await createImageBitmap(file);
    var w = bmp.width, h = bmp.height;
    var scale = Math.min(1, MAX_SIDE / Math.max(w, h));
    var cv = document.createElement('canvas');
    cv.width = Math.round(w * scale);
    cv.height = Math.round(h * scale);
    var ctx = cv.getContext('2d');
    ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
    bmp.close && bmp.close();
    var blob = await new Promise(function (res) { cv.toBlob(res, 'image/jpeg', QUALITY); });
    if (!blob) throw new Error('图片处理失败');
    return blob;
  }

  /* ---------- 数据 ---------- */
  function loadSite() {
    return jget('content/site.json').then(function (s) {
      store.site = s;
      document.title = s.title + ' · ' + (s.subtitle || '我的旅行相册');
      $('[data-role="site-title"]').textContent = s.title;
      if (s.quote) $('[data-role="site-quote"]').textContent = s.quote;
    }).catch(function () {});
  }
  function loadPlaces() {
    return jget('content/places.json').then(function (j) {
      store.places = j.places || [];
    }).catch(function () { store.places = []; });
  }
  function getPlace(slug) { return jget('content/places/' + slug + '.json'); }

  function coverOf(p) {
    if (p.photos && p.photos.length) return p.photos[0].file;
    return p.placeholder || 'placeholder/default.svg';
  }
  function sortedPlaces() {
    return (store.places || []).slice().sort(function (a, b) {
      return String(b.date || '').localeCompare(String(a.date || ''));
    });
  }

  /* ---------- 路由 ---------- */
  function route() {
    if (store.pollTimer) { clearInterval(store.pollTimer); store.pollTimer = null; }
    closeLightbox();
    document.getElementById('modal-root').innerHTML = '';
    var h = location.hash || '#/';
    var nav = function (k) {
      document.querySelectorAll('.site-nav a').forEach(function (a) {
        a.classList.toggle('active', a.getAttribute('data-nav') === k);
      });
    };
    var m = h.match(/^#\/place\/([\w\u4e00-\u9fa5-]+)/);
    if (m) { nav(''); viewPlace(decodeURIComponent(m[1])); return; }
    if (h.indexOf('#/admin') === 0) { nav('admin'); viewAdmin(); return; }
    nav('home'); viewHome();
  }
  window.addEventListener('hashchange', route);

  /* ---------- 首页 ---------- */
  function viewHome() {
    app.innerHTML = '<div class="loading">正在展开地图 …</div>';
    var places = sortedPlaces();
    var site = store.site || {};
    var nPhotos = 0;
    places.forEach(function (p) { nPhotos += (p.photoCount || 0); });
    var cards = places.map(function (p) {
      return (
        '<a class="card" href="#/place/' + p.slug + '">' +
          '<div class="card-cover"><img src="' + esc(p.cover || 'placeholder/default.svg') + '" alt="' + esc(p.name) + '" loading="lazy">' +
          (p.status === 'pending' ? '<span class="cover-tag">✍️ AI 生成中</span>' : '') +
          '</div>' +
          '<div class="card-body">' +
            '<div class="card-title">' + esc(p.name) + (p.date ? '<span class="date">' + esc(fmtDate(p.date)) + '</span>' : '') + '</div>' +
            '<p class="card-summary">' + esc(p.summary || '一段还没写下的旅程。') + '</p>' +
            '<div class="card-tags">' +
              (p.region ? '<span class="tag">' + esc(p.region) + '</span>' : '') +
              (p.landform ? '<span class="tag warm">' + esc(p.landform) + '</span>' : '') +
            '</div>' +
          '</div>' +
        '</a>'
      );
    }).join('');

    app.innerHTML =
      '<section class="hero">' +
        '<h1>' + esc(site.title || '行知录') + '</h1>' +
        '<p>' + esc(site.subtitle || '') + '</p>' +
        '<div class="hero-stats">' +
          '<div class="stat"><b>' + places.length + '</b><span>去过的地方</span></div>' +
          '<div class="stat"><b>' + nPhotos + '</b><span>收藏的照片</span></div>' +
          '<div class="stat"><b>∞</b><span>想看的世界</span></div>' +
        '</div>' +
      '</section>' +
      '<div class="home-body">' +
        '<h2>走过的地方 <small>按时间倒序 · 点击进入</small></h2>' +
        (places.length
          ? '<div class="grid">' + cards + '</div>'
          : '<div class="feelings-empty"><span class="pencil">🗺️</span>还没有地方。去「管理」页添加你的第一段旅程吧。</div>') +
      '</div>';
    window.scrollTo(0, 0);
  }

  /* ---------- 地方页 ---------- */
  function statusBadge(p) {
    if (p.status === 'pending') return '<span class="badge pending">✍️ AI 正在写介绍</span>';
    if (p.status === 'failed') return '<span class="badge failed">生成失败 · 可到 Actions 重跑</span>';
    return '';
  }

  async function viewPlace(slug) {
    app.innerHTML = '<div class="loading">正在翻到这一页 …</div>';
    var p;
    try { p = await getPlace(slug); }
    catch (e) {
      app.innerHTML = '<div class="notfound"><h2>没有找到这个地方</h2><p class="muted">它可能还没创建，或者名字变了。<a href="#/">回到首页</a></p></div>';
      return;
    }
    renderPlace(p);
    if (p.status === 'pending') {
      store.pollTimer = setInterval(async function () {
        try {
          var np = await getPlace(slug);
          if (np.status !== 'pending') {
            clearInterval(store.pollTimer); store.pollTimer = null;
            renderPlace(np);
            toast('AI 写好了「' + np.name + '」的风景介绍 ✨');
          }
        } catch (_) {}
      }, 15000);
    }
    window.scrollTo(0, 0);
  }

  function renderPlace(p) {
    var cover = coverOf(p);
    var photos = p.photos || [];
    var geo = p.geo || {};

    var hero =
      '<div class="place-hero">' +
        '<img src="' + esc(cover) + '" alt="' + esc(p.name) + '">' +
        '<div class="veil"></div>' +
        '<div class="caption">' +
          '<h1>' + esc(p.name) + (p.date ? '<span class="badge ai">' + esc(fmtDate(p.date)) + '</span>' : '') + statusBadge(p) + '</h1>' +
          '<div class="sub">' + [p.region, geo.position].filter(Boolean).map(esc).join(' · ') + '</div>' +
        '</div>' +
      '</div>';

    /* 相册 */
    var album;
    if (photos.length) {
      album = '<div class="masonry">' + photos.map(function (ph, i) {
        return '<figure data-idx="' + i + '"><img src="' + esc(ph.file) + '" alt="' + esc(p.name) + ' ' + (i + 1) + '" loading="lazy"></figure>';
      }).join('') + '</div>';
    } else {
      album =
        '<figure style="margin:0;border-radius:12px;overflow:hidden;box-shadow:var(--shadow)"><img src="' + esc(cover) + '" alt="' + esc(p.name) + '"></figure>' +
        '<div class="placeholder-note">🌄 这里暂时是占位图。点击右上角「添加照片」，把这个地方换成你亲眼见过的样子。</div>';
    }

    /* 风景介绍 */
    var intro;
    if (p.status === 'pending') {
      intro = '<div class="pending-note"><span class="spin"></span>AI 正在为这里写风景介绍，写好后约 1 分钟内自动出现（本页会自动刷新，也可以稍后手动刷新）。</div>';
    } else if (p.intro) {
      intro =
        '<div class="geo-profile">' +
          (geo.landform ? '<div class="g"><b>地貌</b><span>' + esc(geo.landform) + '</span></div>' : '') +
          (geo.elevation ? '<div class="g"><b>海拔</b><span>' + esc(geo.elevation) + '</span></div>' : '') +
          (geo.position ? '<div class="g"><b>坐标</b><span>' + esc(geo.position) + '</span></div>' : '') +
          (geo.bestSeason ? '<div class="g"><b>最佳季节</b><span>' + esc(geo.bestSeason) + '</span></div>' : '') +
        '</div>' +
        '<div class="prose">' + MiniMD.render(p.intro) + '</div>' +
        (p.introSource === 'template'
          ? '<div class="callout warn">这段介绍是占位模板（AI 密钥未配置）。到仓库 Settings → Secrets 添加 AI_API_KEY 后，在 Actions 里手动运行一次「生成风景介绍」即可自动补写。</div>'
          : '');
    } else {
      intro = '<div class="pending-note">介绍尚未生成。可到仓库 Actions 手动运行「生成风景介绍」。</div>';
    }

    /* 自我感受 */
    var feelings = p.feelings
      ? '<div class="prose">' + MiniMD.render(p.feelings) + '</div>'
      : '<div class="feelings-empty"><span class="pencil">✍️</span>这一栏留给你。<div class="hint">站在这里时你在想什么？写下来，多年以后它会比照片更珍贵。</div></div>';

    app.innerHTML =
      '<div class="backline"><a href="#/">← 回到首页</a></div>' +
      hero +
      '<div class="place-actions">' +
        '<button class="btn ghost small" id="btn-add-photos">📷 添加照片</button>' +
        '<button class="btn small" id="btn-edit-feelings">✍️ 写下我的感受</button>' +
      '</div>' +
      '<div class="place-body">' +
        '<section class="sec"><div class="sec-head"><span class="sec-num">' + CN_NUM[0] + '</span><h2 class="sec-title">相册</h2></div>' + album + '</section>' +
        '<section class="sec"><div class="sec-head"><span class="sec-num">' + CN_NUM[1] + '</span><h2 class="sec-title">风景介绍<small>这里为什么长这样</small></h2></div>' + intro + '</section>' +
        '<section class="sec"><div class="sec-head"><span class="sec-num">' + CN_NUM[2] + '</span><h2 class="sec-title">自我感受<small>只属于你</small></h2></div>' +
          '<div class="feelings-box">' + feelings + '</div>' +
        '</section>' +
      '</div>';

    /* 事件绑定 */
    document.querySelectorAll('.masonry figure').forEach(function (fig) {
      fig.addEventListener('click', function () {
        openLightbox(photos.map(function (ph) { return ph.file; }), parseInt(fig.getAttribute('data-idx'), 10), p.name);
      });
    });
    $('#btn-edit-feelings').addEventListener('click', function () { editFeelings(p); });
    $('#btn-add-photos').addEventListener('click', function () { addPhotosFlow(p); });
  }

  /* ---------- 灯箱 ---------- */
  var lbState = null;
  function openLightbox(files, idx, name) {
    lbState = { files: files, idx: idx };
    var lb = document.getElementById('lightbox');
    lb.hidden = false;
    document.body.style.overflow = 'hidden';
    lb.innerHTML =
      '<span class="lb-count"></span>' +
      '<button class="lb-close" title="关闭">✕</button>' +
      '<button class="lb-btn lb-prev" title="上一张">‹</button>' +
      '<img alt="">' +
      '<button class="lb-btn lb-next" title="下一张">›</button>' +
      '<div class="lb-cap"></div>';
    var render = function () {
      lb.querySelector('img').src = lbState.files[lbState.idx];
      lb.querySelector('.lb-count').textContent = (lbState.idx + 1) + ' / ' + lbState.files.length;
      lb.querySelector('.lb-cap').textContent = name || '';
      lb.querySelector('.lb-prev').style.visibility = lbState.files.length > 1 ? 'visible' : 'hidden';
      lb.querySelector('.lb-next').style.visibility = lbState.files.length > 1 ? 'visible' : 'hidden';
    };
    lb.querySelector('.lb-close').addEventListener('click', closeLightbox);
    lb.querySelector('.lb-prev').addEventListener('click', function (e) { e.stopPropagation(); lbState.idx = (lbState.idx - 1 + lbState.files.length) % lbState.files.length; render(); });
    lb.querySelector('.lb-next').addEventListener('click', function (e) { e.stopPropagation(); lbState.idx = (lbState.idx + 1) % lbState.files.length; render(); });
    lb.addEventListener('click', function (e) { if (e.target === lb) closeLightbox(); });
    lb._render = render;
    render();
  }
  function closeLightbox() {
    var lb = document.getElementById('lightbox');
    if (lb.hidden) return;
    lb.hidden = true;
    lb.innerHTML = '';
    document.body.style.overflow = '';
  }
  document.addEventListener('keydown', function (e) {
    if (!lbState || document.getElementById('lightbox').hidden) return;
    if (e.key === 'ArrowLeft') { lbState.idx = (lbState.idx - 1 + lbState.files.length) % lbState.files.length; document.getElementById('lightbox')._render(); }
    if (e.key === 'ArrowRight') { lbState.idx = (lbState.idx + 1) % lbState.files.length; document.getElementById('lightbox')._render(); }
  });

  /* ---------- 编辑感受 ---------- */
  function needSetup() {
    if (Gh.ready()) return false;
    modal(
      '<h3>还差一步：连接 GitHub</h3>' +
      '<p class="muted" style="font-size:14.5px">编辑与上传需要把网站连到你的 GitHub 仓库。需要填一次「GitHub 令牌（PAT）」，之后一切都在这台设备上完成。</p>' +
      '<div class="modal-actions"><a class="btn" href="#/admin" onclick="document.getElementById(\'modal-root\').innerHTML=\'\'">去设置</a></div>'
    );
    return true;
  }

  function editFeelings(p) {
    if (needSetup()) return;
    modal(
      '<h3>写下「' + esc(p.name) + '」的感受</h3>' +
      '<p class="muted small" style="margin-top:-6px">支持简单的 Markdown：**加粗**、# 小标题、- 列表、> 引用。写完点保存，大约几秒后生效。</p>' +
      '<div class="field"><textarea id="feelings-text"></textarea></div>' +
      '<div class="modal-actions">' +
        '<button class="btn ghost" id="fg-cancel">取消</button>' +
        '<button class="btn" id="fg-save">保存</button>' +
      '</div>'
    );
    var ta = $('#feelings-text');
    ta.value = p.feelings || '';
    ta.focus();
    $('#fg-cancel').addEventListener('click', closeModal);
    $('#fg-save').addEventListener('click', async function () {
      var btn = this;
      btn.disabled = true; btn.textContent = '保存中…';
      try {
        var fresh = await getPlace(p.slug);   // 取最新版本，避免覆盖 AI 更新
        fresh.feelings = ta.value.trim();
        await Gh.putJSON('content/places/' + p.slug + '.json', fresh, '写下「' + p.name + '」的感受');
        closeModal();
        toast('已保存 ✅（如未立刻更新，等 1 分钟后强制刷新）');
        renderPlace(fresh);
      } catch (e) {
        btn.disabled = false; btn.textContent = '保存';
        toast('保存失败：' + e.message, 4200);
      }
    });
  }

  /* ---------- 添加照片（已有地方） ---------- */
  function addPhotosFlow(p) {
    if (needSetup()) return;
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp';
    input.multiple = true;
    input.addEventListener('change', function () {
      if (input.files.length) uploadPhotos(p.slug, Array.prototype.slice.call(input.files), null);
    });
    input.click();
  }

  /* 上传照片核心流程：
     - 压缩为 JPG 后逐张经 GitHub API 入库
     - 更新 place.json 的 photos 数组
     - onDone 回调刷新页面 */
  async function uploadPhotos(slug, files, ui) {
    var log = ui && ui.log ? ui.log : function () {};
    var blobs = [];
    for (var i = 0; i < files.length; i++) {
      log(i, 'doing', '压缩中');
      try {
        var b = await compressImage(files[i]);
        blobs.push(b);
        log(i, 'doing', '已压缩');
      } catch (e) {
        log(i, 'err', '无法处理');
        toast(e.message, 5000);
        blobs.push(null);
      }
    }
    var existing = await Gh.listDir('photos/' + slug);
    var next = 1;
    existing.forEach(function (n) {
      var m = n.match(/^(\d+)\.jpg$/);
      if (m) next = Math.max(next, parseInt(m[1], 10) + 1);
    });
    var added = [];
    for (var j = 0; j < blobs.length; j++) {
      if (!blobs[j]) continue;
      var name = (next < 10 ? '0' : '') + next + '.jpg';
      var path = 'photos/' + slug + '/' + name;
      log(j, 'doing', '上传中');
      try {
        await Gh.put(path, await fileB64(blobs[j], path), '上传照片 ' + path);
        added.push(path);
        log(j, 'ok', '完成');
        next++;
      } catch (e) {
        log(j, 'err', '失败');
        toast('上传失败：' + e.message, 5000);
      }
    }
    if (!added.length) throw new Error('没有照片上传成功');
    var place = await getPlace(slug);
    place.photos = (place.photos || []).concat(added.map(function (f) { return { file: f }; }));
    await Gh.putJSON('content/places/' + slug + '.json', place, '「' + place.name + '」新增 ' + added.length + ' 张照片');
    // 同步首页索引的封面与计数
    try {
      var idx = await Gh.getJSON('content/places.json');
      idx.data.places.forEach(function (it) {
        if (it.slug === slug) { it.cover = place.photos[0].file; it.photoCount = place.photos.length; }
      });
      await Gh.putJSON('content/places.json', idx.data, '更新「' + place.name + '」封面');
    } catch (_) {}
    return { place: place, added: added.length };
  }
  async function fileB64(blob, path) {
    // 重新包装为 File 便于统一处理
    return Gh.b64FromFile(new File([blob], path, { type: 'image/jpeg' }));
  }

  /* ---------- 管理页 ---------- */
  function slugify(name) {
    var s = String(name || '').trim().toLowerCase().replace(/\s+/g, '-');
    if (/^[a-z0-9][a-z0-9-]*$/.test(s)) return s;
    return 'p-' + Date.now().toString(36);
  }

  function viewAdmin() {
    var cfg = Gh.cfg();
    var det = Gh.detect();
    var places = sortedPlaces();
    var statusRows = places.map(function (p) {
      var b = p.status === 'ready' ? '<span class="badge ready">已完成</span>'
        : p.status === 'pending' ? '<span class="badge pending">生成中</span>'
        : '<span class="badge failed">失败</span>';
      var src = p.introSource === 'ai' ? 'AI' : p.introSource === 'human' ? '手写' : p.introSource === 'template' ? '模板' : '—';
      return '<tr><td><a href="#/place/' + p.slug + '">' + esc(p.name) + '</a></td><td>' + esc(p.date || '—') + '</td><td>' + b + '</td><td class="muted">' + src + '</td></tr>';
    }).join('');

    app.innerHTML =
      '<div class="admin-body">' +
        '<h2>管理</h2>' +
        '<p class="admin-sub">上传照片、添加新地方、查看 AI 生成状态。</p>' +

        '<div class="panel" id="panel-conn">' +
          '<h3><span class="dot"></span>连接 GitHub</h3>' +
          (det ? '<div class="callout ok">检测到本站部署在 GitHub Pages，仓库已自动推断，只需填令牌。</div>' : '') +
          '<div class="form-row">' +
            '<div class="field"><label>仓库所有者（GitHub 用户名）</label><input id="gh-owner" placeholder="如 ty477" value="' + esc(cfg.owner || (det ? det.owner : '')) + '"></div>' +
            '<div class="field"><label>仓库名</label><input id="gh-repo" placeholder="如 xingzhilu" value="' + esc(cfg.repo || (det ? det.repo : '')) + '"></div>' +
          '</div>' +
          '<div class="field"><label>GitHub 令牌（Fine-grained PAT）</label>' +
            '<input id="gh-token" type="password" placeholder="github_pat_ 开头" value="' + esc(cfg.token) + '">' +
            '<span class="tip">只保存在你这台设备的浏览器里。权限只需「这一个仓库的 Contents 读写」，申请步骤见下方指南。</span>' +
          '</div>' +
          '<div style="display:flex;gap:10px;align-items:center">' +
            '<button class="btn" id="btn-gh-save">保存并测试连接</button>' +
            '<span id="gh-status" class="small muted"></span>' +
          '</div>' +
        '</div>' +

        '<div class="panel">' +
          '<h3><span class="dot"></span>添加一个新地方</h3>' +
          '<div class="form-row">' +
            '<div class="field"><label>地名 *</label><input id="np-name" placeholder="如 泸沽湖 / 冰岛"></div>' +
            '<div class="field"><label>时间</label><input id="np-date" placeholder="2026-08"></div>' +
          '</div>' +
          '<div class="form-row">' +
            '<div class="field"><label>所在区域</label><input id="np-region" placeholder="如 云南省丽江市"></div>' +
            '<div class="field"><label>地貌类型（可选）</label><input id="np-landform" placeholder="如 高原断陷湖"></div>' +
          '</div>' +
          '<div class="field"><label>给 AI 的备注（可选）</label><input id="np-notes" placeholder="一行话，比如：当时十月，环湖骑了两天，看到海鸥">' +
            '<span class="tip">写一句当时的情形，AI 的介绍会更贴合你的经历。</span></div>' +
          '<div class="dropzone" id="dz"><span class="dz-icon">📷</span>点击选择照片，或把照片拖到这里' +
            '<div class="dz-hint">可多选 · 自动压缩到最长边 2560px · iPhone 请用 JPG 格式</div></div>' +
          '<div class="thumb-list" id="thumbs"></div>' +
          '<ul class="upload-list" id="ul-list" hidden></ul>' +
          '<div style="margin-top:16px;display:flex;gap:10px;align-items:center">' +
            '<button class="btn teal" id="btn-np-submit">🚀 上传并生成</button>' +
            '<span id="np-status" class="small muted"></span>' +
          '</div>' +
        '</div>' +

        '<div class="panel">' +
          '<h3><span class="dot"></span>生成状态</h3>' +
          (places.length
            ? '<table class="status-table"><tr><th>地方</th><th>时间</th><th>介绍</th><th>来源</th></tr>' + statusRows + '</table>'
            : '<p class="muted small">还没有地方。</p>') +
        '</div>' +

        '<div class="panel guide">' +
          '<h3><span class="dot"></span>首次使用指南</h3>' +
          '<details><summary>① 申请 GitHub 令牌（PAT），只需一次</summary><div class="gd-body">' +
            '<ol>' +
              '<li>登录 GitHub 后打开 <code>github.com/settings/personal-access-tokens/new</code>（设置 → 开发者设置 → 细粒度令牌）。</li>' +
              '<li>Token name 随意（如 <code>album</code>）；Expiration 选较长的有效期。</li>' +
              '<li>Repository access 选 <code>Only select repositories</code>，选中你的相册仓库。</li>' +
              '<li>Permissions → Repository permissions → <code>Contents</code> → 选 <code>Read and write</code>。其它权限都不用给。</li>' +
              '<li>点 Generate token，复制生成的一长串（只显示一次），粘贴到本页最上方。</li>' +
            '</ol></div></details>' +
          '<details><summary>② 配置 AI（自动写风景介绍）</summary><div class="gd-body">' +
            '<ol>' +
              '<li>注册并登录智谱开放平台 <code>open.bigmodel.cn</code>，在「API keys」里创建一个 key（新用户有免费额度）。</li>' +
              '<li>打开你的 GitHub 相册仓库 → <code>Settings</code> → <code>Secrets and variables</code> → <code>Actions</code> → <code>New repository secret</code>。</li>' +
              '<li>Name 填 <code>AI_API_KEY</code>，Value 粘贴你的 key，保存。</li>' +
              '<li>完成。以后每次「添加新地方」，AI 会自动写介绍。想换模型，可在 Variables 里加 <code>AI_MODEL</code>（如 <code>glm-4.6</code>）、<code>AI_BASE_URL</code>。</li>' +
            '</ol></div></details>' +
          '<details><summary>③ 日常怎么用</summary><div class="gd-body">' +
            '<ul style="padding-left:1.4em">' +
              '<li><b>写感受</b>：进入地方页 →「✍️ 写下我的感受」→ 保存即生效。</li>' +
              '<li><b>补照片</b>：进入地方页 →「📷 添加照片」。</li>' +
              '<li><b>新地方</b>：本页「添加一个新地方」，上传后 AI 约 1 分钟写好介绍。</li>' +
              '<li>页面若没更新：GitHub Pages 有约 10 分钟缓存，强制刷新（Ctrl+F5）或稍等。</li>' +
            '</ul></div></details>' +
          '<details><summary>④ 常见问题</summary><div class="gd-body">' +
            '<ul style="padding-left:1.4em">' +
              '<li><b>iPhone 照片传不上</b>：HEIC 格式浏览器不认识。设置 → 相机 → 格式 → 选「兼容性最佳」，或用「照片→分享→选项→最兼容」导出。</li>' +
              '<li><b>AI 一直「生成中」</b>：到仓库 Actions 标签看「生成风景介绍」运行日志；401 说明 key 不对。</li>' +
              '<li><b>想重写某地介绍</b>：把该地 JSON 里 status 改回 pending 再手动运行工作流（或直接找 AI 帮你改）。</li>' +
            '</ul></div></details>' +
        '</div>' +
      '</div>';

    /* --- 连接设置 --- */
    $('#btn-gh-save').addEventListener('click', async function () {
      var btn = this, st = $('#gh-status');
      Gh.setCfg({
        owner: $('#gh-owner').value.trim(),
        repo: $('#gh-repo').value.trim(),
        token: $('#gh-token').value.trim()
      });
      btn.disabled = true; st.textContent = '测试中…'; st.style.color = '';
      try {
        var full = await Gh.test();
        st.textContent = '✅ 已连接 ' + full; st.style.color = 'var(--teal)';
      } catch (e) {
        st.textContent = '❌ ' + e.message; st.style.color = 'var(--red)';
      }
      btn.disabled = false;
    });

    /* --- 拖拽/选择照片 --- */
    var picked = [];
    var dz = $('#dz');
    var thumbList = $('#thumbs');
    function renderThumbs() {
      thumbList.innerHTML = picked.map(function (f) {
        return '<img class="thumb" src="' + URL.createObjectURL(f) + '">';
      }).join('');
    }
    function addFiles(list) {
      Array.prototype.forEach.call(list, function (f) { if (/^image\//.test(f.type)) picked.push(f); });
      renderThumbs();
    }
    dz.addEventListener('click', function () {
      var inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/jpeg,image/png,image/webp'; inp.multiple = true;
      inp.addEventListener('change', function () { addFiles(inp.files); });
      inp.click();
    });
    ['dragover', 'dragenter'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('drag'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('drag'); });
    });
    dz.addEventListener('drop', function (e) { addFiles(e.dataTransfer.files); });

    /* --- 提交新地方 --- */
    $('#btn-np-submit').addEventListener('click', async function () {
      var btn = this;
      var name = $('#np-name').value.trim();
      var stEl = $('#np-status');
      if (!name) { toast('先填一个地名'); return; }
      if (!Gh.ready()) { toast('请先在上方面板完成 GitHub 连接'); return; }
      btn.disabled = true;
      var slug = slugify(name);
      stEl.textContent = '';

      var files = picked.slice();
      var ul = $('#ul-list');
      ul.hidden = false;
      var log = files.length ? function (i, st, txt) {
        var li = ul.children[i];
        if (!li) {
          li = document.createElement('li');
          li.innerHTML = '<span>📷 ' + esc(files[i].name) + '</span><span class="st doing">等待</span>';
          ul.appendChild(li);
        }
        var s = li.querySelector('.st');
        s.className = 'st ' + st;
        s.textContent = txt;
      } : function () {};

      try {
        var photoCount = 0;
        if (files.length) {
          var res = await uploadPhotosToNew(slug, files, log);
          photoCount = res.count;
        } else {
          // 没有照片也要先建目录占位?不需要，直接建数据文件
        }
        var date = $('#np-date').value.trim();
        var placeData = {
          slug: slug,
          name: name,
          date: date,
          region: $('#np-region').value.trim(),
          landform: $('#np-landform').value.trim(),
          notes: $('#np-notes').value.trim(),
          coords: null,
          status: 'pending',
          introSource: null,
          photos: [],
          placeholder: null,
          geo: {},
          intro: '',
          summary: '',
          feelings: ''
        };
        // 读取刚上传的照片清单
        if (files.length) {
          var names = await Gh.listDir('photos/' + slug);
          names.sort();
          placeData.photos = names.map(function (n) { return { file: 'photos/' + slug + '/' + n }; });
        }
        await Gh.putJSON('content/places/' + slug + '.json', placeData, '新增「' + name + '」');

        var idx = await Gh.getJSON('content/places.json');
        idx.data.places.unshift({
          slug: slug, name: name, date: date,
          region: placeData.region, landform: placeData.landform,
          cover: placeData.photos.length ? placeData.photos[0].file : null,
          photoCount: placeData.photos.length,
          summary: 'AI 正在写介绍…', status: 'pending'
        });
        await Gh.putJSON('content/places.json', idx.data, '更新索引：' + name);

        stEl.innerHTML = '✅ 完成！<a href="#/place/' + slug + '">查看「' + esc(name) + '」</a>';
        toast('上传成功，AI 开始写介绍 ✍️');
        $('#np-name').value = ''; $('#np-notes').value = '';
        picked = []; renderThumbs();
        loadPlaces();
      } catch (e) {
        stEl.textContent = '';
        toast('出错了：' + e.message, 5000);
      }
      btn.disabled = false;
    });
  }

  /* 新地方的入库流程（不复用 uploadPhotos，因为 place.json 尚不存在） */
  async function uploadPhotosToNew(slug, files, log) {
    var blobs = [];
    for (var i = 0; i < files.length; i++) {
      log(i, 'doing', '压缩中');
      try { blobs.push(await compressImage(files[i])); }
      catch (e) { blobs.push(null); toast(e.message, 5000); }
    }
    var count = 0;
    for (var j = 0; j < blobs.length; j++) {
      if (!blobs[j]) { log(j, 'err', '跳过'); continue; }
      var name = (j + 1 < 10 ? '0' : '') + (j + 1) + '.jpg';
      var path = 'photos/' + slug + '/' + name;
      log(j, 'doing', '上传中');
      try {
        await Gh.put(path, await fileB64(blobs[j], path), '上传照片 ' + path);
        count++;
        log(j, 'ok', '完成');
      } catch (e) {
        log(j, 'err', '失败');
        toast('上传失败：' + e.message, 5000);
      }
    }
    return { count: count };
  }

  /* ---------- 启动 ---------- */
  loadSite().then(loadPlaces).then(route).catch(route);
})();
