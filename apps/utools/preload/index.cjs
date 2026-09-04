// apps/utools/preload/index.cjs
// uTools 预加载脚本：运行在 Node.js + Electron 渲染进程中
// 遵循 uTools 审核规范：采用 CommonJS 规范，源码清晰可读，不进行任何混淆或压缩

const fs = require("node:fs");
const path = require("node:path");

/**
 * 为渲染进程暴露的原生文件系统与路径桥接
 * 所有敏感或系统调用统一在此收敛，避免前端页面直接依赖复杂 Node 模块
 */
window.inkpointNodeBridge = {
  /**
   * 同步读取本地文件文本内容（UTF-8 编码）
   */
  readFile(filePath) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`文件不存在: ${filePath}`);
    }
    return fs.readFileSync(filePath, "utf-8");
  },

  /**
   * 同步写盘本地文件（UTF-8 编码）
   */
  writeFile(filePath, content) {
    // 确保父级目录存在
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, content, "utf-8");
  },

  /**
   * 检查本地文件或目录是否存在
   */
  exists(filePath) {
    return fs.existsSync(filePath);
  },

  /**
   * 获取路径所属目录
   */
  getDirname(filePath) {
    return path.dirname(filePath);
  },

  /**
   * 获取文件基准名称
   */
  getBasename(filePath) {
    return path.basename(filePath);
  },
};
