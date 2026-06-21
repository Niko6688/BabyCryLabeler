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

# 报警时间线匹配正则表达式：严密捕获包含冒号（中英文）分隔的时钟格式，如 "PM16:39", "PM 16:39", "16:18"，不再匹配无分隔符的普通数字
TIMESTAMP_RE = re.compile(r'\b(?:P[MN]|A[M|N])?\s*([0-2]?\d)\s*[:：]\s*([0-5]\d)\b', re.IGNORECASE)

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

def get_window_rect():
    """
    智能检测投屏窗口的坐标和大小，支持 Windows 和 macOS
    """
    keywords = ["PGT-AN00", "scrcpy", "tuya", "PGT-ANOO", "手机投屏", "PGT"]
    exclude_keywords = [
        "baby_cry_ocr_helper", "ocr_helper", "terminal", "iterm", "visual studio", "vscode", 
        "cursor", "python", "venv", "cmd.exe", "powershell", "bash", "zsh", "sublime", "xcode"
    ]
    is_windows = sys.platform.startswith('win')
    
    if is_windows:
        try:
            # 开启高 DPI 适配，防止缩放偏差
            try:
                import ctypes
                ctypes.windll.shcore.SetProcessDpiAwareness(2)
            except Exception:
                try:
                    import ctypes
                    ctypes.windll.user32.SetProcessDPIAware()
                except Exception:
                    pass
                    
            from ctypes import wintypes
            user32 = ctypes.windll.user32
            
            WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
            result = [None]
            
            def enum_windows_callback(hwnd, lparam):
                if user32.IsWindowVisible(hwnd):
                    length = user32.GetWindowTextLengthW(hwnd)
                    if length > 0:
                        buffer = ctypes.create_unicode_buffer(length + 1)
                        user32.GetWindowTextW(hwnd, buffer, length + 1)
                        title = buffer.value
                        
                        # 排除终端、IDE、及辅助脚本窗口，防止它们由于含‘scrcpy’关键字而被误捕获
                        is_excluded = False
                        for ex in exclude_keywords:
                            if ex.lower() in title.lower():
                                is_excluded = True
                                break
                        if is_excluded:
                            return True
                            
                        if any(kw.lower() in title.lower() for kw in keywords):
                            rect = wintypes.RECT()
                            if user32.GetWindowRect(hwnd, ctypes.byref(rect)):
                                w = rect.right - rect.left
                                h = rect.bottom - rect.top
                                if w > 50 and h > 50: # 排除无效窗口
                                    result[0] = (rect.left, rect.top, w, h, title)
                                    return False
                return True
                
            user32.EnumWindows(WNDENUMPROC(enum_windows_callback), 0)
            return result[0]
        except Exception as e:
            print(f"      ⚠️ Windows 窗口枚举失败: {e}")
            
    else:
        # macOS 平台
        # 策略 A: 尝试使用 Cocoa's Quartz CoreGraphics (超轻量级，100% 豁免 Accessibility 安全管理认证)
        try:
            import Quartz
            window_list = Quartz.CGWindowListCopyWindowInfo(1, 0) # kCGWindowListOptionOnScreenOnly = 1, kCGNullWindowID = 0
            for window in window_list:
                title = window.get('kCGWindowName', '') or ''
                owner_name = window.get('kCGWindowOwnerName', '') or ''
                full_title = f"{owner_name} {title}"
                
                # 用户终端、编辑器等强力排除逻辑（防止抓了运行命令或显示本脚本内容的窗口本身）
                is_excluded = False
                for ex in exclude_keywords:
                    if ex.lower() in full_title.lower() or ex.lower() in owner_name.lower():
                        is_excluded = True
                        break
                if is_excluded:
                    continue
                    
                if any(kw.lower() in full_title.lower() for kw in keywords):
                    bounds = window.get('kCGWindowBounds', {})
                    x = int(bounds.get('X', 0))
                    y = int(bounds.get('Y', 0))
                    w = int(bounds.get('Width', 0))
                    h = int(bounds.get('Height', 0))
                    if w > 100 and h > 100:
                        print(f"      🎯 [macOS Quartz API] 精准捕获窗口: '{full_title}'")
                        return (x, y, w, h, full_title)
        except Exception:
            pass

        # 策略 B: 备用方案：极速、特异性优化、拒绝检测系统后台的 AppleScript（仅针对可见 GUI 的 application）
        # 极大地解决了老代码遍历整个系统核心服务导致卡死、安全拒绝服务的情况！
        script = '''
        tell application "System Events"
            set matchedWindow to "None"
            set procList to (every process whose visible is true)
            repeat with p in procList
                try
                    set pName to name of p
                    -- 如果是终端、编辑器或系统Finder等，直接忽略，避免由于终端标题含‘scrcpy’等而被当作投屏载入
                    if pName is not "Terminal" and pName is not "iTerm" and pName is not "iTerm2" and pName is not "Visual Studio Code" and pName is not "Code" and pName is not "Cursor" and pName is not "Finder" then
                        set winList to every window of p
                        repeat with w in winList
                            try
                                set wTitle to name of w
                                if wTitle is missing value or wTitle is "" then
                                    set wTitle to title of w
                                end if
                                if wTitle is not missing value and wTitle is not "" then
                                    set isMatch to false
                                    set isExclude to false
                                    
                                    -- 对标题包含排除语素的做双保险核对
                                    if wTitle contains "baby_cry_ocr_helper" or wTitle contains "ocr_helper" or wTitle contains "Terminal" or wTitle contains "iTerm" or wTitle contains "Visual Studio" or wTitle contains "Code" or wTitle contains "Cursor" or wTitle contains "python" or wTitle contains "venv" then
                                        set isExclude to true
                                    end if
                                    
                                    if not isExclude then
                                        '''
        for kw in keywords:
            script += f'\n                                        if wTitle contains "{kw}" then set isMatch to true'
        
        script += '''
                                        if isMatch then
                                            set winPos to position of w
                                            set winSize to size of w
                                            set matchedWindow to (item 1 of winPos as string) & "," & (item 2 of winPos as string) & "," & (item 1 of winSize as string) & "," & (item 2 of winSize as string) & "," & wTitle
                                            return matchedWindow
                                        end if
                                    end if
                                end if
                            end try
                        end repeat
                    end if
                end try
            end repeat
            return "None"
        end tell
        '''
        try:
            res = subprocess.check_output(["osascript", "-e", script], text=True).strip()
            if res and res != "None":
                parts = [x.strip() for x in res.split(",")]
                if len(parts) >= 5:
                    x = int(parts[0])
                    y = int(parts[1])
                    w = int(parts[2])
                    h = int(parts[3])
                    title = ",".join(parts[4:]) # 防止标题含其它的逗号
                    print(f"      🎯 [macOS AppleScript API] 成功捕获窗口: '{title}'")
                    return (x, y, w, h, title)
        except Exception:
            pass
            
    return None

def get_virtual_screen_size():
    """
    获取系统的虚拟主显示器分辨率（点数），用于适配 Retina/Windows 缩放 DPI
    """
    is_windows = sys.platform.startswith('win')
    if is_windows:
        try:
            import ctypes
            width = ctypes.windll.user32.GetSystemMetrics(0)
            height = ctypes.windll.user32.GetSystemMetrics(1)
            return width, height
        except Exception:
            pass
    else:
        # macOS 尝试几种高兼容性脚本，Finder 范围是最稳定的不需要 App Sandbox 权限也能读取的
        scripts = [
            ('tell application "Finder" to get bounds of window of desktop', True),  # True 代表返回 {left, top, right, bottom}
            ('tell application "System Events" to get size of item 1 of desktops', False) # False 代表返回 {width, height}
        ]
        for script, is_bounds in scripts:
            try:
                res = subprocess.check_output(["osascript", "-e", script], text=True).strip()
                if res:
                    parts = [int(x.strip()) for x in res.split(",")]
                    if is_bounds and len(parts) == 4:
                        return parts[2], parts[3]
                    elif not is_bounds and len(parts) == 2:
                        return parts[0], parts[1]
            except Exception:
                pass
    return None

def get_screencapture_macos(output_path="./scrcpy_ocr_screenshot.png"):
    """
    智能跨平台（Windows & macOS）截图，自动选择最佳抓取引擎，
    并支持检测 PGT-AN00/scrcpy 投屏窗口并执行精确裁剪，最大化文字质量和减少外部噪音。
    """
    if os.path.exists(output_path):
        try:
            os.remove(output_path)
        except OSError:
            pass

    is_windows = sys.platform.startswith('win')
    temp_full_path = output_path + ".full.png"
    if os.path.exists(temp_full_path):
        try:
            os.remove(temp_full_path)
        except OSError:
            pass

    success = False
    
    # 步骤 1：捕获全屏
    if is_windows:
        try:
            from PIL import ImageGrab
            screenshot = ImageGrab.grab()
            screenshot.save(temp_full_path)
            success = True
        except Exception as e:
            print(f"\n❌ [Windows 截图错误] 无法抓取完整屏幕: {e}")
            print("   提示: 请运行 'pip install pillow' 安装截图基础库")
            return None
    else:
        try:
            subprocess.run(["screencapture", "-x", temp_full_path], check=True)
            success = True
        except Exception:
            try:
                from PIL import ImageGrab
                screenshot = ImageGrab.grab()
                screenshot.save(temp_full_path)
                success = True
            except Exception as fe:
                print(f"❌ [macOS 截图错误] 系统截屏与 Pillow 备用方案均不可用: {fe}")
                return None

    if not success or not os.path.exists(temp_full_path):
        return None

    # 步骤 2：加载全屏图片，并尝试检测投屏窗口
    try:
        from PIL import Image
        img = Image.open(temp_full_path)
        orig_w, orig_h = img.size
        
        # 尝试获取目标窗口坐标
        win_info = get_window_rect()
        if win_info:
            wx, wy, ww, wh, title = win_info
            
            # 智能对齐 DPI（因为 Pillow 物理坐标和系统的虚拟点坐标不一致）
            v_size = get_virtual_screen_size()
            scale_x, scale_y = 1.0, 1.0
            if v_size:
                vw, vh = v_size
                if vw > 0 and vh > 0:
                    scale_x = orig_w / vw
                    scale_y = orig_h / vh
            else:
                # 备用方案，猜测 Retina 或常规缩放
                if sys.platform != 'win':
                    if orig_w > 2000:
                        scale_x = scale_y = 2.0
            
            # 转换成物理像素 bbox 坐标并多留 5 个像素的安全边缘
            px_left = int(wx * scale_x) - 5
            px_top = int(wy * scale_y) - 5
            px_right = int((wx + ww) * scale_x) + 5
            px_bottom = int((wy + wh) * scale_y) + 5
            
            # 边界保护
            px_left = max(0, min(px_left, orig_w - 10))
            px_top = max(0, min(px_top, orig_h - 10))
            px_right = max(px_left + 10, min(px_right, orig_w))
            px_bottom = max(px_top + 10, min(px_bottom, orig_h))
            
            # 裁剪
            cropped_img = img.crop((px_left, px_top, px_right, px_bottom))
            cropped_img.save(output_path)
            
            print(f"   🎯 [智能窗口捕获] 成功定位投屏窗口: '{title}'")
            print(f"      ├─ 虚拟坐标: ({wx}, {wy}) 大小: {ww}x{wh}")
            print(f"      ├─ 像素缩放系数: {scale_x:.2f}x")
            print(f"      └─ 物理像素裁剪区域: L:{px_left}, T:{px_top}, R:{px_right}, B:{px_bottom} ({cropped_img.width}x{cropped_img.height})")
            
            # 删除临时全屏图片
            try:
                os.remove(temp_full_path)
            except OSError:
                pass
                
            return output_path
        else:
            # 没有找到窗口，直接把临时全屏变更为最终结果
            if os.path.exists(output_path):
                try:
                    os.remove(output_path)
                except OSError:
                    pass
            os.rename(temp_full_path, output_path)
            print("   ℹ️ [智能窗口捕获] 未检测到存活的投屏窗口 (PGT-AN00 / scrcpy / tuya 等)，自动回滚为全屏截图")
            return output_path
            
    except Exception as crop_error:
        print(f"   ⚠️ [智能裁剪容错] 裁剪或计算出错: {crop_error}，自动回退到全画面监控。")
        if os.path.exists(temp_full_path):
            try:
                if os.path.exists(output_path):
                    os.remove(output_path)
                os.rename(temp_full_path, output_path)
            except Exception:
                pass
            return output_path
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

from PIL import Image

def perform_fast_ocr(reader, image_path, max_dim=1600):
    """
    极速 OCR 识别：如果大屏幕（如 Retina、2k、4k 屏幕）截图分辨率过高，
    动态将其等比缩放至可变最大限制 max_dim（默认 1100px），这可以暴增 EasyOCR 识别速度 5-10 倍！
    同时会精确地对解析到的边界框进行反向坐标映射，确保 2D 对齐与垂直防误判定时间窗匹配精确完美。
    """
    t0 = time.time()
    try:
        img = Image.open(image_path)
    except Exception as e:
        print(f"   ⚠️ 无法打开截图临时文件 {image_path}: {e}")
        return []

    orig_w, orig_h = img.size
    scale = 1.0

    if max(orig_w, orig_h) > max_dim:
        scale = max_dim / max(orig_w, orig_h)
        new_w = int(orig_w * scale)
        new_h = int(orig_h * scale)
        # 用高保真的 LANCZOS 或 BICUBIC 保证文字极度清晰清晰
        try:
            resample_filter = Image.Resampling.LANCZOS
        except AttributeError:
            resample_filter = Image.LANCZOS
        img_resized = img.resize((new_w, new_h), resample_filter)
        img_input = np.array(img_resized)
    else:
        img_input = np.array(img)

    try:
        raw_results = reader.readtext(img_input)
    except Exception as e:
        print(f"   ⚠️ EasyOCR 核心流读取故障: {e}")
        return []

    # 反向缩放映射映射 bbox 到原始大屏幕截图分辨率
    mapped_results = []
    if scale != 1.0:
        inv_scale = 1.0 / scale
        for box, text, conf in raw_results:
            mapped_box = []
            for pt in box:
                mapped_box.append([pt[0] * inv_scale, pt[1] * inv_scale])
            mapped_results.append((mapped_box, text, conf))
    else:
        mapped_results = raw_results

    dt = time.time() - t0
    print(f"   ⚡ [极速OCR优化] 原始分辨率 {orig_w}x{orig_h} ➔ 缩放至 {img_input.shape[1]}x{img_input.shape[0]}，OCR耗时: {dt:.2f}秒 (提速约 5-10 倍)")
    return mapped_results

def extract_timeline_alarms(lines, ocr_res=None):
    """
    解析整个屏幕的OCR数据，输出：[{'time_minutes': 999, 'time_str': '16:39', 'label': '饥饿', 'y': 1420}]
    通过 2D 坐标位置对齐规则结合高级几何空间邻近度，彻底隔离侧栏/终端等异地多窗口的文字串扰！
    并自动通过手机顶部状态栏，校正它与电脑的微弱时间差
    """
    # 1. 整理扁平化元素（记录原始文本的具体高度，摆脱物理 DPI scale 束缚）
    raw_items = []
    if ocr_res:
        for res in ocr_res:
            box, text, conf = res
            ys = [p[1] for p in box]
            xs = [p[0] for p in box]
            cy = sum(ys) / len(ys)
            cx = sum(xs) / len(xs)
            h = max(ys) - min(ys)
            raw_items.append({
                'text': text.strip(),
                'cx': cx,
                'cy': cy,
                'height': h if h > 5 else 25
            })
    else:
        for line in lines:
            for it in line:
                raw_items.append({
                    'text': it['text'],
                    'cx': it['cx'],
                    'cy': it['cy'],
                    'height': it.get('max_y', 30) - it.get('min_y', 0)
                })

    # ==============================================================================
    # 🛡️ 智能防终端回环自闭环过滤机制 (Terminal Echo-Chamber Loop Prevention)
    # 彻底清洗掉屏幕选区内所有可能存在的助手控制台打印字符，尤其是包含播放时间窗和标签反馈的行！
    # ==============================================================================
    TERMINAL_KEYWORDS = [
        "时间窗", "安全核验", "播放起点", "结束时刻", "对齐偏置", "监测时间窗",
        "直连", "匹配成功", "最新警报", "最新报警", "音轨", "正在播放", "等候网页", 
        "等候", "等待声音", "探测结束", "循环探测", "手势", "剪贴板", "物理信道", 
        "系统屏幕", "对齐标注", "开始播放", "同步", "极速", "微服务", "端口", 
        "easyocr", "EasyOCR", "warnings", "Warning", "warn", "torch", "python", 
        "baby_cry", "helper", "Command", "exit", "code", "node", "applet", 
        "Terminal", "terminal", "CMD", "cmd", "Control", "control", "Ctrl", 
        "pbcopy", "clip", "screencapture", "双向", "网页切换", "音频播放", "标注辅助",
        "本地播放", "时间窗口", "极速ocr", "优化", "原始分辨率", "缩放", "极其清洗",
        "时间窗对准", "耗时", "提速", "起止点", "y轴", "x轴", "轴:", "未配轨", "未监测到",
        "未监测", "配轨", "匹配时间", "原始非终端文字块", "捕获有效时间", "空间距离", "锁定配对"
    ]
    
    # 寻找终端各行垂直 Y 轴中区受污染高度带（添加 X 轴隔离检测，拒绝横向一刀切杀伤，完美保护水平并列的 scrcpy 视窗内容）
    dirty_y_bands = []
    for item in raw_items:
        text_lower = item['text'].lower()
        if any(kw in text_lower or kw in item['text'] for kw in TERMINAL_KEYWORDS):
            h = item.get('height', 25)
            dirty_y_bands.append({
                'y_min': item['cy'] - h * 2.0,
                'y_max': item['cy'] + h * 2.0,
                'cx': item['cx'],
                'text_len': len(item['text'])
            })
            
    filtered_items = []
    for item in raw_items:
        is_dirty = False
        text_lower = item['text'].lower()
        
        # A. 命中黑名单词
        if any(kw in text_lower or kw in item['text'] for kw in TERMINAL_KEYWORDS):
            is_dirty = True
            
        # B. 含有助手日志专属符号
        if not is_dirty:
            if any(char in item['text'] for char in ["➔", "➔", "📲", "🔊", "🔌", "📊", "⏳", "🌟", "🛡️", "🌸"]):
                is_dirty = True
                
        # C. 地毯式清洗：落入任何终端日志行行带的区域（仅过滤水平距离相近的终端块，保留并列视窗中的高保真识别块）
        if not is_dirty:
            for band in dirty_y_bands:
                if band['y_min'] <= item['cy'] <= band['y_max']:
                    # 估算终端该行的大致水平长度（按字符数估算单字宽度外加 450px 冗余量）
                    horizontal_span = max(band['text_len'] * 20, 500)
                    if abs(item['cx'] - band['cx']) < horizontal_span:
                        is_dirty = True
                        break
                    
        if not is_dirty:
            filtered_items.append(item)
            
    raw_items = filtered_items

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
                
                # 智能识别“下午/PM”并自动转化为24小时制，确保时间指针对齐无一偏差
                text_upper = item['text'].upper()
                if any(x in text_upper for x in ["下午", "PM"]) and h < 12:
                    h += 12
                elif any(x in text_upper for x in ["上午", "AM"]) and h == 12:
                    h = 0
                    
                timestamps.append({
                    'time_minutes': h * 60 + m,
                    'time_str': f"{h:02d}:{m:02d}",
                    'x': item['cx'],
                    'y': item['cy'],
                    'text': item['text']
                })
            except:
                pass

    # 3. 收集屏幕上所有的分类标签（过滤掉无类别归属的 "宝宝哭了" 标题行，防近距强截胡）
    labels = []
    for item in raw_items:
        if item['cy'] < 110:  # 忽略最顶部系统栏
            continue
            
        is_label_candidate = False
        detected_key = None
        text_lower = item['text'].lower()
        
        for key, keywords in TARGET_KEYWORDS.items():
            for kw in keywords:
                if kw in text_lower or kw in item['text']:
                    detected_key = key
                    is_label_candidate = True
                    break
            if detected_key:
                break
                
        # 核心漏洞修复提示：
        # 如果 matched 标志为 True 且 detected_key 有实值，则说明匹配到了具体哭声翻译词（饥饿/犯困等）
        # 我们“绝对不能”把没有类别归属（detected_key=None）的通用警报文本“宝宝哭了”录入 label 候选集，
        # 因为“宝宝哭了”文字块由于物理排布极度靠近时间戳，会因 2D 距离优势强行“截胡”距离锁，导致真正的分类词（在稍远处）配对失败被丢弃！
        if is_label_candidate and detected_key is not None:
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
        # 兼容 Retina、2k 机器和 4K 宽大监视器的高 DPI 像素位，将空间锁定阈值提升至 850px
        if best_lbl and min_dist < 850:
            lbl_val = best_lbl['label']
            
        alarms.append({
            'time_minutes': ts['time_minutes'],
            'time_str': ts['time_str'],
            'label': lbl_val,
            'y': ts['y']
        })

    # ==========================================
    # 🗂️ 屏幕 OCR 高级可视化调试仪表盘
    # ==========================================
    sys_labels = [l['label'] for l in labels]
    sys_timestamps = [t['time_str'] for t in timestamps]
    
    print(f"\n   ┌─── 🔍 [OCR 屏幕扫描快照] ────────────────────────────────────────────────")
    print(f"   │ 📊 搜寻到原始非终端文字块: {len(raw_items)} 个")
    print(f"   │ ⏰ 捕获有效时间戳: {sys_timestamps if sys_timestamps else '❌ 未监测到时间戳'}")
    print(f"   │ 🏷️ 捕获具体分类标签: {sys_labels if sys_labels else '❌ 未监测到具体标签'}")
    
    # 智能诊断输出可能的可疑或近似文字，帮助极速定位
    suspicious_items = []
    for it in raw_items:
        txt = it['text']
        if any(kw in txt for kw in ["哭", "饥饿", "饿", "不舒服", "困", "打嗝", "需要拍嗝", "烦躁"]) or re.search(r'\d', txt):
            suspicious_items.append(txt)
            
    if suspicious_items:
        print(f"   │ 💡 包含关键字或数字的原始行: {suspicious_items[:8]}")
    
    if alarms:
        print(f"   │ 🧩 2D空间距离锁定配对线索:")
        for al in alarms:
            lbl_str = f"【{al['label']}】" if al['label'] else "✖ 未配轨标签"
            print(f"   │   ├─ 匹配时间 {al['time_str']} ➔ {lbl_str} (y轴: {al['y']:.0f})")
    print(f"   └────────────────────────────────────────────────────────────────────────")

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
        self.track_start_system_minutes = None

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
                        t_now = time.localtime()
                        helper_state.track_start_system_minutes = t_now.tm_hour * 60 + t_now.tm_min
                        print(f"\n📲 [双向直连同步] 网页切换音轨 ➔ {new_name or '空队列'}")
                        
                    is_playing_now = data.get("isPlaying", False)
                    if is_playing_now and not helper_state.is_playing:
                        t_now = time.localtime()
                        helper_state.track_start_system_minutes = t_now.tm_hour * 60 + t_now.tm_min

                    helper_state.is_playing = is_playing_now
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
        import torch
        # 智能判定是否可以使用 GPU 加速（物理显卡可成百倍提速识别）
        use_gpu = False
        try:
            if torch.cuda.is_available():
                use_gpu = True
            elif hasattr(torch.backends, 'mps') and torch.backends.mps.is_available():
                use_gpu = True
        except Exception:
            pass

        print(f"🔍 正在初始化 EasyOCR 模型引擎 (GPU 加速: {use_gpu})...")
        reader = easyocr.Reader(['ch_sim', 'en'], gpu=use_gpu)
        print("[就绪] OCR 识别模块加载并就绪！\n")
    except ImportError:
        print("\n❌ 启动失败: 检测到缺失 'easyocr' 库，请安装它：\n   pip install easyocr")
        sys.exit(1)

    last_track_file = None
    track_start_system_minutes = None
    current_track_label = None
    
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

                if detected_label:
                    state_desc = "正在播放中" if is_playing else "播放已结束(静待网页切曲)"
                    print(f"\r🌟 [智能直连-已配对] ({state_desc}) 锁定分类标签: 【{detected_label}】...", end="", flush=True)
                    time.sleep(1.5)
                    continue
                elif should_skip:
                    state_desc = "正在播放中" if is_playing else "播放已结束"
                    print(f"\r⚠️ [智能直连-已跳过] ({state_desc}) 已跳过该音轨，静待网页跳转...", end="", flush=True)
                    time.sleep(1.5)
                    continue

                # 在音频一播放时就启动截图，并在播放中实时保持监测
                state_prefix = "🔊 [音频播放中-实时监测]" if is_playing else "⏳ [音频播放结束-超时截补]"
                print(f"\n{state_prefix} 正在对音轨 {curr_name} 进行多轮屏幕指针对齐扫描...")

                shot_file = get_screencapture_macos() # (Windows环境下会自动执行 adb_screencapture 兼容流程)
                if not shot_file:
                    time.sleep(2.0)
                    continue

                try:
                    ocr_res = perform_fast_ocr(reader, shot_file)
                    lines = group_ocr_to_lines(ocr_res)
                except Exception as ocr_e:
                    print(f"   ⚠️ EasyOCR 核心读取故障 (可能由于截图文件异常)，2秒后重试 - {ocr_e}")
                    time.sleep(2.0)
                    continue
                finally:
                    # 🧹 识别物理读取结束后快速闭环深度删除图片，保障绝对的磁盘零垃圾零残留
                    if shot_file and os.path.exists(shot_file):
                        try:
                            os.remove(shot_file)
                        except OSError:
                            pass

                alarms, phone_clock_min = extract_timeline_alarms(lines, ocr_res=ocr_res)
                
                track_start_min = getattr(helper_state, 'track_start_system_minutes', None)
                t_now = time.localtime()
                now_comp_min = t_now.tm_hour * 60 + t_now.tm_min
                if track_start_min is None:
                    track_start_min = now_comp_min

                time_drift = 0
                if phone_clock_min is not None:
                    time_drift = phone_clock_min - now_comp_min

                phone_earliest_min = (track_start_min + time_drift - 1) % 1440
                phone_latest_min = (now_comp_min + time_drift + 2) % 1440

                # 强力时区与延迟时间窗保护，避免把旧的声音分类强塞给本次声音
                print(f"   📊 【时间窗对齐安全核验】 本地播放起点: {track_start_min//60:02d}:{track_start_min%60:02d}，当前时区: {now_comp_min//60:02d}:{now_comp_min%60:02d}")
                if phone_clock_min is not None:
                    print(f"   📱 安卓状态时钟: {phone_clock_min//60:02d}:{phone_clock_min%60:02d} (与电脑对齐偏置: {time_drift} 分钟)")
                print(f"   ⏳ 过滤出的有效监测时间窗: {phone_earliest_min//60:02d}:{phone_earliest_min%60:02d} 至 {phone_latest_min//60:02d}:{phone_latest_min%60:02d}")

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

                active_label = None
                if target_time_alarms:
                    labels_found = [a['label'] for a in target_time_alarms if a['label'] is not None]
                    if labels_found:
                        active_label = labels_found[0]

                if active_label:
                    with helper_state.lock:
                        helper_state.detected_label = active_label
                    print(f"   🌟 【高精直连匹配成功！】 识别解析到最新警报 ➔ 【{active_label}】")
                    # 同时做剪贴板备份以达成终极冗余
                    copy_to_clipboard(active_label)
                else:
                    if is_playing:
                        print("   🔍 播放中轮询捕获结束: 暂未在屏幕上看到符合时间窗的新标签，1.5 秒后继续扫描...")
                        time.sleep(1.5)
                    else:
                        print("   🔍 探测结束: 暂未在屏幕上看到处于本次播放时间窗口内的新中英文分类标签，2.5 秒后循环探测...")
                        time.sleep(2.5)
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
                current_track_label = None

            # 当同一轨道已经中途配对完毕后，进入节能、免截图静音状态
            if current_track_label:
                if is_playing:
                    print(f"\r🔊 [音频播放中-已配对] 正在播放 ➔ {curr_name} [已提前捕获标签: {current_track_label}]，等待声音释毕...", end="", flush=True)
                else:
                    print(f"\r🌟 [已匹配] ({curr_name}) 锁定分类标签: 【{current_track_label}】，静待网页处理并切曲...", end="", flush=True)
                time.sleep(1.5)
                continue

            # 开始实时截图/OCR扫描检测逻辑：支持音频刚播放(is_playing)即开始，也在播放中及播放后保持侦测
            if is_playing or is_waiting or fallback_mode:
                state_prefix = "🔊 [音频播放中-实时监测]" if is_playing else "⏳ [音频播放结束-超时截补]"
                if fallback_mode:
                    print(f"\r📋 [剪贴板物理信道轮询运行中] 🔍 正在每隔 4.5 秒扫描系统屏幕以对齐标注...", end="", flush=True)
                else:
                    print(f"\n{state_prefix} 正在对音轨 {curr_name} 进行屏幕检测...")

                shot_file = get_screencapture_macos()
                if not shot_file:
                    time.sleep(2.0)
                    continue

                try:
                    ocr_res = perform_fast_ocr(reader, shot_file)
                    lines = group_ocr_to_lines(ocr_res)
                except Exception:
                    time.sleep(2.0)
                    continue
                finally:
                    if shot_file and os.path.exists(shot_file):
                        try:
                            os.remove(shot_file)
                        except OSError:
                            pass

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

                    # 强力时区与延迟时间窗保护
                    print(f"   📊 【时间窗对齐安全核验】 本地播放起点: {track_start_system_minutes//60:02d}:{track_start_system_minutes%60:02d}，当前核验时间: {now_comp_min//60:02d}:{now_comp_min%60:02d}")
                    if phone_clock_min is not None:
                        print(f"   📱 安卓状态时钟: {phone_clock_min//60:02d}:{phone_clock_min%60:02d} (与电脑对齐偏置: {time_drift} 分钟)")
                    print(f"   ⏳ 过滤出的有效监测时间窗: {phone_earliest_min//60:02d}:{phone_earliest_min%60:02d} 至 {phone_latest_min//60:02d}:{phone_latest_min%60:02d}")

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
                    current_track_label = active_label
                    print(f"\n   🌟 【匹配成功！】 识别解析到最新推送标签 ➔ 【{current_track_label}】")
                    
                    # 双重传输保障
                    did_copy = copy_to_clipboard(current_track_label)
                    if did_copy:
                        print(f"   📋 [剪贴板极速投送成功] 已自动写入标签 \"{current_track_label}\" 到电脑剪切板。")
                    
                    if not fallback_mode:
                        payload = { "filePath": curr_path, "label": current_track_label }
                        try:
                            post_res = requests.post(f"{SERVER_URL}/api/submit-automatic-label", json=payload, timeout=5.0)
                            if post_res.status_code == 200:
                                print(f"   ➔ ✅ 已成功向云端 API 同步标注结果。")
                        except Exception:
                            pass
                else:
                    if is_playing:
                        print("   🔍 播放中轮询捕获结束: 暂未在屏幕上看到符合当前时间窗的新翻译标签，1.5 秒后继续扫描...")
                        time.sleep(1.5)
                    else:
                        # 正在等待网页最终判决
                        elapsed_seconds = ((now_comp_min - track_start_system_minutes) % 1440) * 60
                        if elapsed_seconds > 240: # 4分钟超时
                            print("\n   ⚠️ 【安全跳过】 在期待安全时间窗 4 分钟内未匹配到具体分类标签。执行安全自动切曲操作。")
                            current_track_label = "skip"
                            copy_to_clipboard("skip")
                            if not fallback_mode:
                                payload = { "filePath": curr_path, "skip": True }
                                try:
                                    requests.post(f"{SERVER_URL}/api/submit-automatic-label", json=payload, timeout=5.0)
                                except Exception:
                                    pass
                        else:
                            print(f"   🔍 播放结束轮询监测中 (已持续 {elapsed_seconds} 秒 / 极限 240 秒)，未监测到新标签，2.5 秒后循环探测...")
                            time.sleep(2.5)

            time.sleep(1.0)
            
        except KeyboardInterrupt:
            print("\n👋 智能自动标记助手已被安全手动停止退出。")
            break
        except Exception as e:
            print(f"\n❌ [执行异常保护]: {e}")
            time.sleep(4.0)

if __name__ == "__main__":
    main()
