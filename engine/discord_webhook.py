import requests
import traceback

def send_video(webhook_url, video_path, content="🚨 Motion Detected by SPIA!"):
    """Send an MP4 file to a Discord webhook."""
    if not webhook_url:
        return False
    try:
        with open(video_path, 'rb') as f:
            files = {
                'file': ('video.mp4', f, 'video/mp4')
            }
            data = {
                'content': content
            }
            resp = requests.post(webhook_url, files=files, data=data, timeout=30)
            if resp.status_code in [200, 204]:
                return True
            else:
                print(f"Discord Webhook Error: {resp.status_code} - {resp.text}")
                return False
    except Exception as e:
        print(f"Exception sending video to Discord: {e}")
        traceback.print_exc()
        return False

def test_connection(webhook_url):
    """Test if the Discord webhook URL is valid."""
    if not webhook_url:
        return False
    try:
        # Discord webhook URLs support GET requests to retrieve metadata
        resp = requests.get(webhook_url, timeout=10)
        return resp.status_code == 200
    except Exception as e:
        print(f"Exception testing Discord webhook: {e}")
        return False
