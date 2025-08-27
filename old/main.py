import random
import time

def generate_channel_data():
    """為 48 個通道產生隨機電壓和電流數據。"""
    channels_data = []
    for i in range(1, 49):  # ch1 到 ch48
        channel_id = f"ch{i}"
        voltage = round(random.uniform(3.000, 4.200), 3)
        current = round(random.uniform(0.001, 1.000), 3)
        channels_data.append({
            "id": channel_id,
            "voltage": voltage,
            "current": current
        })
    return channels_data

def main():
    print("開始產生模擬數據... 每 15 秒更新一次。")
    print("按下 Ctrl+C 來停止程式。")
    try:
        while True:
            data = generate_channel_data()
            print(f"\n--- {time.strftime('%Y-%m-%d %H:%M:%S')} ---")
            for channel in data:
                print(f"{channel['id']}: 電壓 = {channel['voltage']:.3f} V, 電流 = {channel['current']:.3f} A")
            time.sleep(15)
    except KeyboardInterrupt:
        print("\n程式已停止。")

if __name__ == "__main__":
    main() 