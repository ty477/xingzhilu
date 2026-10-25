#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成风景介绍：为 content/places/ 下所有 status == "pending" 的地方调用 AI 写介绍，
写回 place JSON 并同步索引 content/places.json，最后 commit + push。

未配置 AI_API_KEY 时写入模板占位（introSource=template），不阻塞建页。
"""
import glob
import json
import os
import subprocess
import sys
import time
import urllib.request
import urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PLACES_DIR = os.path.join(ROOT, 'content', 'places')
INDEX = os.path.join(ROOT, 'content', 'places.json')

DEFAULT_BASE = 'https://open.bigmodel.cn/api/paas/v4'
DEFAULT_MODEL = 'glm-4.6'

SYSTEM_PROMPT = """你是一位兼具地理学素养与写作功底的旅行作者，为一个中国人的个人旅行相册写「风景介绍」栏目。写作要求：
1. 风格：像一个读过很多地理书的朋友在讲述——具体、克制、有细节。禁止空洞的形容词堆砌，禁止「人间仙境」「美不胜收」「令人叹为观止」这类套话。
2. 结构（markdown）：先用 1–2 段总述位置与它在大地理格局中的角色；然后「## 为什么这里长这样」讲地貌/气候/地质成因，讲给非专业读者听；然后「## 看什么」用无序列表写 3–4 条具体看点（加粗地名或景观名）；最后「## 什么时候去」给简短建议。结尾可加一行 > 引用作为收束。
3. 全文 500–800 字。不确定的具体数字不要编造；地名、史实拿不准就写得笼统一些。
4. 只输出 JSON 对象：{"intro": "markdown 全文", "summary": "20 字以内的一句话概括"}，不要输出任何其他内容。"""


def call_ai(api_key, base_url, model, user_prompt):
    url = base_url.rstrip('/') + '/chat/completions'
    payload = json.dumps({
        'model': model,
        'messages': [
            {'role': 'system', 'content': SYSTEM_PROMPT},
            {'role': 'user', 'content': user_prompt},
        ],
        'temperature': 0.7,
        'max_tokens': 2400,
    }).encode('utf-8')
    req = urllib.request.Request(url, data=payload, method='POST', headers={
        'Authorization': 'Bearer ' + api_key,
        'Content-Type': 'application/json',
    })
    last_err = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                data = json.loads(resp.read().decode('utf-8'))
            content = data['choices'][0]['message']['content']
            return parse_ai_json(content)
        except Exception as e:  # noqa: BLE001
            last_err = e
            print(f'  AI 调用失败（第 {attempt + 1} 次）：{e}', flush=True)
            time.sleep(5)
    raise RuntimeError('AI 调用连续失败：%s' % last_err)


def parse_ai_json(content):
    """容错解析：剥掉 ``` 围栏，截取首个 { 到末个 }。"""
    text = content.strip()
    if text.startswith('```'):
        text = text.strip('`')
        if text.startswith('json'):
            text = text[4:]
        text = text.strip()
    s, e = text.find('{'), text.rfind('}')
    if s >= 0 and e > s:
        try:
            obj = json.loads(text[s:e + 1])
            if 'intro' in obj:
                return obj
        except json.JSONDecodeError:
            pass
    # 整段当正文
    return {'intro': content.strip(), 'summary': content.strip().split('。')[0][:24]}


def template_intro(p):
    region = p.get('region') or ''
    date = p.get('date') or ''
    when = f'（{date}）' if date else ''
    return f"""## 这里是「{p['name']}」

{region}{when}，你把照片放在了这里，一段属于你的旅程。

**风景介绍还没有生成**：仓库尚未配置 AI 密钥。配置一次（约 3 分钟）：

1. 注册智谱开放平台 `open.bigmodel.cn`，创建一个 API Key（新用户有免费额度）
2. 打开 GitHub 仓库 → `Settings` → `Secrets and variables` → `Actions` → `New repository secret`
3. Name 填 `AI_API_KEY`，Value 填你的 Key
4. 到仓库 `Actions` → 「生成风景介绍」→ `Run workflow` 重跑一次，这段文字就会被 AI 写好的介绍替换

> 在此之前，先写下你的感受吧——那一栏永远属于你。"""


def user_prompt(p):
    lines = [f"地方名：{p['name']}"]
    if p.get('region'):
        lines.append(f"所在区域：{p['region']}")
    if p.get('landform'):
        lines.append(f"地貌类型：{p.get('landform')}")
    if p.get('date'):
        lines.append(f"旅行时间：{p['date']}")
    if p.get('notes'):
        lines.append(f"主人备注：{p['notes']}")
    lines.append(f"照片数量：{len(p.get('photos') or [])}")
    lines.append("\n请为这个地方写「风景介绍」。如果这是一个知名地方，请使用你确定了解的地理知识；如果是不知名的小地方，围绕区域与地貌类型写得可靠而克制，不要编造。")
    return '\n'.join(lines)


def load_json(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def save_json(path, obj):
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.write('\n')


def main():
    api_key = os.environ.get('AI_API_KEY', '').strip()
    base_url = (os.environ.get('AI_BASE_URL') or DEFAULT_BASE).strip()
    model = (os.environ.get('AI_MODEL') or DEFAULT_MODEL).strip()

    files = sorted(glob.glob(os.path.join(PLACES_DIR, '*.json')))
    index = load_json(INDEX)
    by_slug = {it.get('slug'): it for it in index.get('places', [])}
    changed = False

    for fp in files:
        p = load_json(fp)
        if p.get('status') != 'pending':
            continue
        print(f"== 正在生成：{p['name']}（{p['slug']}）", flush=True)

        if not api_key:
            print('  未配置 AI_API_KEY，写入模板占位。', flush=True)
            p['intro'] = template_intro(p)
            p['summary'] = p.get('summary') or '等你配置 AI 后自动补写。'
            p['status'] = 'ready'
            p['introSource'] = 'template'
        else:
            try:
                obj = call_ai(api_key, base_url, model, user_prompt(p))
                p['intro'] = obj['intro'].strip()
                p['summary'] = (obj.get('summary') or '').strip() or p['name']
                p['status'] = 'ready'
                p['introSource'] = 'ai'
                print(f"  完成：{p['summary']}", flush=True)
            except Exception as e:  # noqa: BLE001
                print(f'  失败：{e}', flush=True)
                p['status'] = 'failed'
                p['introSource'] = None

        save_json(fp, p)

        entry = by_slug.get(p['slug'])
        if entry is None:
            entry = {
                'slug': p['slug'], 'name': p['name'], 'date': p.get('date', ''),
                'region': p.get('region', ''), 'landform': p.get('landform', ''),
                'cover': (p.get('photos') or [{}])[0].get('file'),
                'photoCount': len(p.get('photos') or []),
                'summary': '', 'status': 'ready',
            }
            index.setdefault('places', []).insert(0, entry)
            by_slug[p['slug']] = entry
        entry['summary'] = p['summary']
        entry['status'] = p['status']
        changed = True

    if changed:
        save_json(INDEX, index)

        git = lambda *a: subprocess.run(  # noqa: E731
            ['git', '-c', 'user.name=album-bot',
             '-c', 'user.email=action@users.noreply.github.com'] + list(a),
            cwd=ROOT, capture_output=True, text=True)
        r = git('add', 'content')
        r = git('commit', '-m', 'chore: AI 生成风景介绍 [skip ci]')
        if r.returncode == 0:
            r = git('push')
            if r.returncode == 0:
                print('已提交并推送。', flush=True)
            else:
                print('推送失败：' + r.stderr, flush=True)
                sys.exit(1)
        else:
            print('没有需要提交的变更。', flush=True)
    else:
        print('没有待生成的地方。', flush=True)


if __name__ == '__main__':
    main()
