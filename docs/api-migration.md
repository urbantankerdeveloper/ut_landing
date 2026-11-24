# API base URL migration

The web and Flutter clients now target `https://api.urbantanker.in` by default. Web builds set `VITE_API_BASE_URL` to the origin (without `/api`); Flutter builds set `API_BASE_URL` to the API base (with `/api`). Socket.IO derives its origin from the same setting in each client.

For rollback, set web `VITE_API_BASE_URL=https://urban-tanker-backend.onrender.com` and rebuild, or build Flutter with `--dart-define=API_BASE_URL=https://urban-tanker-backend.onrender.com/api`.

## Update outside these repositories

- **Backend CORS and tracking links:** set `FRONTEND_ORIGIN=https://www.urbantanker.in` and include both `https://www.urbantanker.in` and `https://urbantanker.in` in `CORS_ORIGINS` (comma-separated if adding other origins). The backend uses `FRONTEND_ORIGIN` to generate public tracking links; keep those links on the website domain, not the API domain.
- **Razorpay:** change the webhook URL to `https://api.urbantanker.in/api/payment/razorpay/webhook`.
- **WhatsApp, SMS, and email providers:** update any configured callback, delivery-status, or webhook URL to the new API host and preserve the provider-specific path. Verify callbacks after changing the provider console.
- **Hostinger hPanel:** confirm the Node.js application for `api.urbantanker.in` is deployed and listening on the port supplied by hPanel. Keep SMTP/provider credentials in hPanel environment variables, never in source control.
