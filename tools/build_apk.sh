#!/usr/bin/env bash
# 自用 Android debug APK 一键构建（仅适配 ubuntu-24.04 runner / Linux 本机）。
# 产物：apps/flutter/app/build/app/outputs/flutter-apk/app-arm64-v8a-debug.apk
set -euo pipefail
cd "$(dirname "$0")/.."

# 复用 runner 预装的 JDK17 / Node / Python / Rust / Android SDK，不再联网下载。
# GitHub releases 的大文件直链会 504，原脚本把预装 JDK 删掉再重新下载，是主要失败源。
# 本机 Linux 自行构建时，需先装好 openjdk-17-jdk、Android SDK、rustup、Dart。
export JAVA_HOME="${JAVA_HOME_17_X64:-/usr/lib/jvm/java-17-openjdk-amd64}"
export PATH="$JAVA_HOME/bin:$HOME/.pub-cache/bin:$PATH"
export PYTHONUTF8=1 PYTHONIOENCODING=utf-8 RUSTFLAGS=-Awarnings
export ANDROID_HOME="${ANDROID_HOME:-/usr/local/lib/android/sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"

# 1. 编译工具 + libclang 21（bindgen / V8 源码构建需要）
sudo apt-get update -qq
sudo apt-get install -y -qq bison build-essential bzip2 ca-certificates curl diffutils flex \
  gawk gzip patch pkg-config tar unzip xz-utils libssl-dev
wget -qO- https://apt.llvm.org/llvm-snapshot.gpg.key | sudo tee /etc/apt/trusted.gpg.d/apt.llvm.org.asc >/dev/null
echo "deb http://apt.llvm.org/noble/ llvm-toolchain-noble-21 main" | sudo tee /etc/apt/sources.list.d/llvm21.list
sudo apt-get update -qq
sudo apt-get install -y -qq llvm-21-dev libclang-21-dev lld-21
sudo ln -sf /usr/lib/llvm-21/lib/libclang.so /usr/lib/libclang.so
sudo ln -sf /usr/lib/llvm-21/lib/libclang.so /usr/lib/libclang.so.1
# V8 脚本按 libclang.so.<主版本> 判断版本；apt 包只有 libclang.so.1，补一个 21 软链
sudo ln -sf libclang.so /usr/lib/llvm-21/lib/libclang.so.21

# 2. NDK：Gradle 用 28.2.13676358；终端运行时（bash/busybox/proot）用 r29-beta4
SDKM="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
yes | "$SDKM" --licenses >/dev/null || true
"$SDKM" --install "ndk;28.2.13676358" >/dev/null
export ANDROID_NDK_HOME="$ANDROID_HOME/ndk/28.2.13676358"
bash tools/android-runtime/fetch_ndk_wsl.sh

# 3. Rust 与 Flutter SDK（版本写死，自用不做版本兼容）
rustup toolchain install 1.95.0 --profile minimal --target aarch64-linux-android
rustup default 1.95.0
dart pub global activate fvm 4.3.0
(cd apps/flutter/app && fvm install --skip-pub-get)

# 4. 仓库脚本要求的本地环境
python3 -m venv .venv
corepack enable
(cd plugins/packages/buildin/workflow && corepack pnpm install --frozen-lockfile)
npm install --prefix .ci-tools/typescript --no-audit --no-fund typescript@5.9.3
# pubspec 里有 gitee 的 git 依赖，放宽低速断流判定
git config --global http.postBuffer 524288000
git config --global http.lowSpeedLimit 0
git config --global http.lowSpeedTime 999999
git config --global core.compression 0

# 5. 终端运行时：4 个源码包已随仓库提交（SHA256 与原脚本一致），不再联网下载
R=tools/android-runtime
mkdir -p "$R/sources"
for archive in busybox-1.38.0.tar.bz2 termux-proot-v5.1.107.78.tar.gz \
               talloc-2.4.3.tar.gz bash-5.2.37.tar.gz; do
    tar -xf "$R/downloads/$archive" -C "$R/sources"
done
NDK29="$HOME/.cache/operit-android-runtime/android-ndk-r29-beta4"
ANDROID_NDK_HOME="$NDK29" bash tools/android-runtime/build_android_tools_wsl.sh
ANDROID_NDK_HOME="$NDK29" bash tools/android-runtime/build_alpine_rootfs_wsl.sh

# 6. 插件资源 → 生成 .g.dart → 签名占位属性（Gradle 配置阶段强制读取，debug 不用）
.venv/bin/python plugins/tools/sync_plugin_packages.py --source runtime --no-hot-reload
cargo check --manifest-path core/crates/proxy/local/Cargo.toml
mkdir -p .tmp
keytool -genkeypair -noprompt -keystore .tmp/d.jks -storetype PKCS12 \
  -storepass android -keypass android -alias d -keyalg RSA -keysize 2048 -validity 1 -dname CN=debug
P=apps/flutter/app/android/local.properties
touch "$P"
cat >> "$P" <<EOF
RELEASE_STORE_FILE=$PWD/.tmp/d.jks
RELEASE_STORE_PASSWORD=android
RELEASE_KEY_ALIAS=d
RELEASE_KEY_PASSWORD=android
EOF

# 7. 出包（gitee 依赖断流时重试一次即可）
cd apps/flutter/app
fvm flutter pub get || fvm flutter pub get || fvm flutter pub get
fvm flutter build apk --debug --split-per-abi --target-platform android-arm64
