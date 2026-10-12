import AVFoundation

def get_macos_cameras() -> dict[int, str]:
    """Uses native AVFoundation via PyObjC to list video devices.
    Returns a dict mapping index -> camera name.
    """
    try:
        devices = AVFoundation.AVCaptureDevice.devicesWithMediaType_(AVFoundation.AVMediaTypeVideo)
        if not devices:
            return {0: "Camera 0"}
        cameras = {}
        for i, device in enumerate(devices):
            name = device.localizedName()
            if "Screen" not in name:
                cameras[i] = name
        
        if not cameras:
            cameras[0] = "Camera 0"
        return cameras
    except Exception:
        return {0: "Camera 0"}
