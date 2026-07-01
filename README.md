# PremierDD Task Flow

## Worker Subtask APIs

Worker execution flow এখন `subtask` route দিয়েই চলবে.

- `GET /worker/subtasks/:id`
- `POST /worker/subtasks/:id/start`
- `POST /worker/subtasks/:id/report`
- `PUT /worker/subtasks/:id/report`
- `GET /worker/subtasks/:id/inventory`
- `PATCH /worker/subtasks/:id/inventory/:inventoryId`

### Start Flow

```http
POST /worker/subtasks/:id/start
```

`multipart/form-data`:

- `beforePhoto`

Behavior:

- before photo required
- subtask status `pending -> in_progress`
- start photo saved in task report

### Report Submit

```http
POST /worker/subtasks/:id/report
```

`multipart/form-data`:

- `beforePhoto`
- `afterPhoto`
- `receipt`
- `note`
- `notes`
- `inventoryUsed`

### Report Update

```http
PUT /worker/subtasks/:id/report
```

`multipart/form-data`:

- `beforePhoto`
- `afterPhoto`
- `receipt`
- `note`
- `notes`
- `inventoryUsed`

### Inventory

```http
GET /worker/subtasks/:id/inventory
PATCH /worker/subtasks/:id/inventory/:inventoryId
```

Patch body:

```json
{
  "qtyUsed": 1,
  "reason": "Used for task work"
}
```

## Worker Main Task APIs

- `GET /worker/tasks`
- `GET /worker/tasks/:id`
- `POST /worker/tasks/:id/subtasks`

`GET /worker/tasks` dashboard-style grouped response দেয়:

- main task
- floors
- units
- subtasks

## Admin Main Task APIs

- `GET /admin/tasks`
- `GET /admin/tasks/:id/locations`
- `GET /admin/tasks/:id/subtasks`
- `POST /admin/tasks`
- `POST /admin/tasks/:id/assign`
- `POST /admin/tasks/:id/subtasks`
- `PUT /admin/tasks/:id/approval`

Manager main task create flow:

- create -> `in_active`
- admin approve -> `pending`

## Admin Subtask APIs

- `GET /admin/subtasks`
- `GET /admin/subtasks/:id`
- `PUT /admin/subtasks/:id/approval`
- `PUT /admin/subtasks/:id/report-review`

Review APIs support:

- `reviewDecision`
- `reviewDescription`
- `note`
- `file`
