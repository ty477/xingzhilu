/* 迷你 Markdown 渲染器 —— 支持标题/粗斜体/列表/引用/链接/代码/分隔线
   自带实现，避免外部 CDN 依赖（保证国内可访问） */
(function () {
  'use strict';

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function inline(s) {
    // 在已转义的文本上做行内替换
    s = s.replace(/`([^`]+)`/g, function (m, c) { return '<code>' + c + '</code>'; });
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    return s;
  }

  function render(src) {
    if (!src) return '';
    var lines = String(src).replace(/\r\n?/g, '\n').split('\n');
    var out = [];
    var para = [];
    var listBuf = null;   // {type:'ul'|'ol', items:[]}
    var quoteBuf = null;
    var i, m;

    function flushPara() {
      if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; }
    }
    function flushList() {
      if (listBuf) {
        out.push('<' + listBuf.type + '>' + listBuf.items.map(function (it) {
          return '<li>' + inline(it) + '</li>';
        }).join('') + '</' + listBuf.type + '>');
        listBuf = null;
      }
    }
    function flushQuote() {
      if (quoteBuf) { out.push('<blockquote><p>' + inline(quoteBuf.join(' ')) + '</p></blockquote>'); quoteBuf = null; }
    }
    function flushAll() { flushPara(); flushList(); flushQuote(); }

    for (i = 0; i < lines.length; i++) {
      var line = lines[i];

      // 代码块
      if (/^```/.test(line)) {
        flushAll();
        var code = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) { code.push(lines[i]); i++; }
        out.push('<pre><code>' + esc(code.join('\n')) + '</code></pre>');
        continue;
      }
      // 空行
      if (/^\s*$/.test(line)) { flushAll(); continue; }
      // 分隔线
      if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) { flushAll(); out.push('<hr>'); continue; }
      // 标题
      m = line.match(/^(#{1,4})\s+(.*)$/);
      if (m) {
        flushAll();
        var lv = Math.min(m[1].length + 1, 5); // # 映射为 h2，## 映射为 h3……
        out.push('<h' + lv + '>' + inline(m[2]) + '</h' + lv + '>');
        continue;
      }
      // 引用
      if (/^\s*>\s?/.test(line)) {
        flushPara(); flushList();
        if (!quoteBuf) quoteBuf = [];
        quoteBuf.push(line.replace(/^\s*>\s?/, ''));
        continue;
      }
      // 无序列表
      m = line.match(/^\s*[-*+]\s+(.*)$/);
      if (m) {
        flushPara(); flushQuote();
        if (!listBuf || listBuf.type !== 'ul') { flushList(); listBuf = { type: 'ul', items: [] }; }
        listBuf.items.push(m[1]);
        continue;
      }
      // 有序列表
      m = line.match(/^\s*\d+[.、]\s+(.*)$/);
      if (m) {
        flushPara(); flushQuote();
        if (!listBuf || listBuf.type !== 'ol') { flushList(); listBuf = { type: 'ol', items: [] }; }
        listBuf.items.push(m[1]);
        continue;
      }
      // 普通段落
      flushList(); flushQuote();
      para.push(line.trim());
    }
    flushAll();
    return out.join('\n');
  }

  window.MiniMD = { render: render, esc: esc };
})();
