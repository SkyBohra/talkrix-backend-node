# Environment Configuration for Talkrix Backend

This backend uses environment-specific configuration files to manage secrets and settings for different deployment stages.

## Environment Files

- `.env.local` — For local development
- `.env.staging` — For staging environment
- `.env.production` — For production environment

Each file should contain the required environment variables, for example:

```
DB_HOST=your-db-host
DB_PORT=your-db-port
DB_USER=your-db-user
DB_PASS=your-db-password
JWT_SECRET=your-jwt-secret
```

## How It Works

The backend automatically loads the correct `.env` file based on the `APP_ENV` (or `NODE_ENV`) environment variable.

- `APP_ENV=local` → loads `.env.local`
- `APP_ENV=staging` → loads `.env.staging`
- `APP_ENV=production` → loads `.env.production`

If `APP_ENV` is not set, it defaults to `local`.

## Usage

Set the environment variable before starting the backend:

```
APP_ENV=staging npm run start
```

Or for production:

```
APP_ENV=production npm run start
```

For local development (default):

```
APP_ENV=local npm run start
```

## Security

- **Never commit real secrets or production credentials to version control.**
- Use example values or keep sensitive files out of your repository.

## Required Environment Variables

```
# Database
MONGO_URI=mongodb://localhost:27017/talkrix

# JWT Authentication
JWT_SECRET=your-jwt-secret

# Talkrix API (uses Ultravox as underlying service)
ULTRAVOX_API_KEY=your-ultravox-api-key

# Webhooks (for call event notifications)
WEBHOOK_BASE_URL=https://your-domain.com  # Your backend's public URL (e.g., https://api.talkrix.com)
TALKRIX_WEBHOOK_SECRET=your-webhook-secret  # Optional: Secret for webhook signature verification
```

### Webhook Configuration

When `WEBHOOK_BASE_URL` is set, the backend will automatically create webhooks for each agent. These webhooks receive call events (`call.ended`, `call.billed`) and update call history automatically.

Example:
- If `WEBHOOK_BASE_URL=https://api.talkrix.com`, webhooks will be created pointing to `https://api.talkrix.com/webhook/talkrix`

For local development with ngrok:
```
WEBHOOK_BASE_URL=https://abc123.ngrok.io
```

---

For any questions, see the main project README or contact the maintainer.
