-- Add new location event types for attendance/geofence logging
ALTER TYPE "LocationEventType" ADD VALUE IF NOT EXISTS 'check_in';
ALTER TYPE "LocationEventType" ADD VALUE IF NOT EXISTS 'out_of_zone';
ALTER TYPE "LocationEventType" ADD VALUE IF NOT EXISTS 'check_out';
