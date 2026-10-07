# Ozellar Inspection - VM Deployment Guide

This document outlines the architecture, file locations, and update procedures for the production deployment on the Linux VM.

## 📁 File Locations

- **Source Code (Monorepo):** `/opt/Ozellar-Inspection`
- **Backend Environment File:** `/opt/Ozellar-Inspection/backend/.env`
- **Frontend Live Files:** `/var/www/Ozellar_inspection`
- **Nginx Configuration:** `/etc/nginx/sites-available/Ozellar_inspection`
- **Systemd Backend Service:** `/etc/systemd/system/ozellar_inspection.service`

## ⚙️ Services & Architecture

### 1. Database (PostgreSQL)
- **Database Name:** `inspection`
- **User:** `ozellar_admin`
- **Host:** `localhost` (Port: 5432)

### 2. Backend (Azure Functions Node.js)
The backend runs continuously in the background using Linux's `systemd`. It automatically loads environment variables from the `.env` file.
- **Service Name:** `ozellar_inspection`
- **Local Port:** `7071`
- **Logs Command:** `sudo journalctl -u ozellar_inspection -f`
- **Restart Command:** `sudo systemctl restart ozellar_inspection`

### 3. Frontend & Web Server (Nginx)
Nginx handles incoming internet traffic. It serves the built React/Vite files directly and acts as a "Reverse Proxy" to forward `/api/` traffic to the backend service.
- **Current Domains:** `martrust.ozellar.com` (and `inspection.ozellar.com`)
- **Restart Command:** `sudo systemctl restart nginx`
- **Test Config Command:** `sudo nginx -t`

---

## 🔄 How to Update the Application

Whenever new code is merged to the `main` branch on GitHub, follow these steps on the VM to deploy the updates:

### Step 1: Pull and Build the Code
```bash
cd /opt/Ozellar-Inspection
git pull origin main

# Install dependencies and build shared, backend, and frontend
npm install
npm run build
```

### Step 2: Apply Backend Updates (If applicable)
If there were changes to the backend API or database schema:
```bash
# Apply any new database schema changes
sudo -u postgres psql -d inspection -f /opt/Ozellar-Inspection/db/schema.sql

# Restart the backend service to load new code
sudo systemctl restart ozellar_inspection
```

### Step 3: Apply Frontend Updates (If applicable)
If there were changes to the frontend UI:
```bash
# Copy the newly built frontend files to the Nginx live folder
sudo cp -r /opt/Ozellar-Inspection/frontend/dist/* /var/www/Ozellar_inspection/
```

*(No Nginx restart is required when updating frontend files).*

---

## 🛠️ Common Administrative Tasks

**Check Backend Status:**
```bash
sudo systemctl status ozellar_inspection
```

**Edit Environment Variables:**
```bash
sudo nano /opt/Ozellar-Inspection/backend/.env
# Always restart the backend service after saving changes!
sudo systemctl restart ozellar_inspection
```

**Edit Nginx Configuration:**
```bash
sudo nano /etc/nginx/sites-available/Ozellar_inspection
# Always test and restart Nginx after saving changes!
sudo nginx -t
sudo systemctl restart nginx
```
