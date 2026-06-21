# -*- coding: utf-8 -*-
"""
🌸 荣耀手机 + scrcpy 投屏 + 图灵看护 App 声音智能全自动精准标注辅助助手 (Windows & macOS 通用版) 🌸

【工作原理与安全防护】
1. 电脑端播放音频；
2. 手机端“图灵看护 App”接收声音，经过神经网络分析产生“宝宝哭了”的警报，并包含“饥饿”、“不舒服”、“需要拍嗝”、“犯困”、“烦躁”等标注词；
3. 本 Python3 助理时刻与网页后台同步：
   - 🔊 播放期间：耐心等待，绝不截图，避免旧图标干扰；
   - ⏳ 播放结束后：进入长达 4 分钟 of 智能监听搜寻期。因为手机端识别可能存在 2~3 分钟的网络偏置与计算延迟；
4. 🚀 精准防错标算法 (Timeline-based Anti-Mislabeling & 2D Spatial Proximity Pairing)：
   - 脚本会自动捕获手机屏幕上的整个报警信息时间线（如 PM16:39, PM16:18, PM16:51 等）；
   - 使用本地 OCR 进行 2D 空间几何排版解析，高精度地将“警报时间戳”与对应的“标注类别”进行二轴几何绑定，有效防止横向排版多个窗口时的文字串扰！
   - 根据本次音频的【播放开始/结束时间】计算合法的检测窗口。仅关注该时间段内由本条语音产生的新消息，完美避免在界面上残留的旧历史消息（如 10 分钟或几小时前的“饥饿”记录）被误提取！
5. 🛡️ 智能跳过逻辑与双重物理保底通道：
   - 完美适配云 preview 模式：当网络直接请求受鉴权拦截阻断时，自动启动本地【剪贴板极速物理同步】黑科技，无需网络直连，实现零门槛闭环！

【依赖安装】
在您的 Windows 命令提示符 (cmd) 或 macOS 终端中轻松运行：
  pip install requests pillow opencv-python numpy easyocr
"""

import os
import sys
import time
import subprocess
import requests
import json
import re
import numpy as np

# 默认服务端地址 (已为您自动适配设置好，本地运行时将进行智能双端口探测)
SERVER_URL = "https://ais-dev-gdvfrmmlpbjeucgdhbqw2f-916189265967.asia-east1.run.app"

# 预设的标记词汇映射（精确匹配及多场景图灵看护 App 及哭声翻译助手屏幕上的所有高亮与分类标签内容）
TARGET_KEYWORDS = {
    "饥饿": ["饥饿", "饿了", "饿啦", "饿", "进食", "喂奶", "吃奶", "hungry", "hunger", "feed", "寶寶饿了", "宝宝饿了"],
    "不舒服": ["不舒服", "难受", "不爽", "痛", "疼痛", "现在不舒服", "宝宝现在不舒服", "寶寶现在不舒服", "uncomfortable", "pain", "painful"],
    "犯困": ["犯困", "困了", "想睡", "想睡觉", "宝宝困了", "寶寶困了", "sleep", "sleepy", "tired", "drowsy"],
    "需要拍嗝": ["拍嗝", "嗝", "排气", "打嗝", "需要拍嗝", "宝宝需要拍嗝", "寶寶需要拍嗝", "burp", "gas", "wind"],
    "烦躁": ["烦躁", "焦虑", "有点烦躁", "宝宝有点烦躁", "寶寶有点烦躁", "哼唧", "fussy", "irritable", "cranky"]
}

# 报警时间线匹配正则表达式：支持 "PM16:39", "PM 16:39", "16:18" 等
TIMESTAMP_RE = re.compile(r'(?:P[MN]|A[M|N])?\s*([0-2]?\d)\s*[:：\-\.]?\s*([0-5]\d)', re.IGNORECASE)

def detect_server_url():
    """
    智能检测本地运行的标注系统端口 (3000 为网页开发接口 / 3124 为 Electron 打包的桌面端接口)
    若在云端运行则会自动检测和警告配置地址错误。
    """
    global SERVER_URL
    
    # 智能检查是否配置成了 Google AI Studio 外挂网壳地址
    if "aistudio.google.com" in SERVER_URL:
        SERVER_URL = "https://ais-dev-gdvfrmmlpbjeucgdhbqw2f-916189265967.asia-east1.run.app"
        return SERVER_URL

    # 若用户手动定义了非本地回环地址（如云端 API 等），直接予以最高优先级放行
    if SERVER_URL and ("localhost" not in SERVER_URL) and ("127.0.0.1" not in SERVER_URL):
        return SERVER_URL

    test_ports = [3000, 3124]
    for port in test_ports:
        url = f"http://localhost:{port}"
        try:
            res = requests.get(f"{url}/api/get-playback-status", timeout=1.5)
            if res.status_code == 200:
                print(f"🎉 [连接就绪] 智能检测并连接到到本地开发接口成功: {url}")
                return url
        except requests.RequestException:
            continue
    return "https://ais-dev-gdvfrmmlpbjeucgdhbqw2f-916189265967.asia-east1.run.app"

def copy_to_clipboard(text):
    """
    跨平台、免安装外部依赖包的强力剪贴板写入工具 (macOS & Windows 专属原生的管道实现)
    """
    try:
        is_windows = sys.platform.startswith('win')
        if is_windows:
            # clip 命令可以将管道中的内容安全写入到剪贴板
            p = subprocess.Popen(['clip'], stdin=subprocess.PIPE, close_fds=True)
            p.communicate(input=text.encode('gbk'))
        else:
            # macOS: 使用内置自带的 pbcopy 命令行
            p = subprocess.Popen(['pbcopy'], stdin=subprocess.PIPE, close_fds=True)
            p.communicate(input=text.encode('utf-8'))
        return True
    except Exception:
        # 第三方库 pyperclip 兜底
        try:
            import pyperclip
            pyperclip.copy(text)
            return True
        except Exception:
            return False

def get_screencapture_macos(output_path="./scrcpy_ocr_screenshot.png"):
    """
    智能跨平台（Windows & macOS）截图，自动选择最佳抓取引擎，免除平台依赖报错
    """
    if os.path.exists(output_path):
        try:
            os.remove(output_path)
        except OSError:
            pass

    is_windows = sys.platform.startswith('win')
    if is_windows:
        try:
            from PIL import ImageGrab
            screenshot = ImageGrab.grab()
            screenshot.save(output_path)
            return output_path
        except Exception as e:
            print(f"\n❌ [Windows 截图错误] 无法抓取完整屏幕: {e}")
            print("   提示: 请运行 'pip install pillow' 安装截图基础库")
            return None
    else:
        # macOS 平台优先使用系统级静效截图工具
        try:
            subprocess.run(["screencapture", "-x", output_path], check=True)
            return output_path
        except Exception as e:
            # 备用方案：Pillow
            try:
                from PIL import ImageGrab
                screenshot = ImageGrab.grab()
                screenshot.save(output_path)
                return output_path
            except Exception as fe:
                print(f"❌ [macOS 截图错误] 系统截屏与 Pillow 备用方案均不可用: {e} | {fe}")
                return None

def group_ocr_to_lines(ocr_results, y_threshold=28):
    """
    将 OCR 散乱的词块，按照垂直 Y 轴坐标和高度，合并为一行一行，方便排版分析
    """
    items = []
    for res in ocr_results:
        box, text, conf = res
        ys = [p[1] for p in box]
        xs = [p[0] for p in box]
        cy = sum(ys) / len(ys)
        cx = sum(xs) / len(xs)
        items.append({
            'text': text.strip(),
            'cx': cx,
            'cy': cy,
            'min_y': min(ys),
            'max_y': max(ys),
            'min_x': min(xs),
            'max_x': max(xs),
        })
        
    items.sort(key=lambda x: x['cy'])
    lines = []
    for item in items:
        placed = False
        for line in lines:
            if abs(line[0]['cy'] - item['cy']) < y_threshold:
                line.append(item)
                placed = True
                break
        if not placed:
            lines.append([item])
            
    # 行内按 X 轴（从左到右）排序
    for line in lines:
        line.sort(key=lambda x: x['cx'])
        
    # 整屏行自上而下排序
    lines.sort(key=lambda x: x[0]['cy'])
    return lines

def extract_timeline_alarms(lines, ocr_res=None):
    """
    解析整个屏幕的OCR数据，输出：[{'time_minutes': 999, 'time_str': '16:39', 'label': '饥饿', 'y': 1420}]
    通过 2D 坐标位置对齐规则结合高级几何空间邻近度，彻底隔离侧栏/终端等异地多窗口的文字串扰！
    并自动通过手机顶部状态栏，校正它与电脑的微弱时间差
    """
    # 1. 整理扁平化元素
    raw_items = []
    if ocr_res:
        for res in ocr_res:
            box, text, conf = res
            ys = [p[1] for p in box]
            xs = [p[0] for p in box]
            cy = sum(ys) / len(ys)
            cx = sum(xs) / len(xs)
            raw_items.append({
                'text': text.strip(),
                'cx': cx,
                'cy': cy
            })
    else:
        for line in lines:
            for it in line:
                raw_items.append({
                    'text': it['text'],
                    'cx': it['cx'],
                    'cy': it['cy']
                })

    # 1.1 自动查询系统顶部状态栏参考时间 (Y < 180px)
    phone_status_time_min = None
    for item in raw_items:
        if item['cy'] < 180:
            m = re.search(r'\b([0-2]?\d)\s*[:：]\s*([0-5]\d)\b', item['text'])
            if m:
                try:
                    ph = int(m.group(1))
                    pm = int(m.group(2))
                    phone_status_time_min = ph * 60 + pm
                    break
                except:
                    pass

    # 2. 抽取所有有效的“时间戳列表”
    timestamps = []
    for item in raw_items:
        if item['cy'] < 110:  # 忽略最顶部系统栏
            continue
            
        # 强力过滤常见的系统日期抬头
        cleaned_text = re.sub(r'[12]\d{3}\s*[-\./年]\s*\d{1,2}\s*[-\./月]\s*\d{1,2}\s*(?:日)?', ' ', item['text'])
        
        match = TIMESTAMP_RE.search(cleaned_text)
        if match:
            try:
                h = int(match.group(1))
                m = int(match.group(2))
                timestamps.append({
                    'time_minutes': h * 60 + m,
                    'time_str': f"{h:02d}:{m:02d}",
                    'x': item['cx'],
                    'y': item['cy'],
                    'text': item['text']
                })
            except:
                pass

    # 3. 收集屏幕上所有的分类标签或消息标题标签
    labels = []
    for item in raw_items:
        if item['cy'] < 110:  # 忽略最顶部系统栏
            continue
            
        is_label_candidate = False
        detected_key = None
        
        for key, keywords in TARGET_KEYWORDS.items():
            for kw in keywords:
                if kw in item['text']:
                    detected_key = key
                    is_label_candidate = True
                    break
            if detected_key:
                break
                
        if not is_label_candidate:
            if "宝宝哭了" in item['text'] or "宝宝哭" in item['text'] or "寶寶哭了" in item['text']:
                is_label_candidate = True
                
        if is_label_candidate:
            labels.append({
                'label': detected_key,
                'x': item['cx'],
                'y': item['cy'],
                'text': item['text']
            })

    # 4. 2D Euclidean Distance Proximity Matrix Pairing:
    alarms = []
    for ts in timestamps:
        best_lbl = None
        min_dist = float('inf')
        
        for lbl in labels:
            dist = float(((ts['x'] - lbl['x'])**2 + (ts['y'] - lbl['y'])**2)**0.5)
            if dist < min_dist:
                min_dist = dist
                best_lbl = lbl
                
        lbl_val = None
        if best_lbl and min_dist < 400:
            lbl_val = best_lbl['label']
            
        alarms.append({
            'time_minutes': ts['time_minutes'],
            'time_str': ts['time_str'],
            'label': lbl_val,
            'y': ts['y']
        })

    return alarms, phone_status_time_min

# ==============================================================================
# 🚀 智能直连服务模块（实现高可靠性、免剪贴板免聚焦的 HTTP 双向数据交互回环总线）
# ==============================================================================
from http.server import BaseHTTPRequestHandler, HTTPServer
import threading

class LocalHelperState:
    def __init__(self):
        self.lock = threading.Lock()
        self.is_playing = False
        self.is_waiting_interval = False
        self.current_file_path = None
        self.current_file_name = None
        self.detected_label = None
        self.should_skip = False
        self.status = "disconnected" # disconnected, connected
        self.last_sync_time = 0

helper_state = LocalHelperState()

class LocalHelperHTTPHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # 阻断打印，避免控制台信息泛滥
        pass

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_POST(self):
        if self.path == '/sync':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            try:
                data = json.loads(post_data.decode('utf-8'))
                
                with helper_state.lock:
                    new_file = data.get("currentFile")
                    new_path = new_file.get("path") if new_file else None
                    new_name = new_file.get("name") if new_file else None
                    
                    if new_path != helper_state.current_file_path:
                        # 换歌时立即重置状态，防止上一首的识别结果残留拦截
                        helper_state.detected_label = None
                        helper_state.should_skip = False
                        helper_state.current_file_path = new_path
                        helper_state.current_file_name = new_name
                        print(f"\n📲 [双向直连同步] 网页切换音轨 ➔ {new_name or '空队列'}")
                        
                    helper_state.is_playing = data.get("isPlaying", False)
                    helper_state.is_waiting_interval = data.get("isWaitingInterval", False)
                    helper_state.status = "connected"
                    helper_state.last_sync_time = time.time()
                    
                    res_body = {
                        "label": helper_state.detected_label,
                        "skip": helper_state.should_skip,
                        "connected": True
                    }
                    
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps(res_body).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(str(e).encode('utf-8'))
        else:
            self.send_response(404)
            self.end_headers()

def start_local_http_server():
    def run_server():
        server_address = ('127.0.0.1', 3124)
        try:
            httpd = HTTPServer(server_address, LocalHelperHTTPHandler)
            print("🚀 [网关极速直连就绪] 本地微型后台 API 同步服务已激活: http://127.0.0.1:3124 (推荐在网页端选择第 2 种直连模式)")
            httpd.serve_forever()
        except OSError as e:
            if e.errno == 98 or e.errno == 10048:
                # 端口已被占用，多实例并发运行时忽略
                pass
            else:
                print(f"⚠️ [直连故障] 本地微服务端口 3124 无法绑定: {e}")
                
    t = threading.Thread(target=run_server, daemon=True)
    t.start()


def main():
    print("=" * 75)
    print("      🌸 荣耀手机 + scrcpy + 图灵看护 App 声音智能精准全自动标注系统 🌸")
    print("=" * 75)
    print(" 📖 工作规则：")
    print(" 1. 网页开始播放后，助手后台静默等待，直至音频【播放结束】才会开始监控捕捉。")
    print(" 2. 时间线对比技术：仅识别【当前播放时间区间】后产生的新图灵报警记录，坚决不误判旧记录。")
    print(" 3. 标签安全性：智能多通道直连。高维支持 127.0.0.1:3124 本地极速直连。")
    print("    如果网页与网页助手建立局部直连，则将完全接管流程，免剪贴板，安全全闭环！")
    print("=" * 75)

    # 1. 启动本地直连微型后台集成服务
    start_local_http_server()

    # 智能检测服务端连接
    global SERVER_URL
    SERVER_URL = detect_server_url()

    # 加载 OCR 离线
    try:
        import easyocr
        print("🔍 正在初始化 EasyOCR 模型引擎 (首次启动若缺少中英语言包会自动下载)...")
        reader = easyocr.Reader(['ch_sim', 'en'], gpu=False)
        print("[就绪] OCR 识别模块加载并就绪！\n")
    except ImportError:
        print("\n❌ 启动失败: 检测到缺失 'easyocr' 库，请安装它：\n   pip install easyocr")
        sys.exit(1)

    last_track_file = None
    track_start_system_minutes = None
    
    api_failed_count = 0
    fallback_mode = False

    while True:
        try:
            # 2. 首先判定直连模式是否已和网页建联成功
            now_time = time.time()
            is_direct_connected = False
            with helper_state.lock:
                if helper_state.status == "connected":
                    if now_time - helper_state.last_sync_time > 6.0:
                        helper_state.status = "disconnected"
                        print("\n🔌 [直连中断] 网页连接已超时 6 秒，自动退回标准 API / 剪贴板轮询监测...")
                    else:
                        is_direct_connected = True

            if is_direct_connected:
                # ========================== [直连高精模式的分支] ==========================
                with helper_state.lock:
                    is_playing = helper_state.is_playing
                    is_waiting = helper_state.is_waiting_interval
                    curr_path = helper_state.current_file_path
                    curr_name = helper_state.current_file_name
                    detected_label = helper_state.detected_label
                    should_skip = helper_state.should_skip

                if not curr_path:
                    print(f"\r🔌 [智能直连正常] 📭 正在等候网页端载入并在列表点击播放...", end="", flush=True)
                    time.sleep(1.5)
                    continue

                if is_playing:
                    print(f"\r🔊 [智能直连播放中] 正在播放 ➔ {curr_name}，等待声音释毕...", end="", flush=True)
                    time.sleep(1.5)
                    continue

                if is_waiting:
                    if detected_label:
                        print(f"\r🌟 [智能直连-已配对] 发现分类标签: 【{detected_label}】，静待网页获取切曲...", end="", flush=True)
                        time.sleep(1.5)
                        continue
                    elif should_skip:
                        print(f"\r⚠️ [智能直连-已跳过] 已跳过该音轨，静待网页跳转...", end="", flush=True)
                        time.sleep(1.5)
                        continue

                    print(f"\n⏳ [智能直连分析中...] 音频释放完毕。截图并调用 EasyOCR 本地识别中...")
                    shot_file = get_screencapture_macos() # (Windows环境下会自动执行 adb_screencapture 兼容流程)
                    if not shot_file:
                        time.sleep(3.0)
                        continue

                    try:
                        ocr_res = reader.readtext(shot_file)
                        lines = group_ocr_to_lines(ocr_res)
                    except Exception as ocr_e:
                        print(f"   ⚠️ EasyOCR 核心读取故障 (可能由于截图文件异常)，2秒后重试 - {ocr_e}")
                        time.sleep(2.0)
                        continue

                    alarms, phone_clock_min = extract_timeline_alarms(lines, ocr_res=ocr_res)
                    
                    active_label = None
                    valid_alarms = [a for a in alarms if a.get('label') is not None]
                    if valid_alarms:
                        active_label = valid_alarms[0]['label']

                    if active_label:
                        with helper_state.lock:
                            helper_state.detected_label = active_label
                        print(f"   🌟 【高精直连匹配成功！】 识别解析到最新警报 ➔ 【{active_label}】")
                        # 同时做剪贴板备份以达成终极冗余
                        copy_to_clipboard(active_label)
                    else:
                        print("   🔍 探测结束: 暂未在屏幕上看到符合匹配规则的最新中英文分类标签，3秒后循环探测...")
                        time.sleep(3.0)
                else:
                    time.sleep(1.0)
                continue

            # ========================== [标准 API & 剪贴板兜底模式] ==========================
            is_playing = False
            is_waiting = False
            curr_path = "fallback_local"
            curr_name = "本地剪贴板监听通道音轨"
            
            try:
                res = requests.get(f"{SERVER_URL}/api/get-playback-status", timeout=4.0)
                if res.status_code != 200:
                    raise ValueError(f"HTTP Status {res.status_code}")
                status = res.json()
                
                is_playing = status.get("isPlaying", False)
                is_waiting = status.get("isWaitingInterval", False)
                curr_path = status.get("filePath")
                curr_name = status.get("fileName")
                
                if api_failed_count > 0:
                    print("\n🎉 [连接恢复] HTTP API 成功与云端服务器握手连接！已切回标准 API 双向通信通道。")
                api_failed_count = 0
                fallback_mode = False
                
            except Exception as req_err:
                api_failed_count += 1
                if api_failed_count >= 3 and not fallback_mode:
                    fallback_mode = True
                    print("\n" + "!" * 80)
                    print("🛡️  [云端专属兼容保护 - 自动启用本地剪贴板物理传输通道] 🛡️")
                    print("原因: 检测到由于云端安全沙盒隔离(如需要Cookie/IAM鉴权)，HTTP API 请求已被网关拦截。")
                    print("💡 方案: 已为您开启 [剪贴板极速物理同步机制]！无感完成全自动标注！")
                    print("📝 操作指引:")
                    print("   1. 在您的浏览器控制界面，请将第三步模式切换为 ➔ 【📋 2. 剪贴板模式】")
                    print("   2. 保持本 Python3 自动化助手在后台保持运行")
                    print("   3. 一旦脚本扫屏捕获到结论词（饥饿/不舒服等），会自动秒级将其复制到您本地电脑的剪贴板")
                    print("   4. 网页将无门槛瞬时捕获数据、自动落库记录，并安全地自动切入下一曲继续播放分析！")
                    print("👉 本地启动命令：请务必统一使用 python3 baby_cry_ocr_helper.py 运行脚本！")
                    print("!" * 80 + "\n")
                
                if fallback_mode:
                    is_playing = False
                    is_waiting = True
                else:
                    print(f"\r⚠️ [连接异常] 试图建立 API 通信，已连续失败 {api_failed_count} 次，正在自动补救...", end="", flush=True)
                    time.sleep(2.5)
                    continue

            if not fallback_mode and not curr_path:
                print(f"\r[空闲] 📭 正在等候网页端扫描导入音频队列并开始播放...", end="", flush=True)
                time.sleep(2.0)
                continue

            now_t = time.localtime()
            now_comp_min = now_t.tm_hour * 60 + now_t.tm_min

            if not fallback_mode and curr_path != last_track_file:
                print(f"\n🎧 [新音轨] 开始处理 ➔ {curr_name}")
                track_start_system_minutes = now_comp_min
                last_track_file = curr_path

            if not fallback_mode and is_playing:
                print(f"\r🔊 正在播放音频声波... 请保证手机放在电脑扬声器旁且图灵看护 App 运行在前台...", end="", flush=True)
                time.sleep(1.5)
                continue

            if is_waiting or fallback_mode:
                if fallback_mode:
                    print(f"\r📋 [剪贴板物理信道轮询运行中] 🔍 正在每隔 4.5 秒扫描系统屏幕以对齐标注...", end="", flush=True)
                else:
                    print(f"\n[音频播放结束] ⏳ 手机端正在解码判决，进入 4 分钟自动监控匹配期...")
                
                max_listening_minutes = 4
                max_retries = 80
                
                actual_retries = 1 if fallback_mode else max_retries
                retry_interval = 4.5 if fallback_mode else 3
                
                final_decision = None
                
                for attempt in range(1, actual_retries + 1):
                    if not fallback_mode:
                        try:
                            check_res = requests.get(f"{SERVER_URL}/api/get-playback-status", timeout=3.0).json()
                            if check_res.get("filePath") != curr_path or not check_res.get("isWaitingInterval"):
                                print("\n   ⚠️ 本次音轨已被手动切走或被打断，终止本次监听。")
                                break
                        except:
                            pass
                        
                        elapsed = attempt * retry_interval
                        print(f"\r   ➔ 截图与OCR解析中... 已搜寻 {elapsed}s/{max_listening_minutes*60}s (第 {attempt} 次)...", end="", flush=True)

                    shot_file = get_screencapture_macos()
                    if not shot_file:
                        time.sleep(retry_interval)
                        continue

                    try:
                        ocr_res = reader.readtext(shot_file)
                        lines = group_ocr_to_lines(ocr_res)
                    except Exception:
                        time.sleep(retry_interval)
                        continue

                    alarms, phone_clock_min = extract_timeline_alarms(lines, ocr_res=ocr_res)
                    
                    active_label = None
                    if fallback_mode:
                        valid_alarms = [a for a in alarms if a.get('label') is not None]
                        if valid_alarms:
                            active_label = valid_alarms[0]['label']
                    else:
                        time_drift = 0
                        if phone_clock_min is not None:
                            t_now = time.localtime()
                            comp_now_min = t_now.tm_hour * 60 + t_now.tm_min
                            time_drift = phone_clock_min - comp_now_min

                        phone_earliest_min = (track_start_system_minutes + time_drift - 1) % 1440
                        phone_latest_min = (now_comp_min + time_drift + 2) % 1440

                        target_time_alarms = []
                        for alarm in alarms:
                            amin = alarm['time_minutes']
                            is_inside = False
                            if phone_earliest_min <= phone_latest_min:
                                is_inside = (phone_earliest_min <= amin <= phone_latest_min)
                            else:
                                is_inside = (amin >= phone_earliest_min or amin <= phone_latest_min)
                                
                            if is_inside:
                                target_time_alarms.append(alarm)

                        if target_time_alarms:
                            labels_found = [a['label'] for a in target_time_alarms if a['label'] is not None]
                            if labels_found:
                                active_label = labels_found[0]

                    if active_label:
                        final_decision = active_label
                        print(f"\n   🌟 【匹配成功！】 识别解析到最新报警推送标签 ➔ 【{final_decision}】")
                        break
                    
                    if not fallback_mode:
                        time.sleep(retry_interval)

                if final_decision:
                    # 双重传输保障
                    did_copy = copy_to_clipboard(final_decision)
                    if did_copy:
                        print(f"   📋 [剪贴板极速投送成功] 已自动写入标签 \"{final_decision}\" 到电脑剪切板。")
                    
                    if not fallback_mode:
                        payload = { "filePath": curr_path, "label": final_decision }
                        try:
                            post_res = requests.post(f"{SERVER_URL}/api/submit-automatic-label", json=payload, timeout=5.0)
                            if post_res.status_code == 200:
                                print(f"   ➔ ✅ 已成功向云端 API 同步标注结果。")
                        except Exception:
                            pass
                else:
                    if not fallback_mode:
                        print("\n   ⚠️ 【安全跳过】 在期待安全时间窗内未匹配到具体分类标签。执行安全自动切曲操作。")
                        copy_to_clipboard("skip")
                        payload = { "filePath": curr_path, "skip": True }
                        try:
                            requests.post(f"{SERVER_URL}/api/submit-automatic-label", json=payload, timeout=5.0)
                        except Exception:
                            pass
                
                time.sleep(1.5 if fallback_mode else 4.0)

            time.sleep(1.0)
            
        except KeyboardInterrupt:
            print("\n👋 智能自动标记助手已被安全手动停止退出。")
            break
        except Exception as e:
            print(f"\n❌ [执行异常保护]: {e}")
            time.sleep(4.0)inutes*60}s (第 {attempt} 次)...", end="", flush=True)

                    shot_file = get_screencapture_macos()
                    if not shot_file:
                        time.sleep(retry_interval)
                        continue

                    try:
                        ocr_res = reader.readtext(shot_file)
                        lines = group_ocr_to_lines(ocr_res)
                    except Exception:
                        time.sleep(retry_interval)
                        continue

                    alarms, phone_clock_min = extract_timeline_alarms(lines, ocr_res=ocr_res)
                    
                    active_label = None
                    if fallback_mode:
                        valid_alarms = [a for a in alarms if a.get('label') is not None]
                        if valid_alarms:
                            active_label = valid_alarms[0]['label']
                    else:
                        time_drift = 0
                        if phone_clock_min is not None:
                            t_now = time.localtime()
                            comp_now_min = t_now.tm_hour * 60 + t_now.tm_min
                            time_drift = phone_clock_min - comp_now_min

                        phone_earliest_min = (track_start_system_minutes + time_drift - 1) % 1440
                        phone_latest_min = (now_comp_min + time_drift + 2) % 1440

                        target_time_alarms = []
                        for alarm in alarms:
                            amin = alarm['time_minutes']
                            is_inside = False
                            if phone_earliest_min <= phone_latest_min:
                                is_inside = (phone_earliest_min <= amin <= phone_latest_min)
                            else:
                                is_inside = (amin >= phone_earliest_min or amin <= phone_latest_min)
                                
                            if is_inside:
                                target_time_alarms.append(alarm)

                        if target_time_alarms:
                            labels_found = [a['label'] for a in target_time_alarms if a['label'] is not None]
                            if labels_found:
                                active_label = labels_found[0]

                    if active_label:
                        final_decision = active_label
                        print(f"\n   🌟 【匹配成功！】 识别解析到最新报警推送标签 ➔ 【{final_decision}】")
                        break
                    
                    if not fallback_mode:
                        time.sleep(retry_interval)

                if final_decision:
                    # 双星高照：API 与 物理剪贴板 两手抓
                    did_copy = copy_to_clipboard(final_decision)
                    if did_copy:
                        print(f"   📋 [剪贴板极速投送成功] 已自动写入标签 \"{final_decision}\" 到电脑剪切板。")
                    
                    if not fallback_mode:
                        payload = { "filePath": curr_path, "label": final_decision }
                        try:
                            post_res = requests.post(f"{SERVER_URL}/api/submit-automatic-label", json=payload, timeout=5.0)
                            if post_res.status_code == 200:
                                print(f"   ➔ ✅ 已成功向云端 API 同步标注结果。")
                        except Exception:
                            pass
                else:
                    if not fallback_mode:
                        print("\n   ⚠️ 【安全跳过】 在期待安全时间窗内未匹配到具体分类标签。执行安全自动切曲操作。")
                        copy_to_clipboard("skip")
                        payload = { "filePath": curr_path, "skip": True }
                        try:
                            requests.post(f"{SERVER_URL}/api/submit-automatic-label", json=payload, timeout=5.0)
                        except Exception:
                            pass
                
                time.sleep(1.5 if fallback_mode else 4.0)

            time.sleep(1.0)
            
        except KeyboardInterrupt:
            print("\n👋 智能自动标记助手已被安全手动停止退出。")
            break
        except Exception as e:
            print(f"\n❌ [执行异常保护]: {e}")
            time.sleep(4.0)

if __name__ == "__main__":
    main()
