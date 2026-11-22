import Foundation
import IOKit
import IOKit.hid

setbuf(__stdoutp, nil)

let scriptPath = "/Users/dgnmd/Documents/Projects/SPIA-v2/scripts/spia-control.sh"
var lastTriggerTime: TimeInterval = 0

func runControl(action: String) {
    let now = Date().timeIntervalSince1970
    if now - lastTriggerTime < 0.8 {
        return
    }
    lastTriggerTime = now
    print("[SPIA-Remote] Triggering: \(action)")

    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/bin/bash")
    process.arguments = [scriptPath, action]
    try? process.run()
}

let manager = IOHIDManagerCreate(kCFAllocatorDefault, IOOptionBits(kIOHIDOptionsTypeNone))

// Match ONLY the AB Shutter remote (Vendor ID 1284 / 0x0504)
let match: [String: Any] = [
    kIOHIDVendorIDKey as String: 1284
]
IOHIDManagerSetDeviceMatching(manager, match as CFDictionary)

let callback: IOHIDValueCallback = { context, result, sender, value in
    let element = IOHIDValueGetElement(value)
    let usagePage = IOHIDElementGetUsagePage(element)
    let usage = IOHIDElementGetUsage(element)
    let intVal = IOHIDValueGetIntegerValue(value)

    // Key down (intVal == 1) on Consumer Page (0x0C = 12)
    guard intVal == 1 else { return }

    if usagePage == 12 {
        // 0x00E9 (233) = Volume Up (iOS button)
        if usage == 233 {
            runControl(action: "start")
        }
        // 0x00EA (234) = Volume Down (Android button)
        else if usage == 234 {
            runControl(action: "stop")
        }
    }
    // Fallback if Android button reports Keyboard Return/Enter (UsagePage 7, Usage 40)
    else if usagePage == 7 && usage == 40 {
        runControl(action: "stop")
    }
}

IOHIDManagerRegisterInputValueCallback(manager, callback, nil)
IOHIDManagerScheduleWithRunLoop(manager, CFRunLoopGetCurrent(), CFRunLoopMode.defaultMode.rawValue)

// Seize device exclusively so macOS does not change speaker volume
let status = IOHIDManagerOpen(manager, IOOptionBits(kIOHIDOptionsTypeSeizeDevice))
if status != kIOReturnSuccess {
    // Fallback to non-exclusive if another process holds it
    _ = IOHIDManagerOpen(manager, IOOptionBits(kIOHIDOptionsTypeNone))
}

print("[SPIA-Remote] Native remote listener started. Matching VendorID 1284 exclusively.")
CFRunLoopRun()
