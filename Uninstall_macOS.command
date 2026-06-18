#!/bin/bash
# Electron BabyCryLabeler macOS One-click Deep Clean Uninstaller
# Set working directory to the directory of this script file
cd "$(dirname "$0")"

clear
echo "======================================================"
echo "      婴儿哭声精准标注系统 — 一键完全卸载与清理工具"
echo "======================================================"
echo ""
echo "正在启动安全卸载程序，请稍候..."
echo ""

# Check for node installed
if ! command -v node &> /dev/null
then
    echo "[!] 警告: 未在当前系统中检测到 Node.js 环境！"
    echo "正在尝试使用 macOS 原生 Command 安全移除本地数据..."
    echo ""
    
    USER_DIR="$HOME/BabyCryLabeler_Data"
    APP_DATA_DIR="$HOME/Library/Application Support/BabyCryLabeler"
    APP_BINARY="/Applications/BabyCryLabeler.app"
    
    echo "1. 本地程序物理文件将要被清除: $APP_BINARY"
    echo "2. 软件缓存与历史记录将要被清除: $APP_DATA_DIR"
    echo "3. 您的标注输出数据集存放处: $USER_DIR"
    echo ""
    
    read -p "确认继续一键卸载并清除以上目标吗？(y/n): " confirm
    if [[ "$confirm" != "y" && "$confirm" != "yes" && "$confirm" != "Y" ]]; then
        echo "[!] 操作已取消。"
        exit 0
    fi
    
    echo ""
    if [ -d "$APP_BINARY" ]; then
        echo "正在删除应用程序: $APP_BINARY (可能需要输入您的 macOS 开机密码授权)..."
        sudo rm -rf "$APP_BINARY"
        echo "[+] 已将应用主程序完美移出系统！"
    else
        echo "[~] 未在默认 /Applications/ 目录发现应用，已自动跳过该项。"
    fi
    
    if [ -d "$APP_DATA_DIR" ]; then
        echo "正在清理缓存与日志记录..."
        rm -rf "$APP_DATA_DIR"
        echo "[+] 软件缓存与历史配置清理完成！"
    fi
    
    read -p "是否连同所有【生成的标注成果 CSV/JSON 报表】也彻底清空？(y/n): " confirm_data
    if [[ "$confirm_data" == "y" || "$confirm_data" == "yes" || "$confirm_data" == "Y" ]]; then
        if [ -d "$USER_DIR" ]; then
            rm -rf "$USER_DIR"
            echo "[+] 标注结果与测试音频文件夹清除成功！"
        fi
    else
        echo "[*] 已为您保留标注结果在：$USER_DIR"
    fi
    
    echo ""
    echo "======================================================"
    echo "   [✓] 恭喜！BabyCryLabeler 已经从您的系统上安全卸载完成！"
    echo "======================================================"
    exit 0
fi

# Run node uninstaller
node clean-uninstall.js

exit 0
