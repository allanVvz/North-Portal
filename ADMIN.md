## Atualizacao administrativa

```bash
curl -X PATCH \
  "https://DOMINIO/api/admin/client/north" \
  -H "Authorization: Bearer $NORTH_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "brandUrl": "https://drive.google.com/...",
    "productsUrl": "https://drive.google.com/...",
    "uploadsUrl": "https://drive.google.com/...",
    "topMetrics": [
      { "label": "Leads", "value": "42", "variation": "+12%", "description": "Periodo atual" }
    ],
    "insights": [
      { "title": "Maior procura", "description": "Servico X concentrou os contatos." }
    ],
    "reportUrl": "https://...",
    "feedbackUrl": "https://..."
  }'
```
