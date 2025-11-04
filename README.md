# ESX Assistant Audit Log Viewer

Web-based visualizer for ESX Assistant audit logs with token tracking, pricing, and analytics.

## Live Demo
🔗 **https://astankovic.github.io/esx-assistant-audit-log-viewer/**

## Features

- **4 Interactive Charts**: Separate tracking of input and output tokens (bar + cumulative line charts)
- **Token Analytics**: Split by direction (input/output from API perspective)
- **Flexible Pricing**: Configure model pricing with custom token units
- **Real-time Filtering**: Filter events by type, search content, show errors only
- **Session Management**: Support for multiple sessions in one log file
- **Mobile-Friendly**: Works on all modern browsers including mobile

## Usage

1. **Visit the live demo** at the link above
2. **Upload a `.jsonl` audit log file** using the "📁 Choose File" button
3. **View statistics, charts, and insights**
4. **Configure pricing** by clicking "Estimated Cost" to set your model's pricing
5. **Filter and search** events using the left sidebar

## Token Tracking

- **Input Tokens** (Blue): User messages + tool results → sent TO the API
- **Output Tokens** (Green): Assistant messages + tool calls → received FROM the API

All token counts are **API-reported** (no estimates).

## File Format

JSONL format with audit events from ESX Assistant CLI or Web Client:

```jsonl
{"eventType":"user_message","timestamp":"2025-01-01T12:00:00.000Z","sessionId":"session_123","data":{"direction":"input"}}
{"eventType":"assistant_message","timestamp":"2025-01-01T12:00:01.000Z","sessionId":"session_123","data":{"direction":"output"},"metadata":{"tokens":{"input":50,"output":120}}}
```

## Development

Run locally with a simple HTTP server:

```bash
python3 -m http.server 8000
# Visit http://localhost:8000
```

## Browser Support

✅ Chrome/Edge | ✅ Firefox | ✅ Safari | ✅ Mobile

## Related

Part of the ESX Assistant project for audit log analysis and visualization.
