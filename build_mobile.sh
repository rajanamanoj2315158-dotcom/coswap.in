#!/bin/bash
echo "🚀 Building High-Performance Web Assets..."
rm -rf www
mkdir -p www
# Copy all production assets intelligently
cp *.html *.css *.js *.png manifest.json sw.js www/ || true
echo "⚡ Copying into Android & iOS Native Packages..."
npx cap sync android
npx cap sync ios
echo "✅ Mobile Platform Compilation Ready! Open Xcode or Android Studio to visualize."
