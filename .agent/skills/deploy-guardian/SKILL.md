---
name: deploy-guardian
description: Deploys the Millennium Guardian safety script to the remote server and starts it via PM2. Use this when the Guardian needs to be updated or restored.
---

# Deploy Guardian Skill

## Goal
Safely push the local `guardian.js` file to the remote Hostinger server and ensure the PM2 process is running.

## Instructions
1. **Find Artifact:** Locate `guardian.js` in the workspace root.
2. **Push to Server:** Use SCP to upload the file:
   `scp -i ~/.ssh/id_ed25519_millennium ./guardian.js root@72.62.129.174:/root/guardian.js`
3. **Verify & Start:**
   - SSH into `72.62.129.174`.
   - Run `pm2 start /root/guardian.js --name Millennium-Guardian`.
   - Run `pm2 save` to ensure persistence.
4. **Health Check:** Run `pm2 logs Millennium-Guardian --lines 5` and report the baseline balance to the user.

## Constraints
- Do NOT overwrite files in the `AutoArb_ARB` or `AutoArb_Base` folders.
- Always use the `root` user for this specific deployment.