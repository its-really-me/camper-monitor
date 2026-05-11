#!/usr/bin/env bash
# Camper Monitor — configuration wizard
# Can be re-run at any time to update settings:  sudo bash scripts/configure.sh
set -euo pipefail

# ── colours ────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'
info()    { echo -e "${BLUE}▸${NC}  $*"; }
success() { echo -e "${GREEN}✓${NC}  $*"; }
warn()    { echo -e "${YELLOW}!${NC}  $*"; }
ask()     { echo -e "${YELLOW}?${NC}  $*"; }
header()  { echo; echo -e "${BOLD}$*${NC}"; echo "────────────────────────────────────────"; }

[[ $EUID -ne 0 ]] && { echo "Run with sudo:  sudo bash scripts/configure.sh"; exit 1; }

REAL_USER="${SUDO_USER:-$USER}"
REAL_HOME=$(eval echo "~$REAL_USER")
INSTALL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ARCH=$(uname -m)

header "Camper Monitor — Configuration"
echo "  Install dir : $INSTALL_DIR"
echo "  User        : $REAL_USER"
if [[ "$ARCH" == "armv6l" ]]; then
    echo "  Display     : framebuffer (Pi Zero W)"
else
    echo "  Display     : Chromium kiosk (Pi Zero 2 W)"
fi

# ── battery ─────────────────────────────────────────────────────────────────
header "Battery  (Eco-worthy JBD BMS)"

ask "Driver — ble or mock (default: ble):"
read -r BATTERY_DRIVER
BATTERY_DRIVER="${BATTERY_DRIVER:-ble}"

BATTERY_MAC=""
if [[ "$BATTERY_DRIVER" == "ble" ]]; then
    ask "BLE MAC address  (e.g. AA:BB:CC:DD:EE:FF):"
    read -r BATTERY_MAC
    if ! [[ "$BATTERY_MAC" =~ ^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$ ]]; then
        echo "  Warning: '$BATTERY_MAC' doesn't look like a MAC address — continuing anyway."
    fi
fi

# ── solar ────────────────────────────────────────────────────────────────────
header "Solar Charger  (Victron SmartSolar 75/15)"

ask "Driver — vedirect, ble, or mock (default: vedirect):"
read -r SOLAR_DRIVER
SOLAR_DRIVER="${SOLAR_DRIVER:-vedirect}"

SOLAR_PORT="/dev/ttyUSB0"
SOLAR_MAC=""
SOLAR_KEY=""

case "$SOLAR_DRIVER" in
    vedirect)
        ask "Serial port (default: /dev/ttyUSB0):"
        read -r _port
        SOLAR_PORT="${_port:-/dev/ttyUSB0}"
        ;;
    ble)
        ask "SmartSolar BLE MAC address  (e.g. AA:BB:CC:DD:EE:FF):"
        read -r SOLAR_MAC
        ask "Advertisement key  (32-char hex from VictronConnect → Product info):"
        read -r SOLAR_KEY
        if [[ ${#SOLAR_KEY} -ne 32 ]]; then
            echo "  Warning: key is ${#SOLAR_KEY} chars, expected 32 — continuing anyway."
        fi
        ;;
    mock)
        info "Mock driver selected — no hardware required."
        ;;
esac

# ── server port ──────────────────────────────────────────────────────────────
header "Server"

ask "HTTP port (default: 3000):"
read -r SERVER_PORT
SERVER_PORT="${SERVER_PORT:-3000}"

# ── write settings.yaml ──────────────────────────────────────────────────────
header "Writing config files"

info "settings.yaml..."
cat > "$INSTALL_DIR/settings.yaml" << EOF
readers:
  battery:
    driver: $BATTERY_DRIVER
    macAddress: "$BATTERY_MAC"
    pollInterval: 5000

  solar:
    driver: $SOLAR_DRIVER
    port: $SOLAR_PORT
    macAddress: "$SOLAR_MAC"
    advertisementKey: "$SOLAR_KEY"
    pollInterval: 2000

server:
  port: $SERVER_PORT
EOF
success "settings.yaml"

# ── write .env ───────────────────────────────────────────────────────────────
info ".env..."
cat > "$INSTALL_DIR/.env" << 'EOF'
# Uncomment to override settings.yaml at runtime:
# BATTERY_DRIVER=mock
# SOLAR_DRIVER=mock
# SOLAR_PORT=/dev/ttyUSB1
# PORT=3000
EOF
success ".env"

# ── systemd: camper-monitor (shared) ─────────────────────────────────────────
info "systemd: camper-monitor.service..."
cat > /etc/systemd/system/camper-monitor.service << EOF
[Unit]
Description=Camper Monitor
After=bluetooth.target
Wants=network.target

[Service]
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/node packages/server/src/index.js
Restart=always
RestartSec=5
User=$REAL_USER
EnvironmentFile=$INSTALL_DIR/.env
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable camper-monitor
success "camper-monitor.service"

# ── display setup — split by architecture ────────────────────────────────────
if [[ "$ARCH" == "armv6l" ]]; then

    header "Display"

    ask "Touch device path (default: /dev/input/event0):"
    read -r _touch
    TOUCH_DEVICE="${_touch:-/dev/input/event0}"

    ask "Screen blank timeout in minutes — 0 to disable (default: 3):"
    read -r _blank
    BLANK_TIMEOUT="${_blank:-3}"

    # Pi Zero W: framebuffer renderer — no X11, no browser
    info "systemd: ui-fb.service  (framebuffer renderer)..."
    cat > /etc/systemd/system/ui-fb.service << EOF
[Unit]
Description=Camper Monitor Framebuffer UI
After=camper-monitor.service

[Service]
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/node packages/ui-fb/src/index.js
Restart=always
RestartSec=5
User=$REAL_USER
Environment=PORT=$SERVER_PORT
Environment=TOUCH_DEVICE=$TOUCH_DEVICE
Environment=BLANK_TIMEOUT=$BLANK_TIMEOUT
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
    systemctl enable ui-fb
    success "ui-fb.service enabled"

    info "sudoers: framebuffer blank permission..."
    echo "$REAL_USER ALL=(root) NOPASSWD: /usr/bin/tee /sys/class/graphics/fb0/blank" \
        > /etc/sudoers.d/camper-monitor-blank
    chmod 440 /etc/sudoers.d/camper-monitor-blank
    success "sudoers rule added"

else

    # Pi Zero 2 W: X11 + Chromium kiosk
    ask "Screen blank timeout in minutes — 0 to disable (default: 3):"
    read -r _blank
    BLANK_TIMEOUT="${_blank:-3}"

    info "$REAL_HOME/.xinitrc..."
    if [[ "$BLANK_TIMEOUT" -gt 0 ]]; then
        BLANK_SECS=$(( BLANK_TIMEOUT * 60 ))
        XSET_BLANK="xset s $BLANK_SECS $BLANK_SECS
xset dpms 0 0 $BLANK_SECS"
    else
        XSET_BLANK="xset s off
xset -dpms
xset s noblank"
    fi
    cat > "$REAL_HOME/.xinitrc" << EOF
#!/bin/sh
$XSET_BLANK
openbox &
sleep 2
mkdir -p /tmp/firefox-kiosk
firefox-esr --kiosk --no-remote --profile /tmp/firefox-kiosk http://localhost:$SERVER_PORT
EOF
    chmod +x "$REAL_HOME/.xinitrc"
    chown "$REAL_USER:$REAL_USER" "$REAL_HOME/.xinitrc"
    success ".xinitrc"

    info "Adding $REAL_USER to tty group..."
    usermod -aG tty "$REAL_USER"

    info "systemd: kiosk.service  (Firefox ESR)..."
    cat > /etc/systemd/system/kiosk.service << EOF
[Unit]
Description=Kiosk
After=camper-monitor.service systemd-logind.service
Requires=systemd-logind.service

[Service]
User=$REAL_USER
PAMName=login
TTYPath=/dev/tty7
StandardInput=tty
StandardOutput=journal
StandardError=journal
Environment=DISPLAY=:0
ExecStartPre=-/bin/rm -f /tmp/.X0-lock
ExecStart=/usr/bin/startx -- vt7
Restart=always
RestartSec=5
StartLimitIntervalSec=60
StartLimitBurst=3

[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
    systemctl enable kiosk
    success "kiosk.service enabled"

    # Clean up getty autologin drop-in if present from a previous install
    rm -f /etc/systemd/system/getty@tty7.service.d/autologin.conf
    rmdir /etc/systemd/system/getty@tty7.service.d 2>/dev/null || true
    systemctl daemon-reload

fi

# ── install native modules for chosen drivers ────────────────────────────────
header "Native modules"

NATIVE_PKGS=()
[[ "$BATTERY_DRIVER" == "ble" ]]      && NATIVE_PKGS+=(@abandonware/noble)
[[ "$SOLAR_DRIVER"   == "ble" ]]      && NATIVE_PKGS+=(@abandonware/noble)
[[ "$SOLAR_DRIVER"   == "vedirect" ]] && NATIVE_PKGS+=(serialport)
[[ "$ARCH"           == "armv6l" ]]   && NATIVE_PKGS+=(canvas)

# Deduplicate (noble may appear twice if both drivers use BLE)
NATIVE_PKGS=($(printf '%s\n' "${NATIVE_PKGS[@]}" | sort -u))

if [[ ${#NATIVE_PKGS[@]} -eq 0 ]]; then
    info "All drivers are mock — no native modules needed."
else
    info "Installing native modules for selected drivers: ${NATIVE_PKGS[*]}"
    if [[ "$ARCH" == "armv6l" ]]; then
        warn "ARMv6: compiling from source — this takes several minutes, please be patient..."
    fi
    cd "$INSTALL_DIR"
    # Remove all node_modules (root + nested) to avoid ENOTEMPTY rename
    # conflicts when npm updates transitive deps on top of a partial install.
    # Pure-JS packages are already in /tmp/npm-cache so this is fast.
    info "Clearing node_modules for clean install..."
    find "$INSTALL_DIR" -name node_modules -type d -prune -exec rm -rf {} +
    sudo -u "$REAL_USER" npm install \
        --workspace=packages/server \
        --workspace=packages/reader-battery \
        --workspace=packages/reader-solar \
        --workspace=packages/ui-fb \
        --omit=optional --cache /tmp/npm-cache --loglevel=error
    if sudo -u "$REAL_USER" npm install --no-save --omit=optional "${NATIVE_PKGS[@]}" \
            --cache /tmp/npm-cache --loglevel=error; then
        success "Native modules ready"
    else
        warn "Native module installation failed — services are configured but hardware drivers may not work."
        warn "Re-run this script once the issue is resolved."
    fi
fi

# ── web UI build (Pi Zero 2 W only) ─────────────────────────────────────────
if [[ "$ARCH" != "armv6l" ]]; then
    header "Web UI"
    info "Building web UI (this takes a minute)..."
    if sudo -u "$REAL_USER" npm run build:ui; then
        success "Web UI built"
    else
        warn "Web UI build failed — Firefox ESR will show a blank page."
        warn "Re-run this script or: sudo -u $REAL_USER npm run build:ui"
    fi
fi

# ── done ─────────────────────────────────────────────────────────────────────
echo
echo -e "${GREEN}${BOLD}All done.${NC}"
echo

if [[ "$ARCH" == "armv6l" ]]; then
    echo "  Start now  :  sudo systemctl start camper-monitor ui-fb"
    echo "  Or reboot  :  sudo reboot"
    echo
    echo "  Logs       :  sudo journalctl -u camper-monitor -f"
    echo "                sudo journalctl -u ui-fb -f"
else
    echo "  Start now  :  sudo systemctl start camper-monitor kiosk"
    echo "  Or reboot  :  sudo reboot"
    echo
    echo "  Logs       :  sudo journalctl -u camper-monitor -f"
    echo "                sudo journalctl -u kiosk -f"
fi

echo "  Re-run     :  sudo bash $INSTALL_DIR/scripts/configure.sh"
echo
