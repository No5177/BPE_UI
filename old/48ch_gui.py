import tkinter as tk
from tkinter import ttk
import random
import time # 確保 time 模組已匯入

class BatteryMonitorApp:
    def __init__(self, root):
        self.root = root
        self.root.title("TPT-48Ch-CVC")
        self.root.geometry("1000x700")  # 您可以根據需要調整視窗大小
        self.root.configure(bg='#f0f0f0') # 設定背景色

        # --- ttk 風格 ---
        self.style = ttk.Style(self.root)
        self.style.configure("Channel.Default.TLabel", background="white", foreground="black", font=("Arial", 10))
        self.style.configure("Channel.Red.TLabel", background="red", foreground="white", font=("Arial", 10))
        self.style.configure("Channel.Yellow.TLabel", background="yellow", foreground="black", font=("Arial", 10))
        self.style.configure("Channel.LightBlue.TLabel", background="lightblue", foreground="black", font=("Arial", 10))
        self.style.configure("Channel.LightGreen.TLabel", background="lightgreen", foreground="black", font=("Arial", 10))

        # --- 用於儲存通道元件和數據 ---
        self.channel_labels = {}  # 格式: {channel_num: label_widget}
        self.channel_frames = {}  # 格式: {channel_num: frame_widget}
        self.channel_data = {}    # 格式: {channel_num: {"voltage": v, "current": c}}
        self.status_info_labels = {} # 格式: {"label_name": label_widget} for status panel

        # --- 主框架 ---
        self.main_frame = ttk.Frame(self.root, padding="10")
        self.main_frame.pack(fill=tk.BOTH, expand=True)

        # --- 通道框架 (左/中) ---
        self.channel_frame_container = ttk.Frame(self.main_frame)
        self.channel_frame_container.grid(row=0, column=0, sticky="nsew", padx=(0, 10))

        # --- 右側面板 (資訊 & 控制) ---
        self.right_frame = ttk.Frame(self.main_frame, width=300)
        self.right_frame.grid(row=0, column=1, sticky="ns", pady=5)
        self.right_frame.grid_propagate(False) # 防止框架因內容縮小

        # --- 底部框架 (摘要) ---
        self.bottom_frame = ttk.Frame(self.main_frame, height=100)
        self.bottom_frame.grid(row=1, column=0, columnspan=2, sticky="ew", padx=5, pady=(10, 0))

        # --- 設定網格權重 ---
        self.main_frame.columnconfigure(0, weight=3) # 通道框架佔用更多空間
        self.main_frame.columnconfigure(1, weight=1)
        self.main_frame.rowconfigure(0, weight=1)

        # --- 填入內容 ---
        self.channel_data = self._generate_channel_data() # 產生初始數據
        self.create_channel_grid() # 使用初始數據建立網格
        self.create_right_panel()
        self.create_bottom_panel()

        # --- 啟動定期更新 ---
        self.root.after(15000, self.update_data_periodically) # 15 秒後開始第一次更新

    def _calculate_aggregate_data(self):
        """計算總電壓和總電流。"""
        total_voltage = 0.0
        total_current = 0.0
        if self.channel_data:
            for data in self.channel_data.values():
                total_voltage += data.get("voltage", 0.0)
                total_current += data.get("current", 0.0)
        return {"total_voltage": total_voltage, "total_current": total_current}

    def _generate_channel_data(self):
        """為 48 個通道產生隨機電壓和電流數據。"""
        new_data = {}
        for i in range(1, 49):  # ch1 到 ch48
            voltage = round(random.uniform(3.000, 4.200), 3)
            current = round(random.uniform(0.001, 1.000), 3) # 電流已產生，但目前未在網格中顯示
            new_data[i] = { # 使用 channel_num (1-48) 作為鍵
                "voltage": voltage,
                "current": current
            }
        return new_data

    def _apply_channel_style(self, channel_num, voltage_val, data_frame, voltage_label):
        """根據電壓設定內部數據框架背景和電壓標籤樣式。"""
        applied_style = "Channel.Default.TLabel"
        frame_bg = 'white' # 預設框架背景

        if channel_num == 1:
            frame_bg = "red"
            applied_style = "Channel.Red.TLabel"
        elif channel_num == 9:
            frame_bg = "yellow"
            applied_style = "Channel.Yellow.TLabel"
        elif voltage_val < 3.100:
            frame_bg = "lightblue"
            applied_style = "Channel.LightBlue.TLabel"
        elif voltage_val > 4.150:
            frame_bg = "lightgreen"
            applied_style = "Channel.LightGreen.TLabel"
        
        data_frame.config(bg=frame_bg)
        voltage_label.configure(style=applied_style)

    def create_channel_grid(self):
        """建立 48 個電池通道的網格並顯示初始數據"""
        rows = 8
        cols = 6
        for i in range(48):
            channel_num = i + 1 # 通道編號從 1 開始
            grid_row = (channel_num - 1) // cols
            grid_col = (channel_num - 1) % cols
            
            voltage_data = self.channel_data.get(channel_num, {"voltage": 0.0, "current": 0.0})
            voltage = voltage_data["voltage"]
            voltage_str = f"{voltage:.3f} V"

            # 1. 建立外部容器框架
            outer_frame = tk.Frame(self.channel_frame_container)
            outer_frame.grid(row=grid_row, column=grid_col, padx=2, pady=2, sticky="nsew")
            # 設定外部框架的網格權重，讓通道號碼和數據框能正確分配空間
            outer_frame.columnconfigure(0, weight=0) # 通道號碼標籤 (固定寬度)
            outer_frame.columnconfigure(1, weight=1) # 內部數據框 (佔據剩餘空間)
            outer_frame.rowconfigure(0, weight=1)

            # 2. 建立通道編號標籤 (放置在外部框架的左側)
            channel_num_label = ttk.Label(outer_frame, text=f"{channel_num:02d}", font=("Arial", 9))
            channel_num_label.grid(row=0, column=0, sticky="nsw", padx=(2, 3), pady=2) 

            # 3. 建立內部數據框架 (用於顯示電壓和著色，放置在外部框架的右側)
            # 這個 data_frame 就是之前儲存在 self.channel_frames 中的 "frame"
            data_frame = tk.Frame(outer_frame, borderwidth=1, relief="groove")
            data_frame.grid(row=0, column=1, sticky="nsew")
            self.channel_frames[channel_num] = data_frame # 儲存內部數據框架
            
            # 4. 建立電壓標籤 (放置在內部數據框架中)
            # 這個 voltage_label 就是之前儲存在 self.channel_labels 中的 "label"
            voltage_label = ttk.Label(data_frame, text=voltage_str, anchor="center")
            voltage_label.pack(padx=5, pady=5, expand=True, fill=tk.BOTH) # 調整 pady 讓內容更緊湊
            self.channel_labels[channel_num] = voltage_label # 儲存電壓標籤

            # 套用初始樣式到內部數據框架和電壓標籤
            self._apply_channel_style(channel_num, voltage, data_frame, voltage_label)

            # 確保 self.channel_frame_container 的行列權重已設定 (通常在 __init__ 中完成一次即可)
            # 此處重複設定是為了確保，如果之前沒有，現在也會設定
            self.channel_frame_container.columnconfigure(grid_col, weight=1)
            self.channel_frame_container.rowconfigure(grid_row, weight=1)

    def create_right_panel(self):
        """建立右側的資訊和控制面板"""
        # 公司名稱
        company_label = ttk.Label(self.right_frame, text="ThinkPower", font=("Arial", 20, "bold"), foreground="#00529B", anchor="center")
        company_label.pack(pady=20)

        # 連接狀態
        connect_label = ttk.Label(self.right_frame, text="已連接", foreground="green", font=("Arial", 10, "bold"))
        connect_label.pack(anchor="ne", padx=10)


        # --- 資訊框架 ---
        info_frame = ttk.LabelFrame(self.right_frame, text=" 狀態訊息 ")
        info_frame.pack(fill=tk.X, padx=10, pady=15)

        # 計算初始的總電壓和電流
        initial_aggregates = self._calculate_aggregate_data()

        # 動態資訊
        dynamic_info = {
            "電池總壓:": f"{initial_aggregates['total_voltage']:.1f} V",
            "充電電流:": f"{initial_aggregates['total_current']:.3f} A"
        }

        for text, value_str in dynamic_info.items():
            row_frame = ttk.Frame(info_frame)
            ttk.Label(row_frame, text=text, width=15, anchor="w").pack(side=tk.LEFT, padx=5)
            value_label = ttk.Label(row_frame, text=value_str, anchor="e")
            value_label.pack(side=tk.RIGHT, padx=5)
            row_frame.pack(fill=tk.X, pady=3)
            self.status_info_labels[text] = value_label # 儲存數值標籤以供更新

        # 靜態資訊 (從您原始碼中提取，您可以按需調整)
        static_info_data = {
            "負載功率:": "0 W",
            "開始均衡電壓:": "3.400 V",
            "強制均衡電壓:": "3.600 V",
            "均衡單體壓差:": "0.002 V",
            "均衡溫度:": "25 °C"
        }

        for text, value in static_info_data.items():
            row_frame = ttk.Frame(info_frame)
            ttk.Label(row_frame, text=text, width=15, anchor="w").pack(side=tk.LEFT, padx=5)
            ttk.Label(row_frame, text=value, anchor="e").pack(side=tk.RIGHT, padx=5)
            row_frame.pack(fill=tk.X, pady=3)

        # --- 控制按鈕框架 ---
        control_frame = ttk.Frame(self.right_frame)
        control_frame.pack(pady=60) # 增加間距

        # 使用 tk.Button 以便更好地控制顏色和大小
        auto_button = tk.Button(control_frame, text="自動均衡",
                                bg="#4CAF50", fg="white", width=12, height=3,
                                font=("Arial", 12, "bold"), relief="raised", borderwidth=3)
        auto_button.pack(side=tk.LEFT, padx=10)

        force_button = tk.Button(control_frame, text="強制均衡",
                                 bg="#f44336", fg="white", width=12, height=3,
                                 font=("Arial", 12, "bold"), relief="raised", borderwidth=3)
        force_button.pack(side=tk.LEFT, padx=10)

    def create_bottom_panel(self):
        """建立底部的摘要資訊面板"""
        bottom_frame_inner = ttk.LabelFrame(self.bottom_frame, text=" 摘要 ")
        bottom_frame_inner.pack(fill=tk.BOTH, expand=True)

        bottom_info_data = [
            ("最高電壓:", "3.583 V"), ("最高電壓串:", "1"), ("開關狀態1:", "均衡開啟"),
            ("最低電壓:", "3.578 V"), ("最低電壓串:", "9"), ("開關狀態2:", "均衡關閉"),
            ("單體壓差:", "0.005 V"), ("有效電壓數:", "48"), ("均衡狀態:", "關閉")
        ]

        col_count = 0
        for text, value in bottom_info_data:
            label_text = f"{text} {value}"
            label = ttk.Label(bottom_frame_inner, text=label_text, font=("Arial", 9))
            # 安排成 3 列
            label.grid(row=col_count // 3, column=col_count % 3, padx=15, pady=3, sticky="w")
            col_count += 1

        # 設定底部框架的列權重，使其均勻分佈
        for i in range(3):
            bottom_frame_inner.columnconfigure(i, weight=1)

    def update_data_periodically(self):
        print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] update_data_periodically CALLED")
        """定期更新通道數據並刷新 GUI 顯示。"""
        self.channel_data = self._generate_channel_data() # 產生新數據

        # 更新通道網格顯示
        for channel_num in range(1, 49):
            data = self.channel_data.get(channel_num)
            if not data: continue

            voltage = data["voltage"]
            voltage_label = self.channel_labels.get(channel_num) # 這是電壓標籤
            data_frame = self.channel_frames.get(channel_num)   # 這是內部數據框架

            if voltage_label and data_frame:
                voltage_str = f"{voltage:.3f} V"
                voltage_label.config(text=voltage_str) # 更新電壓標籤文字
                # 使用 _apply_channel_style 更新 data_frame 的背景和 voltage_label 的樣式
                self._apply_channel_style(channel_num, voltage, data_frame, voltage_label)
        
        # 更新狀態訊息面板的總電壓和總電流
        current_aggregates = self._calculate_aggregate_data()
        if self.status_info_labels.get("電池總壓:"):
            self.status_info_labels["電池總壓:"].config(text=f"{current_aggregates['total_voltage']:.1f} V")
        if self.status_info_labels.get("充電電流:"):
            self.status_info_labels["充電電流:"].config(text=f"{current_aggregates['total_current']:.3f} A")

        # 排程下一次更新
        self.root.after(15000, self.update_data_periodically) # 15000 毫秒 = 15 秒

# --- 主程式 ---
if __name__ == "__main__":
    root = tk.Tk()
    app = BatteryMonitorApp(root)
    root.mainloop()