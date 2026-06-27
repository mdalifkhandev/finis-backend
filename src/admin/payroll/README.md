# Payroll Filters

Use the same filter shape for:
- `GET /admin/payroll/overview`
- `GET /admin/payroll/summary`

## Supported ranges

- `custom`
- `weekly`
- `bi-weekly`
- `monthly`
- `bi-monthly`
- `yearly`

## Query parameters

- `range`: one of the supported ranges
- `date`: reference date for `weekly`, `bi-weekly`, `monthly`, `bi-monthly`, `yearly`
- `startDate`: custom range start date
- `endDate`: custom range end date
- `month`: legacy month filter, still supported
- `year`: legacy year filter, still supported
- `projectId`: optional project filter for `/summary`

## Examples

### Custom

```http
GET /admin/payroll/summary?range=custom&startDate=2026-06-01&endDate=2026-06-27
```

### Weekly

```http
GET /admin/payroll/overview?range=weekly&date=2026-06-27
```

### Bi-weekly

```http
GET /admin/payroll/summary?range=bi-weekly&date=2026-06-27
```

### Monthly

```http
GET /admin/payroll/overview?range=monthly&date=2026-06-27
```

### Bi-monthly

```http
GET /admin/payroll/summary?range=bi-monthly&date=2026-06-27
```

### Yearly

```http
GET /admin/payroll/overview?range=yearly&date=2026-06-27
```
