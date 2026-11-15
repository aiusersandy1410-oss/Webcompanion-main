# Web Companion: frontend

Static site. No build step. Deploy it on Render as a Static Site.

1. Set apiBase in config.js to your backend URL, for example https://web-companion-api.onrender.com
2. Push this folder to GitHub. In Render: New > Static Site, or New > Blueprint using render.yaml.
3. Note the frontend URL. Set FRONTEND_ORIGIN to this exact address (no trailing slash) on the backend.

The app runs without the backend. If the server is unreachable, data keeps saving on the device and syncs when the connection returns.

Repair: Profile > Account, sync and repair > Check and repair local data. If the page hits an error, it reloads once automatically. If errors continue, a banner appears with a Repair button.
