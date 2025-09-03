/**
 * ThinkPower Battery Monitor Dashboard
 * Responsive Multi-Page Application
 * Vanilla JavaScript for optimal performance on Raspberry Pi
 */

// 增強的應用狀態管理
class AppState {
  constructor() {
    this.currentPage = 'main';
    this.selectedChannelId = 2;
    this.isConnected = false;
    this.channelData = new Map();
    
    // 效能監控屬性
    this.lastUpdateTime = 0;
    this.updateThrottle = 100; // 100ms throttle for Pi4
    this.frameRequestId = null;
    
    // 精確的設定管理
    this.settings = {
      mode: 'tracking',
      seriesCount: 12,
      voltageSet: 3.800,
      currentSet: 0.050,
      ecSet: 0.050,
      cellOV: 4.200,
      cellUV: 2.500,
      cellOC: 2.000
    };
    
    // 系統狀態管理
    this.systemStatus = 'standby';
    this.errorCount = 0;
    this.maxErrors = 10;
  }
  
  // 統一的狀態更新機制
  updateSystemStatus(status) {
    if (this.systemStatus !== status) {
      this.systemStatus = status;
      this.notifyStatusChange(status);
    }
  }
  
  notifyStatusChange(status) {
    const statusCard = document.querySelector('.status-card');
    if (statusCard) {
      statusCard.className = `status-card ${status}`;
    }
  }
}

// Global application state
const appState = new AppState();

// WebSocket connection management
let ws = null;
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;
const reconnectDelay = 2000;

// 高效能 DOM 元素快取
const domCache = new Map();

// 定時器管理
const timers = new Set();
let periodicUpdateInterval = null;

// 效能監控
const performanceMonitor = {
  frameCount: 0,
  lastFpsTime: 0,
  currentFps: 0,
  
  updateFps() {
    this.frameCount++;
    const now = performance.now();
    if (now - this.lastFpsTime >= 1000) {
      this.currentFps = this.frameCount;
      this.frameCount = 0;
      this.lastFpsTime = now;
      
      // 自適應節流調整
      if (this.currentFps < 30) {
        appState.updateThrottle = Math.min(200, appState.updateThrottle + 20);
      } else if (this.currentFps > 45) {
        appState.updateThrottle = Math.max(50, appState.updateThrottle - 10);
      }
    }
  }
};

// 效能優化的DOM更新管理器
const DOMUpdater = {
  pendingUpdates: new Set(),
  isScheduled: false,
  
  scheduleUpdate(elementId, updateFn) {
    this.pendingUpdates.add({ elementId, updateFn });
    if (!this.isScheduled) {
      this.isScheduled = true;
      appState.frameRequestId = requestAnimationFrame(() => this.flushUpdates());
    }
  },
  
  flushUpdates() {
    this.pendingUpdates.forEach(({ elementId, updateFn }) => {
      const element = getElement(elementId) || document.querySelector(`[data-id="${elementId}"]`);
      if (element) {
        try {
          updateFn(element);
        } catch (error) {
          console.error(`DOM update error for ${elementId}:`, error);
        }
      }
    });
    
    this.pendingUpdates.clear();
    this.isScheduled = false;
    performanceMonitor.updateFps();
  }
};

// Channel status color mappings
const STATUS_COLORS = {
  NORMAL: 'status-normal',
  WARNING: 'status-warning', 
  SUCCESS: 'status-success',
  ERROR: 'status-error',
  INFO: 'status-info',
  DISABLED: 'status-disabled',
  INACTIVE: 'status-inactive'
};

/**
 * 優化的應用初始化流程
 */
document.addEventListener('DOMContentLoaded', () => {
  console.log('ThinkPower Dashboard initializing...');
  
  // 優先載入關鍵功能
  cacheDOM();
  setupNavigation();
  setupEventDelegation(); // 使用事件委派
  
  // 延遲載入非關鍵功能
  if (window.requestIdleCallback) {
    requestIdleCallback(() => {
      generateChannelGrid();
      initWebSocket();
      setupResponsiveHandlers();
      startPeriodicUpdates();
      showPage(appState.currentPage);
      console.log('Dashboard fully initialized');
    });
  } else {
    // 備用方案，使用 setTimeout
    setTimeout(() => {
      generateChannelGrid();
      initWebSocket();
      setupResponsiveHandlers();
      startPeriodicUpdates();
      showPage(appState.currentPage);
      console.log('Dashboard fully initialized');
    }, 0);
  }
  
  console.log('Dashboard core initialized');
});

/**
 * Cache frequently accessed DOM elements
 */
function cacheDOM() {
  const elements = [
    'channelsGrid', 'mainPage', 'settingsPage', 'helpPage',
    'systemStatus', 'selectedChannel', 'channelVoltage', 'channelCurrent',
    'channelPower', 'channelAh', 'channelTime', 'voltageSet', 'currentSet',
    'vmaxChannel', 'vmaxValue', 'vminChannel', 'vminValue',
    'totalVoltage', 'completedCount', 'channelInfo', 'settingsInfo',
    'controlPanel', 'processButtons'
  ];
  
  elements.forEach(id => {
    const element = document.getElementById(id);
    if (element) {
      domCache.set(id, element);
    }
  });
  
  // Cache navigation tabs
  domCache.set('navTabs', document.querySelectorAll('.nav-tab'));
}

/**
 * Get cached DOM element
 */
function getElement(id) {
  return domCache.get(id);
}

/**
 * Setup navigation between pages
 */
function setupNavigation() {
  const navTabs = getElement('navTabs');
  if (!navTabs) return;
  
  navTabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
      const page = tab.dataset.page;
      if (page && page !== appState.currentPage) {
        showPage(page);
      }
    });
  });
}

/**
 * Show specific page and update navigation
 */
function showPage(pageId) {
  const pages = ['main', 'settings', 'help'];
  const navTabs = getElement('navTabs');
  
  // Hide all pages
  pages.forEach(page => {
    const pageElement = getElement(`${page}Page`);
    if (pageElement) {
      pageElement.classList.add('hidden');
    }
  });
  
  // Show selected page
  const selectedPage = getElement(`${pageId}Page`);
  if (selectedPage) {
    selectedPage.classList.remove('hidden');
  }
  
  // Update navigation tabs
  if (navTabs) {
    navTabs.forEach(tab => {
      tab.classList.toggle('active', tab.dataset.page === pageId);
    });
  }
  
  // Update info panel based on page
  updateInfoPanel(pageId);
  
  // Update application state
  appState.currentPage = pageId;
  
  console.log(`Switched to ${pageId} page`);
}

/**
 * Update info panel content based on current page
 */
function updateInfoPanel(pageId) {
  const channelInfo = getElement('channelInfo');
  const settingsInfo = getElement('settingsInfo');
  const controlPanel = getElement('controlPanel');
  const processButtons = getElement('processButtons');
  
  if (!channelInfo || !settingsInfo || !controlPanel || !processButtons) return;
  
  switch (pageId) {
    case 'main':
      channelInfo.classList.remove('hidden');
      settingsInfo.classList.remove('hidden');
      controlPanel.classList.remove('hidden');
      processButtons.classList.add('hidden');
      break;
      
    case 'settings':
      channelInfo.classList.add('hidden');
      settingsInfo.classList.add('hidden');
      controlPanel.classList.add('hidden');
      processButtons.classList.remove('hidden');
      break;
      
    case 'help':
      channelInfo.classList.add('hidden');
      settingsInfo.classList.add('hidden');
      controlPanel.classList.add('hidden');
      processButtons.classList.add('hidden');
      break;
  }
}

/**
 * 使用事件委派的高效能事件處理
 */
function setupEventDelegation() {
  const channelsGrid = getElement('channelsGrid');
  if (!channelsGrid) return;
  
  // 使用單一事件監聽器處理所有通道點擊
  channelsGrid.addEventListener('click', (e) => {
    const channelCard = e.target.closest('.channel-card');
    if (channelCard) {
      const channelNum = parseInt(channelCard.dataset.channel);
      if (!isNaN(channelNum)) {
        selectChannel(channelNum);
      }
    }
  }, { passive: true });
  
  // 為表單設置事件委派
  const settingsForm = document.querySelector('.settings-form');
  if (settingsForm) {
    settingsForm.addEventListener('change', throttle((e) => {
      if (e.target.matches('input')) {
        // 自動儲存設定
        const fieldName = e.target.id || e.target.name;
        const value = e.target.value;
        if (fieldName && value) {
          appState.settings[fieldName] = value;
        }
      }
    }, 300), { passive: true });
  }
}

/**
 * 批量 DOM 更新的通道網格生成
 */
function generateChannelGrid() {
  const grid = getElement('channelsGrid');
  if (!grid) return;
  
  // 清除現有內容
  grid.innerHTML = '';
  
  // 使用 document fragment 提升效能
  const fragment = document.createDocumentFragment();
  
  // 生成 24 個通道（CH 01-24）
  for (let i = 1; i <= 24; i++) {
    const channelCard = createChannelCard(i);
    fragment.appendChild(channelCard);
    
    // 初始化通道資料
    const status = getInitialChannelStatus(i);
    appState.channelData.set(i, {
      voltage: 3.789 + (Math.random() - 0.5) * 0.4,
      current: 0.1 + Math.random() * 0.9,
      status: status,
      timestamp: new Date().toISOString()
    });
  }
  
  // 一次性附加所有通道提升效能
  grid.appendChild(fragment);
  
  // 更新初始顯示
  updateChannelDisplays();
}

/**
 * Get initial channel status based on Figma design
 */
function getInitialChannelStatus(channelNum) {
  // Status assignment based on Figma design colors
  if (channelNum >= 1 && channelNum <= 3) return 'normal';     // Blue
  if (channelNum >= 4 && channelNum <= 6) return 'warning';    // Orange
  if (channelNum >= 7 && channelNum <= 9) return 'success';    // Green
  if (channelNum >= 10 && channelNum <= 12) return 'error';    // Red
  if (channelNum >= 13 && channelNum <= 15) return 'info';     // Purple
  if (channelNum >= 16 && channelNum <= 18) return 'inactive'; // Light gray
  if (channelNum === 19) return 'disabled';                    // Gray
  return 'inactive'; // CH 20-24
}

/**
 * 優化的通道卡片元素創建（不再加入單獨監聽器）
 */
function createChannelCard(channelNum) {
  const card = document.createElement('div');
  card.className = 'channel-card';
  card.dataset.channel = channelNum;
  
  // 不再加入單獨的 click handler，使用事件委派
  
  const channelNumber = document.createElement('div');
  channelNumber.className = 'channel-number';
  channelNumber.textContent = `CH ${channelNum.toString().padStart(2, '0')}`;
  
  const channelVoltage = document.createElement('div');
  channelVoltage.className = 'channel-voltage';
  channelVoltage.textContent = '0.000 V';
  
  card.appendChild(channelNumber);
  card.appendChild(channelVoltage);
  
  return card;
}

/**
 * 批量更新所有通道顯示
 */
function updateChannelDisplays() {
  const updates = [];
  
  // 收集所有需要更新的資料
  appState.channelData.forEach((data, channelNum) => {
    updates.push({ channelNum, data });
  });
  
  // 使用 DOMUpdater 進行批量更新
  DOMUpdater.scheduleUpdate('channels-batch', () => {
    updates.forEach(({ channelNum, data }) => {
      updateChannelCard(channelNum, data);
    });
    updateSummaryInfo();
    updateSelectedChannelInfo();
  });
}

/**
 * 高效能的單個通道卡片更新
 */
function updateChannelCard(channelNum, data) {
  const card = document.querySelector(`[data-channel="${channelNum}"]`);
  if (!card) return;
  
  const voltageElement = card.querySelector('.channel-voltage');
  if (voltageElement) {
    // 使用 textContent 而非 innerHTML 提升效能
    voltageElement.textContent = `${data.voltage.toFixed(3)} V`;
  }
  
  // 更新狀態顏色
  const statusClass = STATUS_COLORS[data.status.toUpperCase()] || STATUS_COLORS.NORMAL;
  
  // 批量更新 CSS class 提升效能
  if (!card.classList.contains(statusClass)) {
    card.className = `channel-card ${statusClass}`;
  }
}

/**
 * Select a channel and update info panel
 */
function selectChannel(channelNum) {
  appState.selectedChannelId = channelNum;
  updateSelectedChannelInfo();
  
  // Add visual feedback
  document.querySelectorAll('.channel-card').forEach(card => {
    card.classList.remove('selected');
  });
  
  const selectedCard = document.querySelector(`[data-channel="${channelNum}"]`);
  if (selectedCard) {
    selectedCard.classList.add('selected');
  }
}

/**
 * Update selected channel information panel
 */
function updateSelectedChannelInfo() {
  const data = appState.channelData.get(appState.selectedChannelId);
  if (!data) return;
  
  const updates = {
    selectedChannel: `Channel ${appState.selectedChannelId.toString().padStart(2, '0')}`,
    channelVoltage: data.voltage.toFixed(3),
    channelCurrent: data.current.toFixed(3),
    channelPower: (data.voltage * data.current).toFixed(3),
    channelAh: '95.1678',
    channelTime: new Date().toLocaleTimeString('zh-TW', { hour12: false })
  };
  
  Object.entries(updates).forEach(([id, value]) => {
    const element = getElement(id);
    if (element) {
      element.textContent = value;
    }
  });
}

/**
 * Update summary information
 */
function updateSummaryInfo() {
  let maxVoltage = 0;
  let minVoltage = Infinity;
  let maxChannel = 1;
  let minChannel = 1;
  let totalVoltage = 0;
  let activeChannels = 0;
  
  appState.channelData.forEach((data, channelNum) => {
    const voltage = data.voltage;
    totalVoltage += voltage;
    activeChannels++;
    
    if (voltage > maxVoltage) {
      maxVoltage = voltage;
      maxChannel = channelNum;
    }
    
    if (voltage < minVoltage) {
      minVoltage = voltage;
      minChannel = channelNum;
    }
  });
  
  const updates = {
    vmaxChannel: `CH${maxChannel.toString().padStart(2, '0')}`,
    vmaxValue: `${maxVoltage.toFixed(3)} V`,
    vminChannel: `CH${minChannel.toString().padStart(2, '0')}`,
    vminValue: `${minVoltage.toFixed(3)} V`,
    totalVoltage: totalVoltage.toFixed(1),
    completedCount: activeChannels.toString()
  };
  
  Object.entries(updates).forEach(([id, value]) => {
    const element = getElement(id);
    if (element) {
      element.textContent = value;
    }
  });
}

/**
 * Setup responsive behavior handlers
 */
function setupResponsiveHandlers() {
  // Handle window resize
  let resizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      handleResponsiveLayout();
    }, 250);
  });
  
  // Handle orientation change on mobile
  window.addEventListener('orientationchange', () => {
    setTimeout(handleResponsiveLayout, 500);
  });
  
  // Initial responsive setup
  handleResponsiveLayout();
}

/**
 * Handle responsive layout adjustments
 */
function handleResponsiveLayout() {
  const viewportWidth = window.innerWidth;
  const appContainer = document.querySelector('.app-container');
  
  if (!appContainer) return;
  
  // Add responsive classes
  appContainer.classList.toggle('mobile', viewportWidth < 768);
  appContainer.classList.toggle('tablet', viewportWidth >= 768 && viewportWidth < 1024);
  appContainer.classList.toggle('desktop', viewportWidth >= 1024);
  
  // Adjust channel grid for mobile
  if (viewportWidth < 768) {
    const grid = getElement('channelsGrid');
    if (grid) {
      grid.style.gridTemplateColumns = 'repeat(4, 80px)';
      grid.style.gridTemplateRows = 'repeat(6, 80px)';
    }
  }
}

/**
 * Initialize WebSocket connection
 */
function initWebSocket() {
  try {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
      console.log('WebSocket connected');
      appState.isConnected = true;
      reconnectAttempts = 0;
      updateSystemStatus('連線中');
    };
    
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleWebSocketMessage(data);
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };
    
    ws.onclose = () => {
      console.log('WebSocket disconnected');
      appState.isConnected = false;
      updateSystemStatus('離線');
      
      if (reconnectAttempts < maxReconnectAttempts) {
        setTimeout(initWebSocket, reconnectDelay * Math.pow(2, reconnectAttempts));
        reconnectAttempts++;
      }
    };
    
    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      updateSystemStatus('錯誤');
    };
    
  } catch (error) {
    console.error('Failed to initialize WebSocket:', error);
    updateSystemStatus('離線');
  }
}

/**
 * 優化的 WebSocket 訊息處理
 */
function handleWebSocketMessage(data) {
  const now = performance.now();
  
  // 節流處理避免過度更新
  if (now - appState.lastUpdateTime < appState.updateThrottle) {
    return;
  }
  
  if (data.type === 'channelUpdate' && data.channels) {
    // 批量更新減少重繪
    const updates = [];
    
    Object.entries(data.channels).forEach(([channelNum, channelInfo]) => {
      const num = parseInt(channelNum);
      if (appState.channelData.has(num)) {
        const updatedData = {
          ...appState.channelData.get(num),
          ...channelInfo,
          timestamp: new Date().toISOString()
        };
        appState.channelData.set(num, updatedData);
        updates.push({ num, data: updatedData });
      }
    });
    
    // 批量 DOM 更新
    if (updates.length > 0) {
      DOMUpdater.scheduleUpdate('websocket-update', () => {
        updates.forEach(({ num, data }) => updateChannelCard(num, data));
        updateSummaryInfo();
      });
    }
    
    appState.lastUpdateTime = now;
  }
  
  // 錯誤計數器重置
  appState.errorCount = 0;
}

/**
 * Update system status indicator
 */
function updateSystemStatus(status) {
  const statusElement = getElement('systemStatus');
  if (statusElement) {
    statusElement.textContent = status;
  }
}

/**
 * 記憶體優化的定期更新
 */
function startPeriodicUpdates() {
  // 清理舊的定時器
  if (periodicUpdateInterval) {
    clearInterval(periodicUpdateInterval);
  }
  
  periodicUpdateInterval = setInterval(() => {
    if (!appState.isConnected) {
      // 模擬資料更新
      const updates = [];
      
      appState.channelData.forEach((data, channelNum) => {
        const updatedData = {
          ...data,
          voltage: Math.max(2.5, Math.min(4.5, data.voltage + (Math.random() - 0.5) * 0.01)),
          current: Math.max(0, Math.min(2, data.current + (Math.random() - 0.5) * 0.02)),
          timestamp: new Date().toISOString()
        };
        appState.channelData.set(channelNum, updatedData);
        updates.push({ channelNum, data: updatedData });
      });
      
      // 使用批量更新
      if (updates.length > 0) {
        DOMUpdater.scheduleUpdate('periodic-update', () => {
          updates.forEach(({ channelNum, data }) => updateChannelCard(channelNum, data));
          updateSummaryInfo();
        });
      }
    }
  }, 2000);
  
  // 管理定時器參考
  timers.add(periodicUpdateInterval);
}

/**
 * Control panel functions
 */
window.startOperation = () => {
  console.log('Starting operation...');
  updateSystemStatus('運行中');
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ command: 'start' }));
  }
};

window.stopOperation = () => {
  console.log('Stopping operation...');
  updateSystemStatus('停止');
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ command: 'stop' }));
  }
};

window.generateReport = () => {
  console.log('Generating report...');
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ command: 'report' }));
  }
  generateLocalReport();
};

/**
 * Generate local CSV report
 */
function generateLocalReport() {
  const csvData = ['Channel,Voltage(V),Current(A),Power(W),Status'];
  
  appState.channelData.forEach((data, channelNum) => {
    const power = (data.voltage * data.current).toFixed(3);
    csvData.push(`CH${channelNum.toString().padStart(2, '0')},${data.voltage.toFixed(3)},${data.current.toFixed(3)},${power},${data.status}`);
  });
  
  const blob = new Blob([csvData.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `battery_report_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Settings page functions
 */
function saveSettings() {
  const form = document.querySelector('.settings-form');
  if (!form) return;
  
  const formData = new FormData(form);
  const settings = Object.fromEntries(formData);
  
  // Update app state
  Object.assign(appState.settings, settings);
  
  console.log('Settings saved:', appState.settings);
  
  // Send to backend if connected
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ 
      command: 'updateSettings', 
      data: appState.settings 
    }));
  }
  
  // Show feedback
  const saveButton = document.querySelector('.save-button');
  if (saveButton) {
    const originalText = saveButton.textContent;
    saveButton.textContent = '已儲存';
    setTimeout(() => {
      saveButton.textContent = originalText;
    }, 2000);
  }
}

/**
 * Setup settings page event handlers
 */
function setupSettingsHandlers() {
  // Save button handler
  const saveButton = document.querySelector('.save-button');
  if (saveButton) {
    saveButton.addEventListener('click', saveSettings);
  }
  
  // Process button handlers
  document.querySelectorAll('.process-button:not(.save-button)').forEach((button, index) => {
    button.addEventListener('click', () => {
      console.log(`Process ${index + 1} selected`);
      // Add your process selection logic here
    });
  });
}

/**
 * 樹莓派優化的節流函數
 */
function throttle(func, limit) {
  let inThrottle;
  let lastResult;
  
  return function(...args) {
    if (!inThrottle) {
      lastResult = func.apply(this, args);
      inThrottle = true;
      const timeoutId = setTimeout(() => {
        inThrottle = false;
        timers.delete(timeoutId);
      }, limit);
      timers.add(timeoutId);
    }
    return lastResult;
  };
}

/**
 * 防抖函數用於高頻事件
 */
function debounce(func, wait) {
  let timeoutId;
  return function(...args) {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timers.delete(timeoutId);
    }
    timeoutId = setTimeout(() => {
      func.apply(this, args);
      timers.delete(timeoutId);
    }, wait);
    timers.add(timeoutId);
  };
}

/**
 * Setup settings handlers when page loads
 */
document.addEventListener('DOMContentLoaded', () => {
  setupSettingsHandlers();
});

/**
 * 全面的記憶體清理機制
 */
function cleanup() {
  // 清理 WebSocket 連線
  if (ws) {
    ws.close();
    ws = null;
  }
  
  // 清理 DOM 快取
  domCache.clear();
  
  // 清理所有定時器
  timers.forEach(timerId => {
    clearTimeout(timerId);
    clearInterval(timerId);
  });
  timers.clear();
  
  // 清理動畫幀請求
  if (appState.frameRequestId) {
    cancelAnimationFrame(appState.frameRequestId);
    appState.frameRequestId = null;
  }
  
  // 清理定期更新
  if (periodicUpdateInterval) {
    clearInterval(periodicUpdateInterval);
    periodicUpdateInterval = null;
  }
  
  // 清理應用狀態
  appState.channelData.clear();
  
  console.log('Cleanup completed');
}

/**
 * 頁面卸載時的清理
 */
window.addEventListener('beforeunload', cleanup);

/**
 * 處理頁面隱藏/顯示以節省資源
 */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // 頁面隱藏時停止更新
    if (periodicUpdateInterval) {
      clearInterval(periodicUpdateInterval);
    }
  } else {
    // 頁面顯示時重啟更新
    startPeriodicUpdates();
  }
});

/**
 * Export functions for global access
 */
window.showPage = showPage;
window.selectChannel = selectChannel;
