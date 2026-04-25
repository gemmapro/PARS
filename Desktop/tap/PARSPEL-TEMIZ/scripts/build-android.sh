#!/bin/bash
# Task 3.4 & 15.2: Android build pipeline
# Kullanım: ./scripts/build-android.sh [dev|prod]

set -e

MODE=${1:-dev}
echo "🔨 Android build başlatılıyor — mod: $MODE"

# 1. Web build
echo "📦 Web uygulaması derleniyor..."
npm run build

# 2. Capacitor sync
if [ "$MODE" = "prod" ]; then
  echo "🔄 Capacitor sync (production)..."
  npx cap sync --config capacitor.config.prod.json
else
  echo "🔄 Capacitor sync (development)..."
  npx cap sync
fi

# 3. Android build
echo "🤖 Android APK derleniyor..."
if [ "$MODE" = "prod" ]; then
  cd android && ./gradlew assembleRelease
  echo "✅ Release APK: android/app/build/outputs/apk/release/app-release.apk"
else
  cd android && ./gradlew assembleDebug
  echo "✅ Debug APK: android/app/build/outputs/apk/debug/app-debug.apk"
fi
