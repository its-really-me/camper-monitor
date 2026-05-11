#!/usr/bin/env bash
# Camper Monitor — system installer
# Run from the cloned repo:  sudo bash scripts/install.sh
# Or without cloning first:  curl -fsSL https://raw.githubusercontent.com/its-really-me/camper-monitor/main/scripts/install.sh | sudo bash
set -euo pipefail

# ── colours ────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'
info()    { echo -e "${BLUE}▸${NC}  $*"; }
success() { echo -e "${GREEN}✓${NC}  $*"; }
warn()    { echo -e "${YELLOW}!${NC}  $*"; }
die()     { echo -e "${RED}✗${NC}  $*" >&2; exit 1; }
header()  { echo; echo -e "${BOLD}$*${NC}"; echo "────────────────────────────────────────"; }

# ── guards ─────────────────────────────────────────────────────────────────
[[ $EUID -ne 0 ]] && die "Run with sudo:  sudo bash scripts/install.sh"

REAL_USER="${SUDO_USER:-$USER}"
[[ "$REAL_USER" == "root" ]] && die "Run as a normal user with sudo, not as root directly."

REPO_URL="https://github.com/its-really-me/camper-monitor.git"
INSTALL_DIR="/opt/camper-monitor"
ARCH=$(uname -m)

# ── detect hardware ─────────────────────────────────────────────────────────
header "Camper Monitor — Installer"
if [[ "$ARCH" == "armv6l" ]]; then
    info "Hardware: Pi Zero W (ARMv6)"
    info "Display:  framebuffer via node-canvas (no browser needed)"
else
    info "Hardware: $ARCH"
    info "Display:  Chromium kiosk"
fi

# ── 1. system update ────────────────────────────────────────────────────────
header "1 / 5  System packages"
apt-get update -qq

# ── 2. Node.js 20 ───────────────────────────────────────────────────────────
NODE_MAJOR=$(node --version 2>/dev/null | grep -oP '(?<=v)\d+' || echo 0)
if [[ "$NODE_MAJOR" -lt 20 ]]; then
    info "Installing Node.js 20 via NodeSource..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi
success "Node.js $(node --version)"

# ── 3. system dependencies ──────────────────────────────────────────────────
header "2 / 5  System dependencies"

info "Bluetooth (JBD BMS reader)..."
apt-get install -y bluetooth bluez libbluetooth-dev build-essential
systemctl enable bluetooth
systemctl start bluetooth
setcap cap_net_raw+eip "$(which node)"    # BLE without running as root

info "Serial port (VE.Direct reader)..."
usermod -aG dialout "$REAL_USER"

if [[ "$ARCH" == "armv6l" ]]; then
    # Pi Zero W: framebuffer renderer — needs Cairo for node-canvas
    info "Canvas/framebuffer dependencies (this takes a few minutes on Pi Zero W)..."
    apt-get install -y libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev \
                       build-essential pkg-config fonts-dejavu-core
    # Add user to video group for /dev/fb0 access
    usermod -aG video "$REAL_USER"
    success "Framebuffer dependencies installed"
else
    # Pi Zero 2 W: X11 + Chromium kiosk
    info "Kiosk display (Chromium)..."
    apt-get install -y --no-install-recommends \
        xserver-xorg x11-xserver-utils xinit openbox chromium
    success "Chromium kiosk dependencies installed"
fi

# ── 4. clone / update ───────────────────────────────────────────────────────
header "3 / 5  Repository"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || echo "")"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

if [[ -f "$REPO_ROOT/package.json" ]] && grep -q "camper-monitor" "$REPO_ROOT/package.json" 2>/dev/null; then
    info "Already cloned at $REPO_ROOT — copying to $INSTALL_DIR..."
    if [[ "$REPO_ROOT" != "$INSTALL_DIR" ]]; then
        rsync -a --exclude=node_modules "$REPO_ROOT/" "$INSTALL_DIR/"
    fi
elif [[ -d "$INSTALL_DIR/.git" ]]; then
    info "Updating existing installation at $INSTALL_DIR..."
    git -C "$INSTALL_DIR" pull
else
    info "Cloning $REPO_URL → $INSTALL_DIR..."
    git clone "$REPO_URL" "$INSTALL_DIR"
fi

chown -R "$REAL_USER:$REAL_USER" "$INSTALL_DIR"
success "Repository ready at $INSTALL_DIR"

# ── 5. npm install ──────────────────────────────────────────────────────────
header "4 / 5  Node.js dependencies"

cd "$INSTALL_DIR"

# Install pure-JS workspace deps only. Native modules (noble, serialport, canvas)
# are compiled in configure.sh once we know which drivers the user needs,
# so only the required native packages are ever compiled.
info "Installing JavaScript dependencies (skipping native modules)..."
sudo -u "$REAL_USER" npm install \
    --workspace=packages/server \
    --workspace=packages/reader-battery \
    --workspace=packages/reader-solar \
    --workspace=packages/ui-fb \
    --omit=optional --cache /tmp/npm-cache --loglevel=error

success "Dependencies ready"

# ── 6. configure ────────────────────────────────────────────────────────────
header "5 / 5  Configuration"
bash "$INSTALL_DIR/scripts/configure.sh"
