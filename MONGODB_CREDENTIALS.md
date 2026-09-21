# MongoDB Atlas Connection Setup

## What Credentials You Need

To connect to MongoDB Atlas, you need to provide the following information in your `.env` file:

### 1. **MONGODB_URI** (Connection String)
Format:
```
MONGODB_URI=mongodb+srv://username:password@cluster-name.mongodb.net/database-name?retryWrites=true&w=majority
```

### Components:
- **username**: Your MongoDB Atlas database user (not your account email)
- **password**: The password for that database user (URL-encoded if it contains special characters)
- **cluster-name**: Your MongoDB Atlas cluster name (e.g., `makeup-cluster`)
- **database-name**: Name of your database (e.g., `makeup_bookings`)

## Step-by-Step Setup on MongoDB Atlas

### 1. Create MongoDB Atlas Account
- Go to: https://www.mongodb.com/cloud/atlas
- Sign up with your email
- Create a new project (e.g., "MakeUP By Mercy")

### 2. Create a Cluster
- Click "Create a Deployment"
- Choose **M0 (Free)** tier for testing
- Select your preferred region (close to your location for best performance)
- Click "Create"
- Wait 5-10 minutes for cluster to be ready

### 3. Create Database User
- In left sidebar: Click **"Database Access"**
- Click **"Add New Database User"**
- Enter:
  - **Username**: `makeup_admin` (or any name you prefer)
  - **Password**: Create a strong password (save this!)
  - **Built-in Role**: `readWrite` (for the specific database)
- Click "Add User"

### 4. Set Network Access
- In left sidebar: Click **"Network Access"**
- Click **"Add IP Address"**
- Select **"Allow Access from Anywhere"** (for development)
  - Or enter your specific IP address for production
- Click "Confirm"

### 5. Get Connection String
- Click **"Clusters"** in left sidebar
- Click **"Connect"** on your cluster
- Choose **"Drivers"**
- Copy the connection string
- Paste into `.env` file as `MONGODB_URI`
- Replace:
  - `<password>` with your database user password
  - `<username>` with your database username (not email)
  - `myFirstDatabase` with your database name (e.g., `makeup_bookings`)

### Example .env Configuration:
```env
MONGODB_URI=mongodb+srv://makeup_admin:MySecurePassword123@makeup-cluster.rndmf.mongodb.net/makeup_bookings?retryWrites=true&w=majority
EMAIL_USER=your_email@gmail.com
EMAIL_PASSWORD=your_app_password
OWNER_EMAIL=owner@email.com
PORT=3000
NODE_ENV=production
```

## Verification Steps

### 1. Test Connection Locally
```bash
node -e "
const mongoose = require('mongoose');
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('Connection failed:', err));
" 2>&1
```

### 2. Check Server Logs
When your server starts, you should see:
```json
{"timestamp":"2026-09-21T...", "level":"INFO", "message":"Connected to MongoDB Atlas"}
```

### 3. MongoDB Atlas Dashboard
- Go to Clusters > Collections
- You should see your database and `bookings` collection
- Each booking will appear as a document

## Troubleshooting Connection Issues

### Issue: "Authentication failed"
- **Fix**: Check username/password spelling
- **Fix**: Ensure password is URL-encoded (e.g., `@` becomes `%40`)

### Issue: "Not authorized to access database"
- **Fix**: Ensure database user has read/write permissions
- **Fix**: Check database name in connection string

### Issue: "No servers available in topology"
- **Fix**: Ensure cluster IP is in Network Access whitelist
- **Fix**: Check if cluster is running (green status in Atlas dashboard)

### Issue: "Connection timeout"
- **Fix**: Ensure firewall allows outbound connections to MongoDB (port 27017)
- **Fix**: Check if MongoDB Atlas cluster is active

## Security Best Practices

1. **Never commit credentials** to git - use `.env` file
2. **Use strong passwords** (mix of upper, lower, numbers, special chars)
3. **Limit network access** - use your IP address instead of "Allow from Anywhere" in production
4. **Rotate passwords** regularly
5. **Use separate users** for different applications
6. **Enable IP whitelist** - only allow known IPs

## Production Considerations

- Upgrade to **M10 or higher** tier (paid)
- Enable **backup** options
- Use **dedicated cluster** for production
- Set up **monitoring and alerts**
- Use **connection pooling** (Node.js handles this)
- Implement **indexes** on frequently queried fields

## Support

- MongoDB Atlas Docs: https://docs.atlas.mongodb.com/
- Connection String Format: https://docs.mongodb.com/manual/reference/connection-string/
- Help & Support: https://www.mongodb.com/support/
