-- Add in_zone event for geofence re-entry logs
ALTER TYPE "LocationEventType" ADD VALUE IF NOT EXISTS 'in_zone';
