import subprocess

dmg_path = "/Users/pastorello/Documents/pessoal/hermes-ide/dist/Hermes IDE-1.0.0-arm64.dmg"
icon_path = "/Users/pastorello/Documents/pessoal/hermes-ide/build/icon.icns"

# Use Python to set file icon via macOS APIs
script = f'''
use framework "AppKit"
set img to current application's NSImage's alloc()'s initWithContentsOfFile:"{icon_path}"
current application's NSWorkspace's sharedWorkspace()'s setIcon:img forFile:"{dmg_path}" options:0
'''

result = subprocess.run(['osascript', '-e', script], capture_output=True, text=True)
print(result.stdout)
if result.stderr:
    print("Error:", result.stderr)
