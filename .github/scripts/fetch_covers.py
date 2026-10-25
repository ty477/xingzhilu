#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从 Wikimedia Commons 为每个地方抓取一张实拍封面图：
搜索 → 挑选（jpeg、宽≥1200、非地图）→ 下载 1600px 缩略图到 covers/
→ 在 place JSON 与索引中写入 coverPhoto / coverCredit → commit + push。
在 GitHub Actions 的海外 runner 上执行（本地网络无法访问 Wikimedia）。
"""
import json
import os
import re
import subprocess
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PLACES_DIR = os.path.join(ROOT, 'content', 'places')
INDEX = os.path.join(ROOT, 'content', 'places.json')
COVERS = os.path.join(ROOT, 'covers')
UA = {'User-Agent': 'xingzhilu-album/1.0 (personal travel wiki; ty477@users.noreply.github.com)'}

# slug -> (主搜索词, 备选搜索词)
TARGETS = [
    ('dunhuang',     'Crescent Lake Dunhuang',      'Mingsha Shan'),
    ('qinghaihu',    'Qinghai Lake',                None),
    ('zhangye',      'Zhangye Danxia',              None),
    ('changbaishan', 'Heaven Lake Changbai',        'Changbai Mountain Tianchi'),
    ('xian',         "Xi'an city wall",             'Xian Bell Tower'),
    ('shenzhen',     'Shenzhen skyline',            'Shenzhen city'),
    ('zhuzhou',      'Zhuzhou',                     None),
    ('beijing',      'Temple of Heaven',            'Forbidden City'),
    ('dalian',       'Dalian coast',                'Dalian Xinghai'),
]


def api_search(query):
    qs = urllib.parse.urlencode({
        'action': 'query', 'generator': 'search', 'gsrsearch': 'filetype:bitmap ' + query,
        'gsrnamespace': '6', 'gsrlimit': '15', 'prop': 'imageinfo',
        'iiprop': 'url|extmetadata|size|mime', 'iiurlwidth': '1600', 'format': 'json'})
    req = urllib.request.Request('https://commons.wikimedia.org/w/api.php?' + qs, headers=UA)
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.loads(r.read().decode()).get('query', {}).get('pages', {})


def strip_html(s):
    s = re.sub(r'<[^>]+>', '', s or '').strip()
    return re.sub(r'\s+', ' ', s)[:70]


def pick(query):
    pages = api_search(query)
    for p in sorted(pages.values(), key=lambda x: x.get('index', 99)):
        ii = (p.get('imageinfo') or [{}])[0]
        if ii.get('mime') != 'image/jpeg':
            continue
        if ii.get('width', 0) < 1200 or ii.get('height', 0) < 700:
            continue
        title = p.get('title', '')
        if re.search(r'map|logo|icon|diagram|chart|plan|panorama', title, re.I):
            continue
        md = ii.get('extmetadata', {})
        lic = strip_html(md.get('LicenseShortName', {}).get('value', ''))
        if re.search(r'fair use|non-free', lic, re.I):
            continue
        thumb = ii.get('thumburl') or ii.get('url')
        if not thumb:
            continue
        return {
            'url': thumb,
            'title': title.replace('File:', '')[:80],
            'author': strip_html(md.get('Artist', {}).get('value', '')) or '未知作者',
            'license': lic or '见来源页',
            'source': ii.get('descriptionurl', 'https://commons.wikimedia.org/'),
        }
    return None


def main():
    os.makedirs(COVERS, exist_ok=True)
    index = json.load(open(INDEX, encoding='utf-8'))
    by_slug = {it['slug']: it for it in index['places']}
    changed = False
    credits = {}

    for slug, q1, q2 in TARGETS:
        pf = os.path.join(PLACES_DIR, slug + '.json')
        if not os.path.exists(pf):
            print('跳过（无数据文件）:', slug)
            continue
        place = json.load(open(pf, encoding='utf-8'))
        got = pick(q1) or (pick(q2) if q2 else None)
        if not got:
            print('!! 未找到合适图片:', slug, q1)
            continue
        req = urllib.request.Request(got['url'], headers=UA)
        with urllib.request.urlopen(req, timeout=90) as r:
            data = r.read()
        if len(data) < 30000:
            print('!! 图片过小，跳过:', slug)
            continue
        path = 'covers/%s.jpg' % slug
        open(os.path.join(ROOT, path), 'wb').write(data)
        place['coverPhoto'] = path
        place['coverCredit'] = {
            'author': got['author'], 'license': got['license'],
            'title': got['title'], 'source': got['source'],
        }
        with open(pf, 'w', encoding='utf-8', newline='\n') as f:
            json.dump(place, f, ensure_ascii=False, indent=2)
            f.write('\n')
        if slug in by_slug:
            by_slug[slug]['cover'] = path
        credits[slug] = got
        print('OK %-13s %4dKB  %s | %s' % (slug, len(data) // 1024, got['license'], got['author']))
        changed = True

    json.dump(credits, open(os.path.join(COVERS, 'credits.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, indent=2)
    if changed:
        with open(INDEX, 'w', encoding='utf-8', newline='\n') as f:
            json.dump(index, f, ensure_ascii=False, indent=2)
            f.write('\n')
        git = lambda *a: subprocess.run(  # noqa: E731
            ['git', '-c', 'user.name=album-bot',
             '-c', 'user.email=action@users.noreply.github.com'] + list(a),
            cwd=ROOT, capture_output=True, text=True)
        git('add', 'covers', 'content')
        r = git('commit', '-m', 'covers: 从 Wikimedia Commons 抓取实拍封面 [skip ci]')
        if r.returncode == 0:
            r = git('push')
            print('已提交推送' if r.returncode == 0 else '推送失败：' + r.stderr[-300:])
        else:
            print('没有变更需要提交')
    else:
        print('没有抓到任何图片')


if __name__ == '__main__':
    main()
