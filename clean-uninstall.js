/**
 * BabyCryLabeler Clean Uninstaller
 * A perfect, secure, cross-platform uninstaller tool to safely remove the BabyCryLabeler application and its data.
 * Works perfectly on both Windows and macOS!
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const isWin = process.platform === 'win32';
const homeDir = os.homedir();

// 1. Resolve potential installation and data paths
const pathsToClean = {
  // Application Data (Settings, cache, logs created by Electron)
  appSupport: isWin 
    ? path.join(process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'), 'BabyCryLabeler')
    : path.join(homeDir, 'Library', 'Application Support', 'BabyCryLabeler'),
  
  // App binary bundle location (Default electron-builder installers path)
  appBinary: isWin
    ? path.join(process.env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local'), 'Programs', 'BabyCryLabeler')
    : '/Applications/BabyCryLabeler.app',
  
  // Custom labeled data storage (The precious labeling CSV / progress / backup files)
  labeledData: path.join(homeDir, 'BabyCryLabeler_Data')
};

console.log('\n======================================================');
console.log('   婴儿哭声精准标注系统 — 一键完全卸载与清理工具   ');
console.log('      BabyCryLabeler Clean Uninstaller (v1.0.0)      ');
console.log('======================================================\n');
console.log(`当前操作系统 (OS): ${process.platform === 'win32' ? 'Windows' : 'macOS/Linux'}`);
console.log('检测到以下关联路径：');
console.log(`1. 软件应用程序目录:  ${pathsToClean.appBinary}`);
console.log(`2. 缓存配置与日志目录: ${pathsToClean.appSupport}`);
console.log(`3. 标注数据(CSV/JSON): ${pathsToClean.labeledData}\n`);

// Recursive delete helper to work across Node.js versions
function deleteRecursive(itemPath) {
  if (!fs.existsSync(itemPath)) return false;
  
  try {
    const stat = fs.statSync(itemPath);
    if (stat.isDirectory()) {
      const files = fs.readdirSync(itemPath);
      for (const file of files) {
        deleteRecursive(path.join(itemPath, file));
      }
      fs.rmdirSync(itemPath);
    } else {
      fs.unlinkSync(itemPath);
    }
    return true;
  } catch (error) {
    console.error(`[-] 无法删除: ${itemPath}. 原因: ${error.message}`);
    return false;
  }
}

function askQuestion(query) {
  return new Promise((resolve) => rl.question(query, resolve));
}

async function runUninstaller() {
  const confirmUninstall = await askQuestion('您确定要完全卸载 BabyCryLabeler 并清理相关配置吗？(y/n): ');
  
  if (confirmUninstall.toLowerCase() !== 'y' && confirmUninstall.toLowerCase() !== 'yes') {
    console.log('\n[!] 卸载操作已被主动取消。感谢您的使用！');
    rl.close();
    process.exit(0);
  }

  console.log('\n[1/3] 开始卸载应用主程序与注册缓存...');
  
  // Clean app executable binary
  if (fs.existsSync(pathsToClean.appBinary)) {
    console.log(`正在删除应用主程序: ${pathsToClean.appBinary}`);
    const success = deleteRecursive(pathsToClean.appBinary);
    if (success) {
      console.log('[+] 应用程序主体删除成功！');
    }
  } else {
    console.log('[~] 未检测到安装在默认路径的应用主程序，如果您已手动删除，可忽略此步骤。');
  }

  // Clean application support config/caches
  if (fs.existsSync(pathsToClean.appSupport)) {
    console.log(`正在清理软件缓存与应用配置: ${pathsToClean.appSupport}`);
    const success = deleteRecursive(pathsToClean.appSupport);
    if (success) {
      console.log('[+] 软件配置与日志清理成功！');
    }
  } else {
    console.log('[~] 未找到应用运行时缓存配置，已自动跳过。');
  }

  console.log('\n[2/3] 正在对重要的数据文件进行安全询问...');
  console.log(`重要提示: ${pathsToClean.labeledData} 目录下保存着您辛辛苦苦进行的所有哭声音频标注记录 (labeled_output.csv & labeled_output.json)。`);
  
  const confirmDeleteData = await askQuestion('\n是否要连同所有【标注生成的CSV/JSON成果数据】一次性彻底删除？\n(注意：该操作不可逆，如果您需要保留标注成果，请输入 N) [y/N]: ');
  
  if (confirmDeleteData.toLowerCase() === 'y' || confirmDeleteData.toLowerCase() === 'yes') {
    if (fs.existsSync(pathsToClean.labeledData)) {
      console.log(`正在彻底清除标注成果数据: ${pathsToClean.labeledData}`);
      const success = deleteRecursive(pathsToClean.labeledData);
      if (success) {
        console.log('[+] 所有成果数据与本地测试Demo音频已完美清除！');
      }
    } else {
      console.log('[~] 未发现额外的成果目录，无需清理。');
    }
  } else {
    console.log('[*] 已安全保留您的标注结果文件夹！后续重新打开或安装本软件，您的标注结果仍可无缝读取。');
  }

  console.log('\n[3/3] 整理与完成操作...');
  console.log('\n======================================================');
  console.log('   [✓] 恭喜！BabyCryLabeler 已经从您的系统上安全完美卸载完成！   ');
  console.log('======================================================\n');
  
  rl.close();
}

runUninstaller().catch((err) => {
  console.error('卸载过程中遭遇异常: ', err);
  rl.close();
});
