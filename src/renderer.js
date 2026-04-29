/**
 * renderer.js - 渲染进程代码
 * 负责处理用户界面交互，包括文件选择、目录选择、转换操作等
 * 与主进程通过 electronAPI 进行通信
 */

// 全局变量
let selectedFiles = []; // 存储选中的文件路径数组
let outputDir = ''; // 存储输出目录路径

// DOM 元素
const selectFilesBtn = document.getElementById('selectFilesBtn'); // 选择文件按钮
const clearFilesBtn = document.getElementById('clearFilesBtn'); // 清空文件列表按钮
const fileList = document.getElementById('fileList'); // 文件列表容器
const outputFormat = document.getElementById('outputFormat'); // 输出格式下拉框
const selectOutputBtn = document.getElementById('selectOutputBtn'); // 选择输出目录按钮
const outputPathText = document.getElementById('outputPathText'); // 输出路径显示文本
const embedImages = document.getElementById('embedImages'); // 图片嵌入复选框
const autoUpdateOutputFolder = document.getElementById('autoUpdateOutputFolder'); // 自动更新输出文件夹复选框
const convertBtn = document.getElementById('convertBtn'); // 开始转换按钮
const openOutputFolderBtn = document.getElementById('openOutputFolderBtn'); // 打开输出文件夹按钮
const stopCurrentBtn = document.getElementById('stopCurrentBtn'); // 停止当前任务按钮
const stopAllBtn = document.getElementById('stopAllBtn'); // 停止所有任务按钮
const progressBar = document.querySelector('.custom-progress-bar'); // 进度条元素
const progressText = document.querySelector('.custom-progress-text'); // 进度文本
const clearLogBtn = document.getElementById('clearLogBtn'); // 清空日志按钮
const logContainer = document.getElementById('logContainer'); // 日志容器
const themeToggleBtn = document.getElementById('themeToggleBtn'); // 主题切换按钮

/**
 * 初始化事件监听器
 * 为所有UI元素添加相应的事件处理函数
 */
function initListeners() {
  // 文件选择
  selectFilesBtn.addEventListener('click', async () => {
    // 调用主进程的selectFiles方法选择文件
    const files = await window.electronAPI.selectFiles();
    // 如果选择了文件
    if (files.length > 0) {
      // 去重并更新选中文件列表
      selectedFiles = [...new Set([...selectedFiles, ...files])]; // 去重
      // 重新渲染文件列表
      renderFileList();
      // 记录日志
      logMessage(`📌 已选择 ${selectedFiles.length} 个文件`);
      
      // 自动设置默认输出路径为最后一个文件所在目录（如果启用了自动更新）
      if (selectedFiles.length > 0 && autoUpdateOutputFolder.checked) {
        const lastFile = selectedFiles[selectedFiles.length - 1];
        // 提取最后一个文件的目录路径
        const defaultOutputDir = lastFile.substring(0, lastFile.lastIndexOf('\\'));
        // 更新输出目录
        outputDir = defaultOutputDir;
        // 更新输出路径显示
        outputPathText.textContent = defaultOutputDir;
        outputPathText.title = defaultOutputDir;
        // 更新打开输出文件夹按钮状态
        updateOpenOutputFolderBtn();
        // 记录日志
        logMessage(`📁 默认输出路径: ${defaultOutputDir}`);
      }
    }
  });

  // 清空文件列表
  clearFilesBtn.addEventListener('click', () => {
    // 清空选中文件数组
    selectedFiles = [];
    // 重新渲染文件列表
    renderFileList();
    // 记录日志
    logMessage("🗑️ 文件列表已清空");
  });

  // 存储下来拉框的状态
  let isDropdownOpen = false;

  // 定义下拉框打开/关闭时的处理函数
  function handleDropdownOpen() {
    outputFormat.classList.add('options-opened');
    isDropdownOpen = true;
    // 可以在这里添加其他打开时的处理
  }

  function handleDropdownClose() {
    outputFormat.classList.remove('options-opened');
    isDropdownOpen = false;
    // 可以在这里添加其他关闭时的处理
  }

  // 监听下拉框选择事件（选择选项后）
  outputFormat.addEventListener('change', function() {
    // 在处理选择后，立即移除聚焦状态
    this.blur(); // 这是关键操作 - 让select失去焦点
    
    // 同时清除任何可能的旋转状态
    this.classList.remove('dropdown-open');
    
    // 可以添加其他选择后的处理逻辑
    console.log('已选择输出格式:', this.value);
  });

  // 注意：现代浏览器中我们很难直接监听select的下拉事件
  // 所以我们将用以下方式来模拟控制

  // 监听下拉框的focus（打开时）和blur（关闭时）
  outputFormat.addEventListener('focus', function() {
    // 仅当点击下拉框时才旋转箭头
    if (document.activeElement === outputFormat) {
      this.classList.add('options-opened');
    }
  });

  outputFormat.addEventListener('blur', function() {
    // 失去焦点时重置箭头角度
    this.classList.remove('options-opened');
  });

  // 选择输出目录
  selectOutputBtn.addEventListener('click', async () => {
    // 调用主进程的selectOutputDir方法选择输出目录
    const dir = await window.electronAPI.selectOutputDir();
    // 如果选择了目录
    if (dir) {
      // 更新输出目录
      outputDir = dir;
      // 更新输出路径显示
      outputPathText.textContent = dir;
      outputPathText.title = dir;
      // 更新打开输出文件夹按钮状态
      updateOpenOutputFolderBtn();
      // 记录日志
      logMessage(`📁 输出路径: ${dir}`);
    }
  });

  // 开始转换
  convertBtn.addEventListener('click', async () => {
    // 前置检查
    if (selectedFiles.length === 0) {
      alert("请先选择文件！");
      return;
    }
    if (!outputDir) {
      alert("请先选择输出路径！");
      return;
    }
    const outputFmt = outputFormat.value; // 获取输出格式
    if (embedImages.checked) {
        // 图片嵌入功能会在主进程中根据实际检测到的格式自动启用
    }

    // 禁用按钮
    convertBtn.disabled = true;
    stopCurrentBtn.disabled = false;
    stopAllBtn.disabled = false;
    progressBar.value = 0;

    // 开始转换
    logMessage("\n" + "=".repeat(60));
    logMessage(`🚀 开始批量转换 - 输入: 自动检测, 输出: ${outputFmt}`);

    // 重置自定义进度条
    progressBar.style.width = '0%';
    progressText.textContent = '0%';

    // 调用主进程的startConversion方法开始转换
    await window.electronAPI.startConversion({
      files: selectedFiles, // 选中的文件列表
      inputFormat: 'auto', // 输入格式默认为auto(-f参数不支持auto，设置为auto只是一个占位作用)
      outputFormat: outputFmt, // 输出格式
      outputDir: outputDir, // 输出目录
      embedImages: embedImages.checked // 是否嵌入图片
    });
  });

  // 停止当前任务
  stopCurrentBtn.addEventListener('click', async () => {
    // 调用主进程的stopCurrentTask方法停止当前任务
    await window.electronAPI.stopCurrentTask();
  });

  // 停止所有任务
  stopAllBtn.addEventListener('click', async () => {
    // 调用主进程的stopConversion方法停止所有任务
    await window.electronAPI.stopConversion();
    // 禁用停止按钮
    stopCurrentBtn.disabled = true;
    stopAllBtn.disabled = true;
  });

  // 打开输出文件夹
  openOutputFolderBtn.addEventListener('click', async () => {
    if (outputDir) {
      // 调用主进程的openFolder方法打开输出文件夹
      await window.electronAPI.openFolder(outputDir);
      // 记录日志
      logMessage(`📁 已打开输出文件夹: ${outputDir}`);
    } else {
      alert('请先选择输出路径！');
    }
  });

  // 清空日志
  clearLogBtn.addEventListener('click', () => {
    // 清空日志容器内容
    logContainer.textContent = '';
  });

  // 拖拽文件支持
  fileList.addEventListener('dragover', (e) => {
    e.preventDefault(); // 阻止默认行为
    fileList.style.border = '2px dashed #2196F3'; // 更改边框颜色表示可拖拽
  });

  fileList.addEventListener('dragleave', () => {
    fileList.style.border = 'none'; // 恢复默认边框颜色
  });

  fileList.addEventListener('drop', async (e) => {
    e.preventDefault(); // 阻止默认行为
    fileList.style.border = 'none'; // 恢复默认边框颜色
    
    // 从拖拽事件中获取文件路径
    const files = Array.from(e.dataTransfer.files).map(file => file.path);
    // 如果有文件被拖拽
    if (files.length > 0) {
      // 去重并更新选中文件列表
      selectedFiles = [...new Set([...selectedFiles, ...files])];
      // 重新渲染文件列表
      renderFileList();
      // 记录日志
      logMessage(`📁 拖拽添加 ${files.length} 个文件，总计 ${selectedFiles.length} 个`);
      
      // 自动设置默认输出路径为最后一个文件所在目录（如果启用了自动更新）
      if (selectedFiles.length > 0 && autoUpdateOutputFolder.checked) {
        const lastFile = selectedFiles[selectedFiles.length - 1];
        // 提取最后一个文件的目录路径
        const defaultOutputDir = lastFile.substring(0, lastFile.lastIndexOf('\\'));
        // 更新输出目录
        outputDir = defaultOutputDir;
        // 更新输出路径显示
        outputPathText.textContent = defaultOutputDir;
        outputPathText.title = defaultOutputDir;
        // 更新打开输出文件夹按钮状态
        updateOpenOutputFolderBtn();
        // 记录日志
        logMessage(`📁 默认输出路径: ${defaultOutputDir}`);
      }
    }
  });

  // 主进程消息监听
  // 监听进度更新
  window.electronAPI.onProgressUpdate((progress) => {
    // 更新进度条宽度
    progressBar.style.width = `${progress}%`;
    // 更新进度文本
    progressText.textContent = `${progress}%`;
  });

  // 监听日志更新
  window.electronAPI.onLogUpdate((log) => {
    // 记录日志
    logMessage(log);
  });

  // 监听转换完成
  window.electronAPI.onConversionFinished((data) => {
    // 启用转换按钮
    convertBtn.disabled = false;
    // 禁用停止按钮
    stopCurrentBtn.disabled = true;
    stopAllBtn.disabled = true;
    // 显示完成消息
    alert(data.message);
    // 记录日志
    logMessage(`\n🏁 ${data.message}`);
  });

  // 主题切换按钮点击事件
  themeToggleBtn.addEventListener('click', toggleTheme);
}

/**
 * 初始化主题
 * 从本地存储中读取用户的主题偏好并应用
 */
function initTheme() {
  // 从本地存储中读取主题偏好，默认为亮色主题
  const savedTheme = localStorage.getItem('theme') || 'light';
  
  // 应用主题
  if (savedTheme === 'dark') {
    document.body.classList.add('dark-theme');
  } else {
    document.body.classList.remove('dark-theme');
  }
  
  // 更新按钮图标
  updateThemeButtonIcon();
}

/**
 * 切换主题
 * 在亮色主题和暗色主题之间切换，并保存到本地存储
 */
function toggleTheme() {
  // 切换主题类
  document.body.classList.toggle('dark-theme');
  
  // 确定当前主题
  const currentTheme = document.body.classList.contains('dark-theme') ? 'dark' : 'light';
  
  // 保存主题偏好到本地存储
  localStorage.setItem('theme', currentTheme);
  
  // 更新按钮图标
  updateThemeButtonIcon();
  
  // 记录日志
  logMessage(`🎨 主题已切换为${currentTheme === 'dark' ? '暗色' : '亮色'}`);
}

/**
 * 更新主题切换按钮的图标
 * 根据当前主题显示不同的图标
 */
function updateThemeButtonIcon() {
  const isDarkTheme = document.body.classList.contains('dark-theme');
  const themeIcon = themeToggleBtn.querySelector('svg');
  
  if (isDarkTheme) {
    // 暗色主题显示太阳图标
    themeIcon.innerHTML = '<path d="M11 2.66667V1M11 21V19.3333M21 11H19.3333M2.66667 11H1M16.8922 5.10778L18.0711 3.92889M3.92889 18.0711L5.10667 16.8933M18.0711 18.0711L16.8933 16.8933M5.10667 5.10667L3.92889 3.92889M15.4444 11C15.4444 12.1787 14.9762 13.3092 14.1427 14.1427C13.3092 14.9762 12.1787 15.4444 11 15.4444C9.82126 15.4444 8.6908 14.9762 7.8573 14.1427C7.02381 13.3092 6.55556 12.1787 6.55556 11C6.55556 9.82126 7.02381 8.6908 7.8573 7.8573C8.6908 7.02381 9.82126 6.55556 11 6.55556C12.1787 6.55556 13.3092 7.02381 14.1427 7.8573C14.9762 8.6908 15.4444 9.82126 15.4444 11Z" stroke="#F0F0F0" stroke-width="2" stroke-linecap="round"/>';
  } else {
    // 亮色主题显示月亮图标
    themeIcon.innerHTML = '<path d="M8.91406 1.05176C7.6046 2.36646 6.8458 4.14933 6.8457 6.05664C6.8457 9.97615 10.0238 13.1543 13.9434 13.1543C15.8502 13.1542 17.6317 12.3948 18.9463 11.0859C18.4056 15.5606 14.595 18.9998 10.0078 19C5.03313 19 1 14.9669 1 9.99219C1.00018 5.40746 4.43673 1.59287 8.91406 1.05176Z" fill="#0F0F0F" stroke="none" fill-opacity="0.80"/>';
  }
}

/**
 * 更新打开输出文件夹按钮状态
 * 根据是否设置了输出目录来启用或禁用按钮
 */
function updateOpenOutputFolderBtn() {
  openOutputFolderBtn.disabled = !outputDir;
}

/**
 * 渲染文件列表
 * 将选中的文件路径显示在文件列表容器中
 */
function renderFileList() {
  // 清空文件列表
  fileList.innerHTML = '';
  // 遍历选中的文件
  selectedFiles.forEach(file => {
    // 创建列表项
    const li = document.createElement('li');
    // 设置列表项文本为文件路径
    li.textContent = file;
    // 添加到文件列表
    fileList.appendChild(li);
  });
  // 更新清除按钮状态
  clearFilesBtn.disabled = selectedFiles.length === 0;
  
  // 当文件列表变化时，更新输出路径为最后一个文件所在目录（如果启用了自动更新）
  if (selectedFiles.length > 0 && autoUpdateOutputFolder.checked) {
    const lastFile = selectedFiles[selectedFiles.length - 1];
    // 提取最后一个文件的目录路径
    const defaultOutputDir = lastFile.substring(0, lastFile.lastIndexOf('\\'));
    // 如果输出目录与默认目录不同，则更新
    if (outputDir !== defaultOutputDir) {
      outputDir = defaultOutputDir;
      // 更新输出路径显示
      outputPathText.textContent = defaultOutputDir;
      // 更新打开输出文件夹按钮状态
      updateOpenOutputFolderBtn();
      // 记录日志
      logMessage(`📁 更新输出路径: ${defaultOutputDir}`);
    }
  }
}

/**
 * 日志输出
 * 将消息添加到日志容器并滚动到底部
 * @param {string} message - 要显示的日志消息
 */
function logMessage(message) {
  // 创建div元素来包装日志消息
  const logDiv = document.createElement('div');
  // 设置div内容为日志消息
  logDiv.textContent = message;
  // 添加到日志容器
  logContainer.appendChild(logDiv);
  // 滚动到底部
  logContainer.scrollTop = logContainer.scrollHeight; // 滚动到底部
}

// 初始化
window.addEventListener('DOMContentLoaded', () => {
  // 初始化主题
  initTheme();
  // 初始化监听
  initListeners();
  // 更新打开输出文件夹按钮状态
  updateOpenOutputFolderBtn();
  // 记录就绪日志
  logMessage("就绪 - 支持多格式互转，仅MD输入可嵌入图片");
});

// 页面卸载时移除监听
window.addEventListener('beforeunload', () => {
  // 调用主进程的removeAllListeners方法移除所有监听
  window.electronAPI.removeAllListeners();
});