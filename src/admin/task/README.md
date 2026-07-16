# Task Module

This module handles task creation, assignment, task status updates, task reports, and task expense handling.

## Status Flow

- `manager` creates a task:
  - New task status becomes `in_active`
  - It is not treated as active yet
  - Can select multiple floors and multiple units while creating

- `admin` creates a task:
  - New task status becomes `pending`

- `in_active` tasks:
  - Can be moved to `pending`
  - Only `admin` and `super_admin` can do this
  - `manager` cannot activate an `in_active` task

- `pending` tasks:
  - Can move to `in_progress` after assignment or manual status update

## Role Rules

- `manager`
  - Can create tasks
  - Can assign workers
  - Can update tasks inside assigned projects
  - Cannot approve `in_active` tasks

- `admin`
  - Can create tasks
  - Can approve `in_active` tasks by moving them to `pending`
  - Can update tasks inside owned projects
  - Can update multi-floor and multi-unit selections

- `super_admin`
  - Can approve any task
  - Can move `in_active` tasks to `pending`

## Important Notes

- `active` means `pending` in the current task workflow.
- `in_active` means the task exists, but it is not yet approved/activated.
- `manager`-created tasks start as `in_active`.
- `admin`-created tasks start as `pending`.

## API Endpoints

- `GET /admin/tasks`
- `GET /admin/tasks/:id`
- `GET /admin/tasks/:id/subtasks`
- `GET /admin/subtasks`
- `GET /admin/subtasks/:id`
- `POST /admin/tasks`
- `POST /admin/tasks/:id/assign`
- `GET /admin/tasks/:id/available-workers`
- `PUT /admin/tasks/:id/status`
- `PUT /admin/tasks/:id`
- `PUT /admin/tasks/:id/reports/:reportId/review`
- `DELETE /admin/tasks/:id`

## Multi Select

- Task create/update supports one main task with multiple floors and multiple units.
- Use `floorIds` for floors.
- Subtasks are optional and can only be created when `allowSubTaskCreation` is enabled on the main task.
- Use `unitId` for one unit or `unitIds` for multiple units in the same task.
- Legacy single `floorId` and `unitId` still work.
- `POST /admin/tasks/:id/assign` body can use `workerId` for single assign or `workerIds` for multiple assign.
- `GET /admin/subtasks/:id` is the subtask details API.

```json
{
  "workerId": "worker-user-id"
}
```

```json
{
  "workerIds": ["worker-user-id-1", "worker-user-id-2"]
}
```

## Example Status Update

Approve an `in_active` task:

```http
PUT /admin/tasks/:id/status
```

```json
{
  "status": "pending"
}
```

## Behavior Summary

- `manager` creates task → `in_active`
- `admin` reviews task → `pending`
- `super_admin` can approve any task
- `manager` cannot make an `in_active` task active
