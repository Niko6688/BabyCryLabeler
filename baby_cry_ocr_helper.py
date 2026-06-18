# -*- coding: utf-8 -*-
"""
🌸 荣耀手机 + scrcpy 投屏 + 图灵看护 App 声音智能全自动精准标注辅助助手 (Mac 专用版) 🌸

【工作原理与安全防护】
1. 电脑端播放音频；
2. 手机端“图灵看护 App”接收声音，经过神经网络分析产生“宝宝哭了”的警报，并包含“饥饿”、“不舒服”、“需要拍嗝”、“犯困”、“烦躁”等标注词；
3. 本 Python 助理时刻与网页后台同步：
   - 🔊 播放期间：耐心等待，绝不截图，避免旧图标干扰；
   - ⏳ 播放结束后：进入长达 4 分钟的智能监听搜寻期。因为手机端识别可能存在 2~3 分钟的网络偏置与计算延迟；
4. 🚀 精准防错标算法 (Timeline-based Anti-Mislabeling)：
   - 脚本会自动捕获荣耀手机屏幕上的整个报警信息时间线（如 PM16:39, PM16:18, PM16:51 等）；
   - 使用 Mac 本地 OCR 进行空间排版重组，高精度地将“警报时间戳”与对应的“标注类别”进行一对一绑定；
   - 根据本次音频的【播放开始/结束时间】计算合法的检测窗口。仅关注该时间段内由本条语音产生的新消息，完美避免在界面上残留的旧历史消息（如 10 分钟或几小时前的“饥饿”记录）被误提取！
5. 🛡️ 智能跳过逻辑：
   - 若在 4 分钟监测期内始终没有收到任何手机反馈，或手机漏提，或手机吐出的新消息【不包含任何细分标签】（只有“宝宝哭了”而没有“饥饿/不舒服”），脚本将安全宣告“未匹配”，并自动向 Web 端发送跳过 (Skip) 命令。保证导出的数据集 100% 干净精确！

【依赖安装】
在您的 Mac 终端中轻松运行：
  pip install requests pillow opencv-python numpy pyperclip easyocr
"""

import os
import sys
import time
import subprocess
import requests
import json
import re
import numpy as np

# 默认服务端地址 (将在启动时进行智能双端口 3000/3124 探测)
SERVER_URL = "http://localhost:3000"

# 预设的标记词汇映射（精确匹配图灵看护 App 界面上的高亮标签内容）
TARGET_KEYWORDS = {
    "饥饿": ["饥饿", "hungry", "hunger", "feed"],
    "不舒服": ["不舒服", "uncomfortable", "pain", "painful"],
    "犯困": ["犯困", "sleepy", "tired", "drowsy"],
    "需要拍嗝": ["拍嗝", "嗝", "burp", "gas", "wind", "需要拍嗝"],
    "烦躁": ["烦躁", "fussy", "irritable", "cranky"]
}

# 报警时间线匹配正则表达式：支持 "PM16:39", "PM 16:39", "16:18" 等
TIMESTAMP_RE = re.compile(r'(?:P[MN]|A[M|N])?\s*([0-2]?\d)\s*[:：\-\.]?\s*([0-5]\d)', re.IGNORECASE)

def detect_server_url():
    """
    智能检测本地运行的标注系统端口 (3000 为网页开发接口 / 3124 为 Electron 打包的桌面端接口)
    """
    test_ports = [3000, 3124]
    for port in test_ports:
        url = f"http://localhost:{port}"
        try:
            res = requests.get(f"{url}/api/get-playback-status", timeout=1.2)
            if res.status_code == 200:
                print(f"🎉 [连接就绪] 智能检测并连接到服务端成功: {url}")
                return url
        except requests.RequestException:
            continue
    print("⚠️ [检测提示] 未发现正在运行的标注服务端服务 (检测端口 3000 及 3124)。将回退并默认使用 http://localhost:3000 ...")
    return "http://localhost:3000"

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
    将 OCR 散乱的词块，按照垂直 Y 轴坐标和高度，合并为一行一行、从左到右的信息流，方便高精准排版解析。
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

def extract_timeline_alarms(lines):
    """
    解析屏幕中所有的报警消息时间线，输出：[{'time_minutes': 999, 'time_str': '16:39', 'label': '饥饿', 'y': 1420}]
    并自动通过手机顶部状态栏，校正它与电脑的微弱时间差
    """
    alarms = []
    current_time_minutes = None
    current_time_str = None
    
    # 1. 自动查询手机顶部状态栏的参考时间（一般位于 Y 轴十分靠上的区域 < 110px）
    phone_status_time_min = None
    for line in lines:
        if line[0]['cy'] < 110:
            ltxt = " ".join([it['text'] for it in line])
            m = re.search(r'\b([0-2]?\d)\s*[:：]\s*([0-5]\d)\b', ltxt)
            if m:
                try:
                    ph = int(m.group(1))
                    pm = int(m.group(2))
                    phone_status_time_min = ph * 60 + pm
                    break
                except:
                    pass

    # 2. 从上到下解析图灵看护 App 的消息流
    for line in lines:
        # 忽略顶部电池/状态栏
        if line[0]['cy'] < 110:
            continue
            
        line_text = " ".join([it['text'] for it in line])
        
        # 判断本行是否是单独的时间戳（报警信息的时间一般单独占一行，如 PM16:39）
        match = TIMESTAMP_RE.search(line_text)
        if match and len(line_text.replace(" ", "")) < 12:
            try:
                h = int(match.group(1))
                m = int(match.group(2))
                current_time_minutes = h * 60 + m
                current_time_str = f"{h:02d}:{m:02d}"
                # 创建一个时间锚点
                alarms.append({
                    'time_minutes': current_time_minutes,
                    'time_str': current_time_str,
                    'label': None,
                    'y': line[0]['cy']
                })
                continue
            except:
                pass
        
        # 匹配到“宝宝哭了”事件
        if current_time_minutes is not None and "宝宝哭了" in line_text:
            detected_label = None
            for key, keywords in TARGET_KEYWORDS.items():
                for kw in keywords:
                    if kw in line_text:
                        detected_label = key
                        break
                if detected_label:
                    break
            
            # 更新此报警块的标注结果
            if detected_label and alarms:
                # 关联到最近捕获的时间锚点
                alarms[-1]['label'] = detected_label

    return alarms, phone_status_time_min

def main():
    print("=" * 75)
    print("      🌸 荣耀手机 + scrcpy + 图灵看护 App 声音智能精准全自动标注系统 🌸")
    print("=" * 75)
    print(" 工作规则：")
    print(" 1. 网页开始播放后，助手后台静默等待，直至音频【播放结束】才会开始监控捕捉。")
    print(" 2. 时间线对比技术：仅识别【当前播放时间区间】后产生的新图灵报警记录，坚决不误判旧记录。")
    print(" 3. 标签安全性：智能容错，如果识别到没有附带细分标签的消息（即漏配），或 4分钟未出结果")
    print("    程序会自动执行【安全跳过】并切歌，全自动高效无人值守！")
    print("=" * 75)

    # 智能探测服务端运行端口
    global SERVER_URL
    SERVER_URL = detect_server_url()

    # 加载 OCR 离线库
    try:
        import easyocr
        print("🔍 正在初始化 EasyOCR 模型引擎 (首次启动若缺少中英语言包会自动下载)...")
        reader = easyocr.Reader(['ch_sim', 'en'], gpu=False)
        print("[就绪] OCR 识别模块加载并就绪！")
    except ImportError:
        print("\n❌ 启动失败: 检测到缺失 'easyocr' 库，请安装它：\n   pip install easyocr")
        sys.exit(1)

    last_track_file = None
    track_start_system_minutes = None

    while True:
        try:
            # 1. 轮询网页播放器状态
            res = requests.get(f"{SERVER_URL}/api/get-playback-status")
            if res.status_code != 200:
                time.sleep(2.0)
                continue

            status = res.json()
            is_playing = status.get("isPlaying", False)
            is_waiting = status.get("isWaitingInterval", False)
            curr_path = status.get("filePath")
            curr_name = status.get("fileName")

            if not curr_path:
                print(f"\r[空闲] 📭 正在等候网页端扫描导入音频队列并开始播放...", end="", flush=True)
                time.sleep(2.0)
                continue

            # 记录当前音轨何时开始，作为提取的时间锚点
            now_t = time.localtime()
            now_comp_min = now_t.tm_hour * 60 + now_t.tm_min

            if curr_path != last_track_file:
                print(f"\n🎧 [新音轨] 开始处理 ➔ {curr_name}")
                track_start_system_minutes = now_comp_min
                last_track_file = curr_path

            # 如果还在播放声波，后台静待，不急于拍照
            if is_playing:
                time.sleep(1.5)
                continue

            # 如果当前是处于播放后等待期，开始进行高达 4 分钟的智能 OCR 时间线解析
            if is_waiting:
                print(f"\n[音频播放结束] ⏳ 手机开始接收并判断，进入 4 分钟自动识别状态...")
                
                max_listening_minutes = 4
                max_retries = 80 # 80 次 * 3秒 = 240秒 (4分钟)
                retry_interval = 3
                
                final_decision = None # "skip" or LabelName
                
                for attempt in range(1, max_retries + 1):
                    # 轮询最新状态，防止用户在前端手动干预/切歌。若发生了手动跳过，我们立刻跳出
                    try:
                        check_res = requests.get(f"{SERVER_URL}/api/get-playback-status").json()
                        if check_res.get("filePath") != curr_path or not check_res.get("isWaitingInterval"):
                            print("   ⚠️ 检测到网页端音轨状态已变动，停止本次监听。")
                            break
                    except:
                        pass

                    elapsed = attempt * retry_interval
                    print(f"\r   ➔ 等待并解析中... 已度过 {elapsed}s/{max_listening_minutes*60}s (第 {attempt} 次)...", end="", flush=True)

                    shot_file = get_screencapture_macos()
                    if not shot_file:
                        time.sleep(retry_interval)
                        continue

                    # 进行 OCR 识别
                    try:
                        ocr_res = reader.readtext(shot_file)
                        lines = group_ocr_to_lines(ocr_res)
                    except Exception as o_err:
                        print(f"\n      OCR 引擎运行出错: {o_err}")
                        time.sleep(retry_interval)
                        continue

                    # 解析时间线表格
                    alarms, phone_clock_min = extract_timeline_alarms(lines)
                    
                    # 确定手机与电脑的时钟漂移差
                    time_drift = 0
                    if phone_clock_min is not None:
                        # 当前电脑系统实时时间（分钟数）
                        t_now = time.localtime()
                        comp_now_min = t_now.tm_hour * 60 + t_now.tm_min
                        time_drift = phone_clock_min - comp_now_min

                    # 换算本次音频在手机端上最合理的期望警报时间段
                    # 1. 报警发生的最早时间：电脑开始播放本音轨的时间点（加上微弱偏移）
                    phone_earliest_min = (track_start_system_minutes + time_drift - 1) % 1440
                    # 2. 截止目前最晚时间（允许手机时间偏快 2 分钟）
                    phone_latest_min = (now_comp_min + time_drift + 2) % 1440

                    # 查找在这个安全验证窗口内产生的所有手机报警记录
                    target_time_alarms = []
                    for alarm in alarms:
                        amin = alarm['time_minutes']
                        
                        # 考虑跨午夜情况
                        is_inside = False
                        if phone_earliest_min <= phone_latest_min:
                            is_inside = (phone_earliest_min <= amin <= phone_latest_min)
                        else:  # 跨天
                            is_inside = (amin >= phone_earliest_min or amin <= phone_latest_min)
                            
                        if is_inside:
                            target_time_alarms.append(alarm)

                    # 如果在该时间窗内有检测消息：
                    if target_time_alarms:
                        # 在这些时间相符的消息里，只要有任何一条显示了具体分类 label，我们就立即采信！
                        labels_found = [a['label'] for a in target_time_alarms if a['label'] is not None]
                        if labels_found:
                            final_decision = labels_found[0]
                            print(f"\n   🌟 【匹配成功!】 发现新推送报警关联标签 ➔ 【{final_decision}】")
                            break
                        else:
                            # 找到了对应的报警消息（比如在对应的 16:39），但是并没有显示细分标签标签（只有“宝宝哭了”空内容）
                            # 说明这一段哭声荣耀手机识别不出。继续监测，看看后面是否有同时间的带标签消息追加（一般会连续弹多条日志）
                            pass
                    
                    time.sleep(retry_interval)

                # 4 分钟循环尝试结束，执行判定
                if final_decision:
                    payload = { "filePath": curr_path, "label": final_decision }
                    post_res = requests.post(f"{SERVER_URL}/api/submit-automatic-label", json=payload)
                    if post_res.status_code == 200:
                        print(f"   ➔ ✅ 已自动提交有效标签: {final_decision}")
                    else:
                        print(f"   ➔ ❌ 提交标签失败: {post_res.text}")
                else:
                    # 如果超时 4 分钟仍无反应，代表手机未给出细分标签（漏识别），安全跳过该文件，绝对保证不产生脏数据！
                    print("\n   ⚠️ 【安全跳过】 在 4分钟 期望时间窗内未捕获到手机 App 给出的哭声类型标签。直接执行跳过！")
                    payload = { "filePath": curr_path, "skip": True }
                    post_res = requests.post(f"{SERVER_URL}/api/submit-automatic-label", json=payload)
                    if post_res.status_code == 200:
                        print("   ➔ ✅ 发送跳过指令成功！浏览器端正切至下一曲...")
                    else:
                        print(f"   ➔ ❌ 发送跳过指令失败: {post_res.text}")

                # 给系统充足的休眠时间以便切歌并开始新的一轮播放
                time.sleep(4.0)

            time.sleep(1.0)
            
        except KeyboardInterrupt:
            print("\n👋 智能自动标记助手已被安全手动停止退出。")
            break
        except Exception as e:
            print(f"\n❌ [后台出错] 遇到异常: {e}")
            time.sleep(4.0)

if __name__ == "__main__":
    main()
