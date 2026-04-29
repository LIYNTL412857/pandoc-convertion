/**
 * main.js - 主进程代码
 * 负责创建 Electron 应用窗口，处理文件选择、目录选择、批量转换等核心功能
 * 与渲染进程通过 IPC 通信
 */

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const { spawn, execFile, exec } = require('child_process');
const temp = require('temp');
const os = require('os');
// 配置文件路径
const configPath = path.join(app.isPackaged ? path.dirname(process.execPath) : __dirname, 'config.json');

/**
 * 读取配置文件
 * @returns {object} 配置对象
 */
function loadConfig() {
  const defaultConfig = {
    pandocPath: './pandoc/pandoc.exe',
    timeout: 25000
  };
  
  try {
    if (fs.existsSync(configPath)) {
      const configContent = fs.readFileSync(configPath, 'utf8');
      // 合并配置，保留用户自定义项
      return { ...defaultConfig, ...JSON.parse(configContent) };
    } else {
      // 如果配置文件不存在，创建默认配置
      fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
      return defaultConfig;
    }
  } catch (err) {
    console.error('读取配置文件失败:', err);
    return defaultConfig;
  }
}

// 加载配置
const config = loadConfig();

// 启用临时文件自动清理
temp.track();

// 全局变量
let mainWindow; // 主窗口实例
let converterProcess = null; // 转换进程实例
let isConverting = false; // 转换状态标志

/**
 * 创建主窗口
 * 配置窗口大小、WebPreferences 等
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, // 启用上下文隔离
      nodeIntegration: false // 禁用节点集成
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src/index.html'));
  // mainWindow.webContents.openDevTools(); // 开发时打开调试工具
}

// 获取应用程序根目录
const appRoot = app.isPackaged 
  ? path.dirname(process.execPath) 
  : __dirname;

// 使用配置中的 pandoc 路径
const PANDOC_PATH = path.resolve(
  app.isPackaged ? path.dirname(process.execPath) : __dirname,
  config.pandocPath  // 默认值: './pandoc/pandoc.exe'
);

/**
 * 检查 Pandoc 是否安装且可访问
 * @returns {Promise<{success: boolean, message: string, version?: string}>}
 */
async function checkPandoc() {
  return new Promise((resolve) => {
    // 先检查文件是否存在
    if (!fs.existsSync(PANDOC_PATH)) {
      const appRoot = app.isPackaged 
        ? path.dirname(process.execPath) 
        : __dirname;
      const expectedPath = path.join(appRoot, 'pandoc', 'pandoc.exe');
      
      resolve({
        success: false,
        message: `未找到 Pandoc 程序！\n\n配置路径：\n${PANDOC_PATH}\n\n请检查 config.json 中的 pandocPath 设置，或将 Pandoc 放置到正确位置。\n\n下载地址：https://github.com/jgm/pandoc/releases`
      });
      return;
    }

    // 检查是否可执行
    execFile(PANDOC_PATH, ['--version'], (err, stdout, stderr) => {
      if (err) {
        let errorMsg = 'Pandoc 校验失败：';
        
        if (err.code === 'ENOENT') {
          errorMsg += '文件不存在';
        } else if (err.code === 'EACCES') {
          errorMsg += '权限不足，请检查文件权限';
        } else if (err.code === 'EPERM') {
          errorMsg += '权限被拒绝';
        } else {
          errorMsg += err.message;
        }

        if (stderr) {
          errorMsg += `\n\n错误详情：\n${stderr}`;
        }

        errorMsg += '\n\n请确保 Pandoc 已正确安装到指定路径。';

        resolve({
          success: false,
          message: errorMsg
        });
      } else {
        // 提取版本信息
        const versionMatch = stdout.match(/pandoc (\d+\.\d+(\.\d+)?)/);
        const version = versionMatch ? versionMatch[1] : '未知版本';
        
        console.log(`Pandoc 版本：${version}`);
        
        resolve({
          success: true,
          message: `Pandoc ${version} 检测成功`,
          version: version
        });
      }
    });
  });
}

/**
 * 提取并处理 MD 图片
 * @param {string} mdFilePath - Markdown 文件路径
 * @param {string} imgDir - 图片存储目录
 * @returns {Promise<object>} - 返回图片路径映射
 */
function extractAndCopyImages(mdFilePath, imgDir) {
  return new Promise((resolve) => {
    const imageMap = {};
    const mdDir = path.dirname(mdFilePath);
    
    try {
      const content = fs.readFileSync(mdFilePath, 'utf8');
      const pattern = /!\[.*?\]\((.*?)(?:\s+["\'].*?["\'])?\)/g;
      let matches;
      
      while ((matches = pattern.exec(content)) !== null) {
        let imgPath = matches[1].split('?')[0].trim();
        if (imgPath.startsWith('http://') || imgPath.startsWith('https://')) continue;

        // 转为绝对路径
        const absImgPath = path.isAbsolute(imgPath) ? imgPath : path.join(mdDir, imgPath);
        if (fs.existsSync(absImgPath) && fs.statSync(absImgPath).isFile()) {
          const imgName = path.basename(absImgPath);
          const newImgPath = path.join(imgDir, imgName);
          fs.copyFileSync(absImgPath, newImgPath);
          
          // 记录路径映射
          imageMap[absImgPath] = `./images/${imgName}`;
          imageMap[path.relative(mdDir, absImgPath)] = `./images/${imgName}`;
        }
      }
      resolve(imageMap);
    } catch (e) {
      console.error('图片提取失败:', e);
      resolve(imageMap);
    }
  });
}

/**
 * 修改 MD 图片路径
 * @param {string} mdFile - Markdown 文件路径
 * @param {object} imageMap - 图片路径映射
 */
async function modifyMdImagePaths(mdFile, imageMap) {
  try {
    let content = fs.readFileSync(mdFile, 'utf8');
    for (const [oldPath, newPath] of Object.entries(imageMap)) {
      content = content.replaceAll(oldPath, newPath);
    }
    fs.writeFileSync(mdFile, content, 'utf8');
  } catch (e) {
    console.error('修改 MD 图片路径失败:', e);
  }
}

/**
 * 批量转换文件
 * @param {Array<string>} files - 要转换的文件路径数组
 * @param {string} inputFormat - 输入格式
 * @param {string} outputFormat - 输出格式
 * @param {string} outputDir - 输出目录
 * @param {boolean} embedImages - 是否嵌入图片
 */
async function batchConvertFiles(files, inputFormat, outputFormat, outputDir, embedImages) {
  isConverting = true;
  const totalFiles = files.length;
  let successCount = 0;
  let errorFiles = [];

  // 格式扩展名映射
  const formatExtMap = {
    'markdown': 'md',
    'docx': 'docx',
    'epub': 'epub',
    'html': 'html',
    'xml': 'xml',
    'txt': 'txt',
    'odt': 'odt',
    'rtf': 'rtf',
    'latex': 'tex',
    'ansi': 'txt',
    'asciidoc': 'adoc',
    'asciidoc_legacy': 'adoc',
    'bbcode': 'bbcode',
    'beamer': 'tex',
    'bibtex': 'bib',
    'biblatex': 'bib',
    'chunkedhtml': 'zip',
    'commonmark': 'md',
    'commonmark_x': 'md',
    'context': 'ctx',
    'csljson': 'json',
    'djot': 'djot',
    'docbook': 'xml',
    'docbook5': 'xml',
    'dokuwiki': 'txt',
    'epub2': 'epub',
    'fb2': 'fb2',
    'gfm': 'md',
    'haddock': 'hs',
    'html4': 'html',
    'icml': 'icml',
    'ipynb': 'ipynb',
    'jats_archiving': 'xml',
    'jats_articleauthoring': 'xml',
    'jats_publishing': 'xml',
    'jira': 'txt',
    'json': 'json',
    'man': 'man',
    'markdown_mmd': 'md',
    'markdown_phpextra': 'md',
    'markdown_strict': 'md',
    'markua': 'md',
    'mediawiki': 'txt',
    'ms': 'ms',
    'muse': 'muse',
    'native': 'hs',
    'opml': 'opml',
    'opendocument': 'odt',
    'org': 'org',

    'plain': 'txt',
    'pptx': 'pptx',
    'rst': 'rst',
    'texinfo': 'texi',
    'textile': 'textile',
    'slideous': 'html',
    'slidy': 'html',
    'dzslides': 'html',
    'revealjs': 'html',
    's5': 'html',
    'tei': 'xml',
    'typst': 'typst',
    'vimdoc': 'txt',
    'xwiki': 'txt',
    'zimwiki': 'txt'
  };
  const outputExt = formatExtMap[outputFormat.toLowerCase()] || outputFormat;
  
  // 输入格式映射 - 为不同的文件类型定义可能的输入格式
  const inputFormatMap = {
    'md': ['markdown', 'markdown_mmd', 'markdown_phpextra', 'markdown_strict', 'commonmark', 'commonmark_x', 'gfm', 'djot'],
    'html': ['html'],
    'docx': ['docx'],
    'epub': ['epub'],
    'xml': ['xml', 'docbook', 'jats', 'endnotexml', 'bits'],
    'txt': ['txt', 'asciidoc', 'creole', 'dokuwiki', 'jira', 'mediawiki', 'muse', 'pod', 'rst', 'textile', 'tikiwiki', 'twiki', 'vimwiki', 'zimwiki'],
    'odt': ['odt'],
    'rtf': ['rtf'],
    'tex': ['latex', 'beamer'],
    'bib': ['bibtex', 'biblatex'],
    'json': ['json', 'csljson'],
    'csv': ['csv'],
    'tsv': ['tsv'],
    'fb2': ['fb2'],
    'hs': ['haddock', 'native'],
    'ipynb': ['ipynb'],
    'man': ['man'],
    'mdoc': ['mdoc'],
    'opml': ['opml'],
    'org': ['org'],
    'pptx': ['pptx'],
    'ris': ['ris'],
    't2t': ['t2t'],
    'typst': ['typst'],
    'xlsx': ['xlsx']
  };

  for (let idx = 0; idx < files.length; idx++) {
    if (!isConverting) break; // 取消转换
    
    // 重置中止当前任务标志
    stopCurrentTask = false;
    
    const filePath = files[idx];
    const fileName = path.basename(filePath);
    const fileStem = path.basename(filePath, path.extname(filePath));
    const outputFile = path.join(outputDir, `${fileStem}.${outputExt}`);
    
    // 确保输出目录存在
    try {
      fs.ensureDirSync(outputDir);
    } catch (e) {
      mainWindow.webContents.send('log-update', `⚠️ 创建输出目录失败: ${e.message}`);
      errorFiles.push(fileName);
      continue;
    }
    
    // 发送进度更新
    const progress = Math.floor(((idx + 1) / totalFiles) * 100);
    mainWindow.webContents.send('progress-update', progress);
    mainWindow.webContents.send('log-update', `正在转换: ${fileName} (自动检测 → ${outputFormat})`);

    // 图片嵌入处理准备
    let tempDir = null;
    let mdFileToConvert = filePath;

    // 获取文件扩展名
    const fileExt = path.extname(filePath).toLowerCase().substring(1); // 去除点号
    
    // 获取可能的输入格式列表
    const possibleFormats = inputFormat === 'auto' 
      ? (inputFormatMap[fileExt] || ['markdown']) 
      : [inputFormat];    

    // 执行 Pandoc 转换
    let conversionSuccess = false;
    let currentInputFormat = possibleFormats[0];
    mainWindow.webContents.send('log-update', `🔄 开始尝试格式: ${currentInputFormat}`);
    
    // 尝试不同的输入格式
    for (let formatIdx = 0; formatIdx < possibleFormats.length && !conversionSuccess && isConverting && !stopCurrentTask; formatIdx++) {
      // 如果不是第一次尝试，使用不同的输入格式
      if (formatIdx > 0) {
        currentInputFormat = possibleFormats[formatIdx];
        mainWindow.webContents.send('log-update', `🔄 尝试使用格式: ${currentInputFormat}`);
      }
      
      // 构建 Pandoc 命令
      const cmd = [
        '-f', currentInputFormat,
        '-t', outputFormat,
        '--wrap=none',  // 避免自动换行
        mdFileToConvert,
        '-o', outputFile
      ];
      
      // 图片嵌入优化参数
      if (embedImages && currentInputFormat === 'markdown') {
        cmd.push('--resource-path', tempDir || path.dirname(filePath));
        if (['html', 'epub'].includes(outputFormat)) {
          cmd.push('--embed-resources', '--standalone');
        }
      }

      try {
        const result = await new Promise((resolve, reject) => {
          // 使用spawn替代execFile，以便能够杀死进程
          converterProcess = spawn(PANDOC_PATH, cmd, { encoding: 'utf8' });
          let stdout = '';
          let stderr = '';
          
          converterProcess.stdout.on('data', (data) => {
            stdout += data;
          });
          
          converterProcess.stderr.on('data', (data) => {
            stderr += data;
          });
          
          converterProcess.on('close', (code) => {
            let err = null;
            if (code !== 0) {
              err = new Error(`Pandoc exited with code ${code}`);
            }
            resolve({ err, stdout, stderr });
          });
          
          // 设置超时 - 25秒
          const timeoutId = setTimeout(() => {
            if (converterProcess) {
              converterProcess.kill();
              reject(new Error('ETIMEDOUT'));
            }
          }, 25000);
          
          converterProcess.on('close', () => {
            clearTimeout(timeoutId);
          });
        });

        if (result.err) {
          mainWindow.webContents.send('log-update', `❌ 失败 (${currentInputFormat}): ${fileName}`);
          mainWindow.webContents.send('log-update', `错误信息: ${result.stderr.substring(0, 500)}`);
        } else {
          successCount++;
          let msg = `✅ 成功 (${currentInputFormat}): ${fileName}`;
          if (embedImages && currentInputFormat === 'markdown') msg += "（图片已嵌入）";
          mainWindow.webContents.send('log-update', msg);
          conversionSuccess = true;
        }
      } catch (e) {
        if (e.code === 'ETIMEDOUT') {
          mainWindow.webContents.send('log-update', `❌ 超时 (${currentInputFormat}): ${fileName}`);
        } else {
          mainWindow.webContents.send('log-update', `❌ 异常 (${currentInputFormat}): ${fileName} - ${e.message}`);
        }
      } finally {
        // 清理converterProcess
        converterProcess = null;
      }
    }
    
    // 如果所有格式都尝试失败，添加到错误文件列表
    if (!conversionSuccess) {
      errorFiles.push(fileName);
      mainWindow.webContents.send('log-update', `❌ 所有格式尝试失败: ${fileName}`);
    }
    
    // 清理临时文件
    if (tempDir) {
      try {
        fs.removeSync(tempDir);
        mainWindow.webContents.send('log-update', `🗑️ 清理临时文件: ${tempDir}`);
      } catch (e) {
        console.error('清理临时文件失败:', e);
      }
    }
    
    // 检查是否需要中止当前任务
    if (stopCurrentTask) {
      mainWindow.webContents.send('log-update', `⏹️ 当前任务已中止，继续处理下一个文件`);
    }
  }

  // 转换完成
  if (isConverting) {
    const msg = `转换完成！成功: ${successCount}, 失败: ${errorFiles.length}`;
    mainWindow.webContents.send('log-update', `\n${errorFiles.length === 0 ? '🎉' : '⚠️'} ${msg}`);
    mainWindow.webContents.send('conversion-finished', { success: errorFiles.length === 0, message: msg });
  } else {
    mainWindow.webContents.send('log-update', "\n🛑 转换已取消");
    mainWindow.webContents.send('conversion-finished', { success: false, message: "转换已取消" });
  }

  isConverting = false;
  converterProcess = null;
}

// 应用初始化
app.whenReady().then(async () => {
  const pandocResult = await checkPandoc();
  
  if (!pandocResult.success) {
    dialog.showErrorBox(
      "Pandoc 未找到",
      pandocResult.message
    );
    app.quit();
    return;
  }

  console.log(pandocResult.message);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// IPC 通信监听

/**
 * 选择文件
 * 处理渲染进程的文件选择请求
 */
ipcMain.handle('select-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: '所有文件', extensions: ['*'] },
      { name: 'Markdown', extensions: ['md'] },
      { name: 'Word', extensions: ['docx'] },
      { name: 'HTML', extensions: ['html'] },
      { name: 'EPUB', extensions: ['epub'] },
      { name: 'XML', extensions: ['xml'] },
      { name: '文本文件', extensions: ['txt'] },
      { name: 'OpenDocument', extensions: ['odt'] },
      { name: '富文本', extensions: ['rtf'] },
      { name: 'LaTeX', extensions: ['tex'] },
      { name: 'BibTeX', extensions: ['bib'] },
      { name: 'JSON', extensions: ['json'] },
      { name: 'CSV', extensions: ['csv'] },
      { name: 'TSV', extensions: ['tsv'] },
      { name: 'FictionBook', extensions: ['fb2'] },
      { name: 'Haskell', extensions: ['hs'] },
      { name: 'Jupyter Notebook', extensions: ['ipynb'] },
      { name: 'man页面', extensions: ['man'] },
      { name: 'mdoc页面', extensions: ['mdoc'] },
      { name: 'OPML', extensions: ['opml'] },
      { name: 'Org模式', extensions: ['org'] },
      { name: 'PowerPoint', extensions: ['pptx'] },
      { name: 'RIS引用', extensions: ['ris'] },
      { name: 'txt2tags', extensions: ['t2t'] },
      { name: 'Typst', extensions: ['typst'] },
      { name: 'Excel', extensions: ['xlsx'] }
    ]
  });
  return result.canceled ? [] : result.filePaths;
});

/**
 * 选择输出目录
 * 处理渲染进程的输出目录选择请求
 */
ipcMain.handle('select-output-dir', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  return result.canceled ? '' : result.filePaths[0];
});

/**
 * 开始转换
 * 处理渲染进程的转换请求
 * @param {object} args - 转换参数
 * @param {Array<string>} args.files - 要转换的文件列表
 * @param {string} args.inputFormat - 输入格式
 * @param {string} args.outputFormat - 输出格式
 * @param {string} args.outputDir - 输出目录
 * @param {boolean} args.embedImages - 是否嵌入图片
 */
ipcMain.handle('start-conversion', async (_, args) => {
  const { files, inputFormat, outputFormat, outputDir, embedImages } = args;
  if (isConverting) return;
  
  batchConvertFiles(files, inputFormat, outputFormat, outputDir, embedImages);
});

// 中止当前任务标志
let stopCurrentTask = false;

/**
 * 停止所有转换任务
 * 处理渲染进程的停止所有任务请求
 */
ipcMain.handle('stop-conversion', () => {
  // 中止所有任务
  isConverting = false;
  if (converterProcess) {
    converterProcess.kill();
    mainWindow.webContents.send('log-update', '⏹️ 正在停止当前转换进程...');
  }
  mainWindow.webContents.send('log-update', '⏹️ 正在停止所有转换任务...');
});

/**
 * 停止当前任务
 * 处理渲染进程的停止当前任务请求
 */
ipcMain.handle('stop-current-task', () => {
  // 中止当前任务，继续下一个
  stopCurrentTask = true;
  if (converterProcess) {
    converterProcess.kill();
    mainWindow.webContents.send('log-update', '⏹️ 正在停止当前转换进程...');
  }
  mainWindow.webContents.send('log-update', '⏹️ 正在停止当前任务，将继续处理下一个文件...');
});

/**
 * 打开文件夹
 * 处理渲染进程的打开文件夹请求
 * @param {string} folderPath - 文件夹路径
 */
ipcMain.handle('open-folder', (_, folderPath) => {
  // 打开文件夹
  try {
    if (process.platform === 'win32') {
      // Windows
      exec(`start "" "${folderPath}"`);
    } else if (process.platform === 'darwin') {
      // macOS
      exec(`open "${folderPath}"`);
    } else {
      // Linux
      exec(`xdg-open "${folderPath}"`);
    }
  } catch (e) {
    console.error('打开文件夹失败:', e);
  }
});