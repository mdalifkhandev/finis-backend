# Messaging Module

This module handles direct chat, support chat, notifications, and websocket delivery.

## Roles

- `super_admin`
  - Keeps the existing support-chat behavior.
  - Can send support messages as before.

- `admin`
  - Can message `manager` and `worker`.
  - Can start direct chats with `manager` and `worker`.
  - Search shows `manager` and `worker`.

- `manager`
  - Can message `admin` and `worker`.
  - Can start direct chats with `admin` and `worker`.
  - Search shows `admin` and `worker`.

- `worker`
  - Can message `manager`.
  - Can reply in an existing admin-to-worker thread.
  - Cannot start a new direct chat with `admin`.
  - Cannot block users.
  - Search shows only `manager`.
  - Existing direct chat threads with `admin` remain visible if the admin already started the conversation.

## REST Endpoints

- `GET /messages/contacts?search=`
- `GET /messages/threads/chat`
- `POST /messages/threads/direct`
- `GET /messages/threads/support`
- `POST /messages/support/thread`
- `GET /messages/threads/:threadId/messages`
- `POST /messages/send`
- `POST /messages/upload`

## Super Admin Endpoints

- `GET /messages/admin/support/threads`
- `GET /messages/admin/support/threads/:threadId/messages`
- `POST /messages/admin/support/thread`
- `POST /messages/admin/support/send`
- `PATCH /messages/admin/support/threads/:threadId/close`
- `GET /messages/admin/support/threads/:threadId/export`
- `GET /messages/admin/chat/threads`
- `GET /messages/admin/chat/threads/:threadId/messages`

## WebSocket Namespace

- Namespace: `/chat`
- Events:
  - `message:send`
  - `message:new`
  - `thread:updated`
  - `thread:join`
  - `thread:leave`
  - `message:typing`
  - `message:read`
  - `support:thread:new`

## Behavior Notes

- `super_admin` can only send messages in support threads.
- `worker` can only start chats with `manager`.
- `worker` can reply to an existing admin-created chat, but cannot initiate a new one with `admin`.
- Notifications are sent to unread thread participants after each message.

## Search Rules

- Search results for contacts follow role and project scope rules.
- `worker` contact search shows only `manager`.
- `worker` chat threads can still show an existing `admin` conversation if it was started by `admin` earlier.
- `super_admin` is excluded from regular direct chat search results.
