package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"sync"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
)

// 靜態檔案目錄路徑
const staticDir = "../"

// Application configuration
const (
	DefaultPort     = 5177 // 修改為5177埠
	WebSocketPath   = "/ws"
	TCPServerAddr   = "127.0.0.1:1688" // 修改為本地TCP伺服器位址
	ReadTimeout     = 30 * time.Second
	WriteTimeout    = 30 * time.Second
	ShutdownTimeout = 10 * time.Second
)

// WebSocket upgrader configuration
var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		// Allow connections from any origin for local development
		// In production, implement proper origin checking
		return true
	},
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
}

// Channel data structure matching the frontend expectations
type ChannelData struct {
	Voltage   float64 `json:"voltage"`
	Current   float64 `json:"current"`
	Status    string  `json:"status"`
	Timestamp string  `json:"timestamp"`
}

// WebSocket message structure
type WebSocketMessage struct {
	Type     string                  `json:"type"`
	Channels map[string]*ChannelData `json:"channels,omitempty"`
	Command  string                  `json:"command,omitempty"`
	Data     interface{}             `json:"data,omitempty"`
}

// Contact form data structure
type ContactForm struct {
	Name    string `json:"name"`
	Email   string `json:"email"`
	Phone   string `json:"phone"`
	Company string `json:"company"`
	Subject string `json:"subject"`
	Message string `json:"message"`
}

// WebSocket hub for managing connections
type Hub struct {
	clients    map[*websocket.Conn]bool
	broadcast  chan []byte
	register   chan *websocket.Conn
	unregister chan *websocket.Conn
	mutex      sync.RWMutex
}

// Application server
type Server struct {
	hub       *Hub
	tcpConn   net.Conn
	tcpMutex  sync.RWMutex
	channels  map[string]*ChannelData
	dataMutex sync.RWMutex
}

// Create new hub
func newHub() *Hub {
	return &Hub{
		clients:    make(map[*websocket.Conn]bool),
		broadcast:  make(chan []byte, 256),
		register:   make(chan *websocket.Conn),
		unregister: make(chan *websocket.Conn),
	}
}

// Run the WebSocket hub
func (h *Hub) run() {
	for {
		select {
		case client := <-h.register:
			h.mutex.Lock()
			h.clients[client] = true
			h.mutex.Unlock()
			log.Printf("WebSocket client connected. Total clients: %d", len(h.clients))

		case client := <-h.unregister:
			h.mutex.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				client.Close()
			}
			h.mutex.Unlock()
			log.Printf("WebSocket client disconnected. Total clients: %d", len(h.clients))

		case message := <-h.broadcast:
			h.mutex.RLock()
			for client := range h.clients {
				err := client.WriteMessage(websocket.TextMessage, message)
				if err != nil {
					delete(h.clients, client)
					client.Close()
				}
			}
			h.mutex.RUnlock()
		}
	}
}

// Create new server
func newServer() *Server {
	hub := newHub()
	server := &Server{
		hub:      hub,
		channels: make(map[string]*ChannelData),
	}

	// Initialize demo channel data
	server.initializeChannelData()

	return server
}

// Initialize demo channel data
func (s *Server) initializeChannelData() {
	s.dataMutex.Lock()
	defer s.dataMutex.Unlock()

	for i := 1; i <= 24; i++ {
		channelID := fmt.Sprintf("%02d", i)
		s.channels[channelID] = &ChannelData{
			Voltage:   3.789 + float64(i%5)*0.1,
			Current:   0.5 + float64(i%3)*0.2,
			Status:    "normal",
			Timestamp: time.Now().Format(time.RFC3339),
		}
	}
}

// Start TCP client connection to Python server
func (s *Server) connectTCP() {
	for {
		conn, err := net.DialTimeout("tcp", TCPServerAddr, 5*time.Second)
		if err != nil {
			log.Printf("Failed to connect to TCP server: %v. Retrying in 10s...", err)
			time.Sleep(10 * time.Second)
			continue
		}

		log.Printf("Connected to TCP server at %s", TCPServerAddr)
		s.tcpMutex.Lock()
		s.tcpConn = conn
		s.tcpMutex.Unlock()

		// Start reading from TCP connection
		go s.readTCPData()

		// Wait for connection to close
		<-time.After(time.Second)
		for s.tcpConn != nil {
			time.Sleep(time.Second)
		}

		log.Println("TCP connection lost, attempting to reconnect...")
	}
}

// Read data from TCP connection using 8-byte length + content format
func (s *Server) readTCPData() {
	defer func() {
		s.tcpMutex.Lock()
		if s.tcpConn != nil {
			s.tcpConn.Close()
			s.tcpConn = nil
		}
		s.tcpMutex.Unlock()
	}()

	for {
		s.tcpMutex.RLock()
		conn := s.tcpConn
		s.tcpMutex.RUnlock()

		if conn == nil {
			break
		}

		conn.SetReadDeadline(time.Now().Add(30 * time.Second))

		// 讀取8位元組的長度資訊
		lengthBytes := make([]byte, 8)
		_, err := io.ReadFull(conn, lengthBytes)
		if err != nil {
			if err != io.EOF {
				log.Printf("讀取TCP長度資訊錯誤: %v", err)
			}
			break
		}

		// 解析長度（16進位）
		lengthStr := string(lengthBytes)
		contentLength, err := strconv.ParseInt(lengthStr, 16, 64)
		if err != nil {
			log.Printf("解析TCP長度錯誤: %v", err)
			break
		}

		// 讀取指定長度的JSON內容
		contentBytes := make([]byte, contentLength)
		_, err = io.ReadFull(conn, contentBytes)
		if err != nil {
			log.Printf("讀取TCP內容錯誤: %v", err)
			break
		}

		log.Printf("收到TCP回應: %s (長度: %d)", string(contentBytes), contentLength)

		// 解析JSON資料
		var jsonData interface{}
		if err := json.Unmarshal(contentBytes, &jsonData); err != nil {
			log.Printf("解析JSON錯誤: %v", err)
			continue
		}

		// 處理接收到的資料並轉換為前端需要的格式
		s.processTCPResponse(contentBytes)
	}
}

// 處理TCP回應並更新通道資料
func (s *Server) processTCPResponse(jsonBytes []byte) {
	// 嘗試解析為全部狀態
	var statusAll map[string]interface{}
	if err := json.Unmarshal(jsonBytes, &statusAll); err != nil {
		log.Printf("解析TCP回應JSON錯誤: %v", err)
		return
	}

	// 檢查是否包含Ch_INFO，表示是全部通道狀態
	if chInfoRaw, exists := statusAll["Ch_INFO"]; exists {
		if chInfoArray, ok := chInfoRaw.([]interface{}); ok {
			s.dataMutex.Lock()
			for _, chInfoRaw := range chInfoArray {
				if chInfo, ok := chInfoRaw.(map[string]interface{}); ok {
					if chRaw, exists := chInfo["Ch"]; exists {
						if ch, ok := chRaw.(float64); ok {
							channelID := fmt.Sprintf("%02d", int(ch))

							voltage := 0.0
							if v, exists := chInfo["V"]; exists {
								if vFloat, ok := v.(float64); ok {
									voltage = vFloat
								}
							}

							status := "unknown"
							if s, exists := chInfo["Status"]; exists {
								if sStr, ok := s.(string); ok {
									status = sStr
								}
							}

							s.channels[channelID] = &ChannelData{
								Voltage:   voltage,
								Current:   0.0, // TCP資料中沒有電流資訊
								Status:    status,
								Timestamp: time.Now().Format(time.RFC3339),
							}
						}
					}
				}
			}
			s.dataMutex.Unlock()

			// 廣播到WebSocket客戶端
			s.dataMutex.RLock()
			channelsCopy := make(map[string]*ChannelData)
			for k, v := range s.channels {
				channelsCopy[k] = v
			}
			s.dataMutex.RUnlock()

			message := WebSocketMessage{
				Type:     "channelUpdate",
				Channels: channelsCopy,
			}

			if msgBytes, err := json.Marshal(message); err == nil {
				select {
				case s.hub.broadcast <- msgBytes:
				default:
					log.Println("WebSocket廣播通道已滿，跳過訊息")
				}
			}
		}
	} else {
		// 可能是單一通道詳細資訊
		if chRaw, exists := statusAll["ch"]; exists {
			if ch, ok := chRaw.(float64); ok {
				channelID := fmt.Sprintf("%02d", int(ch))

				s.dataMutex.Lock()
				if existingChannel, exists := s.channels[channelID]; exists {
					// 更新現有通道的詳細資訊
					if v, exists := statusAll["V"]; exists {
						if vFloat, ok := v.(float64); ok {
							existingChannel.Voltage = vFloat
						}
					}
					if i, exists := statusAll["I"]; exists {
						if iFloat, ok := i.(float64); ok {
							existingChannel.Current = iFloat
						}
					}
					existingChannel.Timestamp = time.Now().Format(time.RFC3339)
				}
				s.dataMutex.Unlock()
			}
		}
	}
}

// Send command to TCP server using 8-byte length + content format
func (s *Server) sendTCPCommand(command string) error {
	s.tcpMutex.RLock()
	conn := s.tcpConn
	s.tcpMutex.RUnlock()

	if conn == nil {
		return fmt.Errorf("TCP connection not available")
	}

	// 準備命令資料（8位長度 + 內容格式）
	commandBytes := []byte(command)
	lengthHex := fmt.Sprintf("%08X", len(commandBytes))
	fullCommand := lengthHex + command

	conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	_, err := conn.Write([]byte(fullCommand))
	if err != nil {
		return fmt.Errorf("發送TCP命令失敗: %v", err)
	}

	log.Printf("發送TCP命令: %s (總長度: %d)", fullCommand, len(fullCommand))
	return nil
}

// Handle WebSocket connections
func (s *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}

	// Register client
	s.hub.register <- conn

	// Send initial channel data
	s.dataMutex.RLock()
	initialData := make(map[string]*ChannelData)
	for k, v := range s.channels {
		initialData[k] = v
	}
	s.dataMutex.RUnlock()

	initialMessage := WebSocketMessage{
		Type:     "channelUpdate",
		Channels: initialData,
	}

	if msgBytes, err := json.Marshal(initialMessage); err == nil {
		conn.WriteMessage(websocket.TextMessage, msgBytes)
	}

	// Handle incoming messages
	go func() {
		defer func() {
			s.hub.unregister <- conn
		}()

		for {
			var message WebSocketMessage
			if err := conn.ReadJSON(&message); err != nil {
				if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
					log.Printf("WebSocket error: %v", err)
				}
				break
			}

			// Handle commands
			if message.Command != "" {
				log.Printf("Received command: %s", message.Command)
				if err := s.sendTCPCommand(message.Command); err != nil {
					log.Printf("Failed to send TCP command: %v", err)
				}
			}
		}
	}()
}

// Handle contact form submission
func (s *Server) handleContact(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var form ContactForm
	if err := json.NewDecoder(r.Body).Decode(&form); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	// Log contact form submission (in production, save to database)
	log.Printf("Contact form submission: %+v", form)

	// Respond with success
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}

// Setup HTTP routes
func (s *Server) setupRoutes() *http.ServeMux {
	mux := http.NewServeMux()

	// WebSocket endpoint
	mux.HandleFunc(WebSocketPath, s.handleWebSocket)

	// Contact form API
	mux.HandleFunc("/api/contact", s.handleContact)

	// 使用普通檔案系統提供靜態檔案
	fileServer := http.FileServer(http.Dir(staticDir))
	mux.Handle("/", fileServer)

	return mux
}

// Start the HTTP server
func (s *Server) start(port int) {
	// Start WebSocket hub
	go s.hub.run()

	// Start TCP client (non-blocking)
	go s.connectTCP()

	// Start demo data generator for development
	go s.generateDemoData()

	// Setup HTTP server
	mux := s.setupRoutes()

	server := &http.Server{
		Addr:         fmt.Sprintf(":%d", port),
		Handler:      mux,
		ReadTimeout:  ReadTimeout,
		WriteTimeout: WriteTimeout,
	}

	// Graceful shutdown handling
	go func() {
		sigChan := make(chan os.Signal, 1)
		signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
		<-sigChan

		log.Println("Shutting down server...")

		ctx, cancel := context.WithTimeout(context.Background(), ShutdownTimeout)
		defer cancel()

		if err := server.Shutdown(ctx); err != nil {
			log.Printf("Server shutdown error: %v", err)
		}
	}()

	log.Printf("ThinkPower Battery Monitor server starting on port %d", port)
	log.Printf("Dashboard: http://localhost:%d/", port)
	log.Printf("Contact: http://localhost:%d/contact.html", port)
	log.Printf("WebSocket: ws://localhost:%d%s", port, WebSocketPath)

	if err := server.ListenAndServe(); err != http.ErrServerClosed {
		log.Fatal("Server failed to start:", err)
	}

	log.Println("Server stopped")
}

// Generate demo data for development/testing
func (s *Server) generateDemoData() {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		// Only generate demo data if no TCP connection is available
		s.tcpMutex.RLock()
		hasTCP := s.tcpConn != nil
		s.tcpMutex.RUnlock()

		if hasTCP {
			continue
		}

		// Update channel data with simulated values
		s.dataMutex.Lock()
		updatedChannels := make(map[string]*ChannelData)

		for channelID, data := range s.channels {
			// Small random variations
			voltageChange := (float64(time.Now().UnixNano()%200) - 100) / 10000.0 // ±0.01V
			currentChange := (float64(time.Now().UnixNano()%100) - 50) / 1000.0   // ±0.05A

			newVoltage := data.Voltage + voltageChange
			if newVoltage < 2.5 {
				newVoltage = 2.5
			}
			if newVoltage > 4.5 {
				newVoltage = 4.5
			}

			newCurrent := data.Current + currentChange
			if newCurrent < 0 {
				newCurrent = 0
			}
			if newCurrent > 2.0 {
				newCurrent = 2.0
			}

			updatedData := &ChannelData{
				Voltage:   newVoltage,
				Current:   newCurrent,
				Status:    data.Status,
				Timestamp: time.Now().Format(time.RFC3339),
			}

			s.channels[channelID] = updatedData
			updatedChannels[channelID] = updatedData
		}
		s.dataMutex.Unlock()

		// Broadcast to WebSocket clients
		message := WebSocketMessage{
			Type:     "channelUpdate",
			Channels: updatedChannels,
		}

		if msgBytes, err := json.Marshal(message); err == nil {
			select {
			case s.hub.broadcast <- msgBytes:
			default:
				// Channel full, skip this update
			}
		}
	}
}

func main() {
	// Get port from environment or use default (5177)
	port := DefaultPort
	if portStr := os.Getenv("PORT"); portStr != "" {
		if p, err := strconv.Atoi(portStr); err == nil {
			port = p
		}
	}

	// Create and start server
	server := newServer()
	server.start(port)
}
