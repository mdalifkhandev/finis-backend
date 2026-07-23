-- Add 'revision' status to TaskStatus enum
-- Used when admin/manager rejects a subtask report - worker needs to resubmit

ALTER TYPE "TaskStatus" ADD VALUE IF NOT EXISTS 'revision' AFTER 'review';
