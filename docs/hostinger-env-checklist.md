# Hostinger environment checklist

Configure these values in hPanel's Node.js application environment settings. Do not put credentials in the deployment archive.

## Realtime transport

- Set backend `SOCKET_TRANSPORTS=polling` on Hostinger Business web hosting or Cloud hosting. These plans do not accept inbound WebSocket connections.
- Set frontend `VITE_SOCKET_TRANSPORTS=polling` for the same deployment.
- Use `polling,websocket` for both values only on a VPS that accepts inbound WebSocket connections.
- If unset, the backend defaults to `polling,websocket` and the frontend defaults to `polling`.

## Required backend settings

- `NODE_ENV=production`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEY`
- `OTP_HMAC_SECRET` (at least 32 characters)
- `FRONTEND_ORIGIN` using HTTPS

Set other integration variables only when those integrations are enabled. See [Hostinger backend deployment](./hostinger_deploy.md) and [backend/.env.example](../backend/.env.example) for the full list.
