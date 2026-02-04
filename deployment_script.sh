#!/bin/bash

# --- CONFIGURATION ---
# If running script from inside the project folder, use "."
LOCAL_DIR="." 
REMOTE_TARGET="root@72.62.129.174:/root/Millennium-AutoArb/"

echo "🚀 Starting Millennium Deployment..."

# 1. Version Control
git add .
git commit -m "Deployment: $(date +'%Y-%m-%d %H:%M:%S')"
git push origin master
echo "✅ Changes committed to Git."

# 2. Sync Files
# The trailing slash on $LOCAL_DIR/ means "copy the contents of this folder"
echo "📦 Syncing files to Server..."
rsync -avz -e "ssh -i /c/Users/Test/.ssh/id_ed25519_millennium" --exclude 'node_modules' --exclude '.git' "$LOCAL_DIR/" "$REMOTE_TARGET"

# 3. Remote Execution
echo "🔄 Restarting Millennium Stack via PM2..."
ssh -i /c/Users/Test/.ssh/id_ed25519_millennium root@72.62.129.174 "cd /root/Millennium-AutoArb && pm2 restart all --update-env && pm2 save"

echo "✨ Deployment Complete! All systems green."