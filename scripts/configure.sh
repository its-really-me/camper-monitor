#!/usr/bin/env bash
# Camper Monitor — configuration wizard
# Can be re-run at any time to update settings:  sudo bash scripts/configure.sh
set -euo pipefail

# ── colours ────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'
info()    { echo -e "${BLUE}▸${NC}  $*"; }
success() { echo -e "${GREEN}✓${NC}  $*"; }
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

# ── display setup — split by architecture ────────────────────────────────────
if [[ "$ARCH" == "armv6l" ]]; then

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
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
    systemctl enable camper-monitor ui-fb
    success "Services enabled: camper-monitor, ui-fb"

else

    # Pi Zero 2 W: X11 + Chromium kiosk
    info "$REAL_HOME/.xinitrc..."
    cat > "$REAL_HOME/.xinitrc" << EOF
#!/bin/sh
xset s off
xset -dpms
xset s noblank
openbox &
sleep 2
chromium --kiosk --noerrdialogs --disable-infobars --no-first-run --app=http://localhost:$SERVER_PORT
EOF
    chmod +x "$REAL_HOME/.xinitrc"
    chown "$REAL_USER:$REAL_USER" "$REAL_HOME/.xinitrc"
    success ".xinitrc"

    info "systemd: kiosk.service  (Chromium)..."
    cat > /etc/systemd/system/kiosk.service << EOF
[Unit]
Description=Kiosk
After=camper-monitor.service graphical.target

[Service]
User=$REAL_USER
Environment=DISPLAY=:0
ExecStart=/usr/bin/startx
Restart=always
RestartSec=3

[Install]
WantedBy=graphical.target
EOF
    systemctl daemon-reload
    systemctl enable camper-monitor kiosk
    success "Services enabled: camper-monitor, kiosk"

fi

# ── systemd: camper-monitor (shared) ─────────────────────────────────────────
info "systemd: camper-monitor.service..."
cat > /etc/systemd/system/camper-monitor.service << EOF
[Unit]
Description=Camper Monitor
After=network.target bluetooth.target

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
