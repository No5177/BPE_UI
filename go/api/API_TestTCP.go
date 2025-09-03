package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"strconv"
	"time"
)

const (
	TCPServerHost = "127.0.0.1"
	TCPServerPort = 1688
)

// 模擬電池狀態資料
type BatteryChannelInfo struct {
	Ch     int     `json:"Ch"`
	V      float64 `json:"V"`
	Status string  `json:"Status"`
}

type BatteryStatusAll struct {
	VTotal   float64                `json:"V_totle"`
	VMax     map[string]interface{} `json:"V_max"`
	VMin     map[string]interface{} `json:"V_min"`
	FinishCh int                    `json:"Finish_ch"`
	ChInfo   []BatteryChannelInfo   `json:"Ch_INFO"`
}

type BatteryChannelDetail struct {
	Ch   int     `json:"ch"`
	V    float64 `json:"V"`
	I    float64 `json:"I"`
	P    float64 `json:"P"`
	Ah   float64 `json:"Ah"`
	Time string  `json:"Time"`
}

// TCP伺服器結構
type TCPServer struct {
	listener net.Listener
}

// 建立新的TCP伺服器
func NewTCPServer() *TCPServer {
	return &TCPServer{}
}

// 啟動TCP伺服器
func (s *TCPServer) Start() error {
	addr := fmt.Sprintf("%s:%d", TCPServerHost, TCPServerPort)

	listener, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("無法啟動TCP伺服器: %v", err)
	}

	s.listener = listener
	log.Printf("TCP伺服器已啟動，監聽位址: %s", addr)

	// 接受連線的迴圈
	for {
		conn, err := listener.Accept()
		if err != nil {
			log.Printf("接受連線錯誤: %v", err)
			continue
		}

		log.Printf("新的TCP連線來自: %s", conn.RemoteAddr())

		// 為每個連線建立獨立的goroutine處理
		go s.handleConnection(conn)
	}
}

// 處理TCP連線
func (s *TCPServer) handleConnection(conn net.Conn) {
	defer conn.Close()

	for {
		// 讀取8位元組的長度資訊
		lengthBytes := make([]byte, 8)
		_, err := io.ReadFull(conn, lengthBytes)
		if err != nil {
			if err != io.EOF {
				log.Printf("讀取長度資訊錯誤: %v", err)
			}
			break
		}

		// 解析長度（16進位）
		lengthStr := string(lengthBytes)
		contentLength, err := strconv.ParseInt(lengthStr, 16, 64)
		if err != nil {
			log.Printf("解析長度錯誤: %v", err)
			break
		}

		// 讀取指定長度的內容
		contentBytes := make([]byte, contentLength)
		_, err = io.ReadFull(conn, contentBytes)
		if err != nil {
			log.Printf("讀取內容錯誤: %v", err)
			break
		}

		command := string(contentBytes)
		log.Printf("收到TCP指令: %s (長度: %d)", command, contentLength)

		// 處理指令並產生回應
		response := s.processCommand(command)

		// 準備回應資料
		responseBytes := []byte(response)
		responseLengthHex := fmt.Sprintf("%08X", len(responseBytes))

		// 發送回應（8位長度 + 內容）
		fullResponse := responseLengthHex + response

		_, err = conn.Write([]byte(fullResponse))
		if err != nil {
			log.Printf("發送回應錯誤: %v", err)
			break
		}

		log.Printf("發送回應: %s (總長度: %d)", fullResponse, len(fullResponse))
	}

	log.Printf("TCP連線已關閉: %s", conn.RemoteAddr())
}

// 處理指令並產生適當的JSON回應
func (s *TCPServer) processCommand(command string) string {
	switch command {
	case "ChStatus_all":
		// 回傳所有通道狀態
		statusAll := BatteryStatusAll{
			VTotal: 59.85,
			VMax: map[string]interface{}{
				"Ch": 3,
				"V":  4.01,
			},
			VMin: map[string]interface{}{
				"Ch": 4,
				"V":  3.97,
			},
			FinishCh: 2,
			ChInfo: []BatteryChannelInfo{
				{Ch: 1, V: 4.00, Status: "Run"},
				{Ch: 2, V: 3.99, Status: "Run"},
				{Ch: 3, V: 4.01, Status: "Finish"},
				{Ch: 4, V: 3.97, Status: "Finish"},
				{Ch: 5, V: 0.00, Status: "Standby"},
				{Ch: 6, V: 3.98, Status: "Alarm"},
				{Ch: 7, V: 0.00, Status: "Off_line"},
				{Ch: 8, V: 3.99, Status: "REV"},
			},
		}

		jsonBytes, err := json.Marshal(statusAll)
		if err != nil {
			log.Printf("JSON序列化錯誤: %v", err)
			return `{"error": "JSON序列化失敗"}`
		}
		return string(jsonBytes)

	default:
		// 如果指令格式是 ChStatus_xx（其中xx是數字）
		if len(command) >= 10 && command[:9] == "ChStatus_" {
			channelStr := command[9:]
			if channelNum, err := strconv.Atoi(channelStr); err == nil && channelNum >= 1 && channelNum <= 8 {
				// 回傳特定通道詳細資訊
				detail := BatteryChannelDetail{
					Ch:   channelNum,
					V:    3.99,
					I:    5.01,
					P:    20.0,
					Ah:   2.55,
					Time: time.Now().Format("15:04:05"),
				}

				jsonBytes, err := json.Marshal(detail)
				if err != nil {
					log.Printf("JSON序列化錯誤: %v", err)
					return `{"error": "JSON序列化失敗"}`
				}
				return string(jsonBytes)
			}
		}

		// 未知指令
		log.Printf("未知指令: %s", command)
		return fmt.Sprintf(`{"error": "未知指令: %s"}`, command)
	}
}

// 停止TCP伺服器
func (s *TCPServer) Stop() error {
	if s.listener != nil {
		return s.listener.Close()
	}
	return nil
}

func main() {
	server := NewTCPServer()

	log.Println("啟動BPE TCP測試伺服器...")

	if err := server.Start(); err != nil {
		log.Fatal("TCP伺服器啟動失敗:", err)
	}
}
