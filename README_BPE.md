# BPE 電池監控系統

## 概述

本系統是一個完整的電池監控解決方案，包含TCP服務器、Web應用程式和前端界面。系統遵循後端規則，實現高效能、低資源消耗的物聯網應用。

## 系統架構

```
前端界面 (index.html) ↔ WebSocket ↔ Go Web服務器 ↔ TCP客戶端 ↔ TCP服務器 (API_TestTCP.exe)
```

## 主要組件

### 1. API_TestTCP.exe - TCP測試服務器
- **監聽位址**: 127.0.0.1:1688
- **功能**: 模擬電池監控設備，提供電池狀態數據
- **通訊協定**: 8位長度前綴 + JSON內容

### 2. BPE_Server.exe - 主Web應用程式
- **Web服務器埠**: 5177
- **WebSocket端點**: ws://localhost:5177/ws
- **功能**: 
  - 提供Web界面 (http://localhost:5177)
  - WebSocket即時通訊
  - TCP客戶端連接到測試服務器

## TCP通訊協定

### 指令格式
```
8位長度(16進位) + 指令內容
```

### 範例
- 發送: `0000000CChStatus_all` (12字節的"ChStatus_all")
- 回應: `0000016F{JSON內容}` (367字節的JSON資料)

### 支援指令

#### ChStatus_all
取得所有通道狀態
```json
{
  "V_totle": 59.85,
  "V_max": {"Ch": 3, "V": 4.01},
  "V_min": {"Ch": 4, "V": 3.97},
  "Finish_ch": 2,
  "Ch_INFO": [
    {"Ch": 1, "V": 4.00, "Status": "Run"},
    {"Ch": 2, "V": 3.99, "Status": "Run"},
    ...
  ]
}
```

#### ChStatus_xx (xx為通道號碼)
取得特定通道詳細資訊
```json
{
  "ch": 1,
  "V": 3.99,
  "I": 5.01,
  "P": 20.0,
  "Ah": 2.55,
  "Time": "17:35:57"
}
```

## 安裝與執行

### 編譯
```bash
# 編譯主程式
cd go
go build -o ../BPE_Server.exe .

# 編譯TCP測試服務器
cd api
go build -o ../../API_TestTCP.exe .
```

### 執行步驟

1. **啟動TCP測試服務器**:
   ```bash
   .\API_TestTCP.exe
   ```

2. **啟動主Web應用程式**:
   ```bash
   .\BPE_Server.exe
   ```

3. **訪問Web界面**:
   - 開啟瀏覽器訪問: http://localhost:5177

## 測試

### TCP通訊測試
使用Python測試腳本:
```bash
python test_tcp.py
```

### WebSocket測試
開啟 `test_websocket.html` 檔案進行WebSocket通訊測試。

## 檔案結構

```
BPE_UI/
├── go/
│   ├── main.go              # 主Web應用程式
│   ├── api/
│   │   └── API_TestTCP.go   # TCP測試服務器
│   ├── go.mod               # Go模組定義
│   └── go.sum               # 依賴鎖定檔案
├── index.html               # 主Web界面
├── css/                     # 樣式檔案
├── js/                      # JavaScript檔案
├── image/                   # 圖片資源
├── References/              # 參考JSON檔案
│   ├── ChStatus_all.json
│   └── ChStatus_xx.json
├── test_tcp.py              # TCP測試腳本
├── test_websocket.html      # WebSocket測試頁面
├── BPE_Server.exe           # 編譯後的主程式
└── API_TestTCP.exe          # 編譯後的TCP服務器
```

## 技術規格

- **Go版本**: 1.21+
- **依賴**: github.com/gorilla/websocket v1.5.1
- **作業系統**: Windows (樹莓派Linux版本需重新編譯)
- **記憶體使用**: 低記憶體佔用設計
- **並發**: 支援多個WebSocket連接

## 開發規範

本專案嚴格遵循 `rule/backend-rule.md` 中定義的後端開發規範:
- 單一執行檔部署
- 無外部執行期依賴
- 健壯的錯誤處理
- 自動重連機制
- 資源效率優化

## 狀態代碼

電池通道狀態:
- **Run**: 運行中
- **Finish**: 完成
- **Standby**: 待機
- **Alarm**: 警告
- **Off_line**: 離線
- **REV**: 反向

## 故障排除

### 常見問題

1. **TCP連接失敗**
   - 確認 `API_TestTCP.exe` 已啟動
   - 檢查防火牆設定

2. **WebSocket連接失敗**
   - 確認 `BPE_Server.exe` 已啟動
   - 檢查埠5177是否被佔用

3. **靜態檔案無法載入**
   - 確認所有檔案在正確位置
   - 檢查檔案權限

## 授權

請參閱 `LICENSE.md` 檔案。
