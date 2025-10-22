# TCGplayer PDF Parser Server

Python serverless function deployed on Vercel to parse TCGplayer Direct PDFs.

## 🚀 Quick Deploy to Vercel

### Step 1: Prerequisites
- GitHub account
- Vercel account (free, sign up at vercel.com)

### Step 2: Push to GitHub

```bash
cd /Users/mpwright/Discrep/pdf-parser-server

# Initialize git if not already done
git init

# Add files
git add .
git commit -m "Initial PDF parser server"

# Create a new GitHub repo and push
# (Follow GitHub's instructions to create repo)
git remote add origin https://github.com/YOUR_USERNAME/pdf-parser-server.git
git push -u origin main
```

### Step 3: Deploy to Vercel

1. Go to https://vercel.com
2. Click **"Add New"** → **"Project"**
3. Import your GitHub repository
4. Vercel will auto-detect settings
5. Click **"Deploy"**

**That's it!** You'll get a URL like:
```
https://pdf-parser-server.vercel.app
```

### Step 4: Update Google Apps Script

In your `AutoFillOrderInfo_Upload.gs`, update the API endpoint:

```javascript
const PDF_PARSER_URL = 'https://YOUR-PROJECT.vercel.app/api/parse';
```

## 🧪 Local Testing (Optional)

### Install Dependencies
```bash
cd pdf-parser-server
pip install -r requirements.txt
```

### Run Locally
```bash
# Install Vercel CLI
npm install -g vercel

# Run local dev server
vercel dev
```

Server runs at `http://localhost:3000`

### Test with curl
```bash
# Encode PDF to base64
base64 -i your-file.pdf -o encoded.txt

# Test API
curl -X POST http://localhost:3000/api/parse \
  -H "Content-Type: application/json" \
  -d '{"pdf": "BASE64_STRING_HERE"}'
```

## 📝 API Documentation

### Endpoint
```
POST /api/parse
```

### Request Body
```json
{
  "pdf": "base64_encoded_pdf_data"
}
```

### Response (Success)
```json
{
  "success": true,
  "totalOrders": 19,
  "orders": [
    {
      "orderNumber": "251012-48B7",
      "buyerName": "Josh Guevara",
      "cards": [
        {
          "name": "Esika, God of the Tree",
          "quantity": 1,
          "condition": "Lightly Played",
          "setName": "Kaldheim"
        }
      ],
      "startPos": 12345,
      "endPos": 23456
    }
  ]
}
```

### Response (Error)
```json
{
  "success": false,
  "error": "Error message here"
}
```

## 🔧 Troubleshooting

### Build Fails on Vercel
- Check that `requirements.txt` is in the root directory
- Ensure Python version is compatible (Vercel uses Python 3.9+)

### Timeout Errors
- Vercel free tier has 10s execution limit
- For large PDFs (>5MB), consider upgrading or optimizing

### CORS Issues
- The server already includes CORS headers
- If issues persist, check your Apps Script is making proper POST requests

## 📊 Limits (Vercel Free Tier)

- ✅ 100GB bandwidth/month
- ✅ 100 deployments/day
- ✅ Unlimited requests
- ⚠️ 10 second timeout per request
- ⚠️ 50MB file size limit

## 🔒 Security Notes

- PDFs are processed in-memory only
- No data is stored on the server
- All processing happens serverlessly
- Each request is isolated

## 📞 Support

If you encounter issues:
1. Check Vercel deployment logs
2. Test locally with `vercel dev`
3. Verify PDF is properly base64 encoded
4. Check Apps Script console for errors
