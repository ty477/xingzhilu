/* GitHub Contents API 客户端 —— 照片上传 / 数据文件读写
   令牌仅存于浏览器 localStorage，直连 api.github.com（支持 CORS） */
(function () {
  'use strict';

  var LS = { token: 'xz.token', owner: 'xz.owner', repo: 'xz.repo' };

  function b64FromBytes(bytes) {
    var bin = '';
    var CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return btoa(bin);
  }
  function b64FromText(text) {
    return b64FromBytes(new TextEncoder().encode(text));
  }
  async function b64FromFile(file) {
    var buf = await file.arrayBuffer();
    return b64FromBytes(new Uint8Array(buf));
  }
  function textFromB64(b64) {
    var bin = atob(String(b64).replace(/\s/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  }
  function encPath(path) {
    return encodeURI(path); // 保留 / ，支持中文文件名
  }

  var Gh = {
    b64FromFile: b64FromFile,

    cfg: function () {
      return {
        token: localStorage.getItem(LS.token) || '',
        owner: localStorage.getItem(LS.owner) || '',
        repo: localStorage.getItem(LS.repo) || ''
      };
    },
    setCfg: function (c) {
      if (c.token) localStorage.setItem(LS.token, c.token); else localStorage.removeItem(LS.token);
      if (c.owner !== undefined) localStorage.setItem(LS.owner, c.owner);
      if (c.repo !== undefined) localStorage.setItem(LS.repo, c.repo);
    },
    ready: function () {
      var c = this.cfg();
      return !!(c.token && c.owner && c.repo);
    },
    // 从 github.io 域名自动推断仓库（也可在管理页手动填写）
    detect: function () {
      var host = location.hostname;
      if (!/\.github\.io$/.test(host)) return null;
      var owner = host.split('.')[0];
      var seg = location.pathname.split('/').filter(Boolean)[0];
      // 有路径段 = 项目页（user.github.io/repo）；根路径 = 用户主页仓库
      if (seg) return { owner: owner, repo: seg };
      return { owner: owner, repo: owner + '.github.io' };
    },

    api: async function (path, opt) {
      opt = opt || {};
      var c = this.cfg();
      if (!c.token || !c.owner) throw new Error('请先在「管理」页填写 GitHub 令牌');
      var headers = {
        'Authorization': 'Bearer ' + c.token,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      };
      if (opt.body) headers['Content-Type'] = 'application/json';
      var r = await fetch('https://api.github.com' + path, {
        method: opt.method || 'GET',
        headers: headers,
        body: opt.body ? JSON.stringify(opt.body) : undefined
      });
      if (r.status === 404) { var e = new Error('not found'); e.status = 404; throw e; }
      if (r.status === 401) throw new Error('令牌无效或已过期（401），请到管理页重新填写');
      if (r.status === 403) throw new Error('没有权限（403）：请检查令牌对该仓库的 Contents 读写权限');
      if (r.status === 409) throw new Error('文件冲突（409），请稍等几秒重试');
      if (!r.ok) {
        var msg = 'GitHub 请求失败（' + r.status + '）';
        try { var j = await r.json(); if (j && j.message) msg = j.message; } catch (_) {}
        throw new Error(msg);
      }
      if (r.status === 204) return null;
      return r.json();
    },

    repoPath: function (path) {
      var c = this.cfg();
      var q = path.indexOf('?');
      var p = q >= 0 ? path.slice(0, q) : path;
      var rest = q >= 0 ? path.slice(q) : '';
      return '/repos/' + c.owner + '/' + c.repo + '/contents/' + encPath(p) + rest;
    },

    // 读取文件（返回 {sha, text}）；不存在返回 null
    getRaw: async function (path) {
      try {
        var j = await this.api(this.repoPath(path));
        return { sha: j.sha, text: textFromB64(j.content) };
      } catch (e) {
        if (e.status === 404) return null;
        throw e;
      }
    },
    // 读取 JSON 文件
    getJSON: async function (path) {
      var raw = await this.getRaw(path);
      return raw ? { sha: raw.sha, data: JSON.parse(raw.text) } : null;
    },
    // 列目录（返回文件名数组；目录为空或不存在返回 []）
    listDir: async function (path) {
      try {
        var j = await this.api(this.repoPath(path));
        return Array.isArray(j) ? j.map(function (x) { return x.name; }) : [];
      } catch (e) {
        return [];
      }
    },
    // 上传/更新文件
    put: async function (path, contentB64, message, sha) {
      var body = { message: message, content: contentB64 };
      if (sha) body.sha = sha;
      return this.api(this.repoPath(path), { method: 'PUT', body: body });
    },
    putText: async function (path, text, message) {
      var old = await this.getRaw(path);
      return this.put(path, b64FromText(text), message, old ? old.sha : undefined);
    },
    putJSON: async function (path, obj, message) {
      return this.putText(path, JSON.stringify(obj, null, 2) + '\n', message);
    },
    test: async function () {
      var c = this.cfg();
      var j = await this.api('/repos/' + c.owner + '/' + c.repo);
      return j.full_name;
    }
  };

  window.Gh = Gh;
})();
