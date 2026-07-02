-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('super_admin', 'admin', 'manager', 'worker', 'viewer');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'inactive', 'suspended', 'pending');

-- CreateEnum
CREATE TYPE "ProjectType" AS ENUM ('residential', 'commercial', 'industrial', 'infrastructure', 'apartment', 'house');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('planning', 'active', 'on_hold', 'completed', 'cancelled', 'delayed');

-- CreateEnum
CREATE TYPE "FloorStatus" AS ENUM ('pending', 'in_progress', 'completed');

-- CreateEnum
CREATE TYPE "RoomStatus" AS ENUM ('pending', 'in_progress', 'completed');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('low', 'medium', 'high', 'critical');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('in_active', 'pending', 'in_progress', 'review', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "ReviewDecision" AS ENUM ('approved', 'rejected', 'pending');

-- CreateEnum
CREATE TYPE "PayrollStatus" AS ENUM ('draft', 'approved', 'paid');

-- CreateEnum
CREATE TYPE "PayrollMode" AS ENUM ('hourly', 'task_based');

-- CreateEnum
CREATE TYPE "PayrollPeriod" AS ENUM ('weekly', 'biweekly', 'monthly');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('task', 'report', 'payroll', 'inventory', 'message', 'geofence', 'expense', 'attendance', 'general');

-- CreateEnum
CREATE TYPE "LocationEventType" AS ENUM ('check_in', 'in_zone', 'out_of_zone', 'check_out', 'enter', 'exit', 'update');

-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('image', 'video', 'document', 'audio');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('present', 'absent', 'late', 'on_leave', 'half_day');

-- CreateEnum
CREATE TYPE "LeaveType" AS ENUM ('sick', 'vacation', 'personal', 'emergency', 'unpaid');

-- CreateEnum
CREATE TYPE "LeaveStatus" AS ENUM ('pending', 'approved', 'rejected', 'cancelled');

-- CreateEnum
CREATE TYPE "TimeAdjustmentType" AS ENUM ('check_in', 'check_out');

-- CreateEnum
CREATE TYPE "TimeAdjustmentStatus" AS ENUM ('pending', 'approved', 'denied');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('tools', 'materials', 'transportation', 'accommodation', 'food', 'communication', 'other');

-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "InventoryDamageStatus" AS ENUM ('unresolved', 'in_repair', 'resolved', 'written_off');

-- CreateEnum
CREATE TYPE "MessageThreadType" AS ENUM ('direct', 'group', 'support');

-- CreateEnum
CREATE TYPE "CertificationStatus" AS ENUM ('active', 'expired', 'revoked');

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('active', 'suspended', 'cancelled', 'trial');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('active', 'inactive', 'cancelled');

-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('active', 'canceled', 'expired', 'switched');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('pending', 'accepted', 'expired', 'cancelled');

-- CreateEnum
CREATE TYPE "ShiftDay" AS ENUM ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun');

-- CreateTable
CREATE TABLE "subscription_plans" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "price_monthly" DOUBLE PRECISION NOT NULL,
    "price_yearly" DOUBLE PRECISION,
    "stripe_product_id" TEXT,
    "stripe_price_monthly_id" TEXT,
    "stripe_price_yearly_id" TEXT,
    "max_companies" INTEGER,
    "max_projects" INTEGER,
    "max_users" INTEGER,
    "has_geofencing" BOOLEAN NOT NULL DEFAULT false,
    "has_advanced_reporting" BOOLEAN NOT NULL DEFAULT false,
    "has_custom_reporting" BOOLEAN NOT NULL DEFAULT false,
    "has_white_label" BOOLEAN NOT NULL DEFAULT false,
    "support_level" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "plan_id" UUID NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'trial',
    "trial_ends_at" TIMESTAMP(3),
    "billing_email" TEXT,
    "stripe_customer_id" TEXT,
    "stripe_subscription_id" TEXT,
    "stripe_price_id" TEXT,
    "subscription_status" TEXT,
    "current_period_start" TIMESTAMP(3),
    "current_period_end" TIMESTAMP(3),
    "plan_interval" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_purchases" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "plan_name" TEXT NOT NULL,
    "stripe_subscription_id" TEXT,
    "stripe_price_id" TEXT,
    "interval" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" "PurchaseStatus" NOT NULL DEFAULT 'active',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "canceled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "password_hash" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "avatar_url" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'worker',
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "last_active_at" TIMESTAMP(3),
    "employee_id" TEXT,
    "department" TEXT,
    "date_of_birth" DATE,
    "address" TEXT,
    "bio" TEXT,
    "hourly_rate" DOUBLE PRECISION,
    "join_date" DATE,
    "last_login_at" TIMESTAMP(3),
    "otp" TEXT,
    "otp_expires_at" TIMESTAMP(3),
    "reset_token" TEXT,
    "reset_expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "stripe_account_id" TEXT,
    "stripe_account_status" TEXT DEFAULT 'pending',

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "worker_manager_map" (
    "id" UUID NOT NULL,
    "manager_id" UUID NOT NULL,
    "worker_id" UUID NOT NULL,

    CONSTRAINT "worker_manager_map_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_blocks" (
    "id" UUID NOT NULL,
    "blocker_id" UUID NOT NULL,
    "blocked_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_contacts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "relationship" TEXT,
    "phone" TEXT,
    "email" TEXT,

    CONSTRAINT "emergency_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_certifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "issued_by" TEXT,
    "issued_at" DATE,
    "expires_at" DATE,
    "status" "CertificationStatus" NOT NULL DEFAULT 'active',
    "document_url" TEXT,

    CONSTRAINT "user_certifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_settings" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "date_format" TEXT NOT NULL DEFAULT 'MM/DD/YYYY',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "notify_project_updates" BOOLEAN NOT NULL DEFAULT true,
    "notify_safety_alerts" BOOLEAN NOT NULL DEFAULT true,
    "notify_workforce_updates" BOOLEAN NOT NULL DEFAULT false,
    "notify_financial_reports" BOOLEAN NOT NULL DEFAULT true,
    "push_enabled" BOOLEAN NOT NULL DEFAULT true,
    "push_sound" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "user_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "receiver_id" UUID,
    "email" TEXT,
    "phone" TEXT,
    "role" "UserRole" NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'pending',
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "owner_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "industry" TEXT,
    "description" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "address" TEXT,
    "logo_url" TEXT,
    "revenue" DOUBLE PRECISION,
    "project_level" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_members" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_certifications" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "issued_by" TEXT,
    "issued_at" DATE,
    "expires_at" DATE,
    "status" "CertificationStatus" NOT NULL DEFAULT 'active',
    "document_url" TEXT,

    CONSTRAINT "company_certifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "role" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "manager_id" UUID,
    "name" TEXT NOT NULL,
    "type" "ProjectType",
    "start_date" DATE,
    "end_date" DATE,
    "budget" DOUBLE PRECISION,
    "spent" DOUBLE PRECISION,
    "remaining" DOUBLE PRECISION,
    "location" TEXT,
    "description" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'planning',
    "priority" TEXT,
    "is_whole_house" BOOLEAN NOT NULL DEFAULT false,
    "house_sections" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "num_floors" INTEGER,
    "num_floors_min" INTEGER,
    "num_floors_max" INTEGER,
    "rooms_per_floor" INTEGER,
    "unit_per_floor" INTEGER,
    "unit_per_floor_min" INTEGER,
    "unit_per_floor_max" INTEGER,
    "progress" DOUBLE PRECISION DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,
    "project_type" TEXT NOT NULL,
    "property_type" TEXT NOT NULL,
    "unit_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unit" TEXT,
    "unit_price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "is_custom" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_members" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" TEXT,
    "managerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "floors" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "floor_number" INTEGER NOT NULL,
    "status" "FloorStatus" NOT NULL DEFAULT 'pending',
    "progress" DOUBLE PRECISION DEFAULT 0,

    CONSTRAINT "floors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "units" (
    "id" UUID NOT NULL,
    "floor_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT,
    "size_sqft" DOUBLE PRECISION,
    "status" "RoomStatus" NOT NULL DEFAULT 'pending',
    "progress" DOUBLE PRECISION DEFAULT 0,

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "floor_id" UUID,
    "unit_id" UUID,
    "assigned_to" UUID,
    "created_by" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" "TaskPriority" NOT NULL DEFAULT 'medium',
    "status" "TaskStatus" NOT NULL DEFAULT 'pending',
    "approval_decision" "ReviewDecision" NOT NULL DEFAULT 'pending',
    "approval_reviewed_by" UUID,
    "approval_reviewed_at" TIMESTAMP(3),
    "approval_notes" TEXT,
    "completion_decision" "ReviewDecision" NOT NULL DEFAULT 'pending',
    "completion_reviewed_by" UUID,
    "completion_reviewed_at" TIMESTAMP(3),
    "completion_notes" TEXT,
    "due_date" DATE,
    "estimated_hours" INTEGER,
    "actual_hours" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sub_tasks" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "task_assignee_id" UUID,
    "created_by" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" "TaskPriority" NOT NULL DEFAULT 'medium',
    "due_date" DATE,
    "estimated_hours" INTEGER,
    "status" "TaskStatus" NOT NULL DEFAULT 'pending',
    "approval_decision" "ReviewDecision" NOT NULL DEFAULT 'pending',
    "approval_reviewed_by" UUID,
    "approval_reviewed_at" TIMESTAMP(3),
    "approval_notes" TEXT,
    "approval_attachment_url" TEXT,
    "started_at" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sub_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sub_task_units" (
    "id" UUID NOT NULL,
    "sub_task_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,

    CONSTRAINT "sub_task_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_floors" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "floor_id" UUID NOT NULL,

    CONSTRAINT "task_floors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_units" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,

    CONSTRAINT "task_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_assignees" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "unit_id" UUID,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_assignees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_reports" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "sub_task_id" UUID,
    "worker_id" UUID NOT NULL,
    "notes" TEXT,
    "before_photo_url" TEXT,
    "after_photo_url" TEXT,
    "receipt_url" TEXT,
    "review_decision" "ReviewDecision" NOT NULL DEFAULT 'pending',
    "review_description" TEXT,
    "review_attachment_url" TEXT,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_schedules" (
    "id" UUID NOT NULL,
    "company_id" UUID,
    "name" TEXT NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "days" "ShiftDay"[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_schedule_assignments" (
    "id" UUID NOT NULL,
    "schedule_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_schedule_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendances" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'present',
    "totalHours" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_sessions" (
    "id" UUID NOT NULL,
    "attendance_id" UUID NOT NULL,
    "project_id" UUID,
    "check_in_time" TIMESTAMP(3) NOT NULL,
    "check_out_time" TIMESTAMP(3),
    "hours_worked" DOUBLE PRECISION,
    "in_lat" DOUBLE PRECISION,
    "in_lng" DOUBLE PRECISION,
    "out_lat" DOUBLE PRECISION,
    "out_lng" DOUBLE PRECISION,
    "zone_seconds" INTEGER DEFAULT 0,
    "outside_seconds" INTEGER DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_adjustment_requests" (
    "id" UUID NOT NULL,
    "worker_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "request_type" "TimeAdjustmentType" NOT NULL,
    "original_time" TIMESTAMP(3) NOT NULL,
    "adjusted_time" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "status" "TimeAdjustmentStatus" NOT NULL DEFAULT 'pending',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "time_adjustment_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_requests" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "leave_type" "LeaveType" NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "reason" TEXT,
    "status" "LeaveStatus" NOT NULL DEFAULT 'pending',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_configs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "mode" "PayrollMode" NOT NULL DEFAULT 'hourly',
    "period" "PayrollPeriod" NOT NULL DEFAULT 'biweekly',
    "cpp_employee_rate" DOUBLE PRECISION NOT NULL DEFAULT 0.0595,
    "ei_employee_rate" DOUBLE PRECISION NOT NULL DEFAULT 0.0166,
    "federal_tax_rate" DOUBLE PRECISION NOT NULL DEFAULT 0.15,
    "provincial_tax_rate" DOUBLE PRECISION NOT NULL DEFAULT 0.0505,
    "cpp_employer_rate" DOUBLE PRECISION NOT NULL DEFAULT 0.0595,
    "ei_employer_rate" DOUBLE PRECISION NOT NULL DEFAULT 0.0232,
    "wsib_rate" DOUBLE PRECISION NOT NULL DEFAULT 0.0142,
    "vacation_pay_rate" DOUBLE PRECISION NOT NULL DEFAULT 0.04,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payrolls" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "worker_id" UUID NOT NULL,
    "pay_period_start" DATE NOT NULL,
    "pay_period_end" DATE NOT NULL,
    "regular_hours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "overtime_hours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rate_per_hour" DOUBLE PRECISION NOT NULL,
    "gross_pay" DOUBLE PRECISION NOT NULL,
    "deductions" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "net_pay" DOUBLE PRECISION NOT NULL,
    "employer_cost" DOUBLE PRECISION,
    "status" "PayrollStatus" NOT NULL DEFAULT 'draft',
    "processed_by" UUID,
    "project_id" UUID,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payrolls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "worker_id" UUID NOT NULL,
    "project_id" UUID,
    "task_id" UUID,
    "description" TEXT NOT NULL,
    "category" "ExpenseCategory" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "receipt_url" TEXT,
    "date" DATE NOT NULL,
    "status" "ExpenseStatus" NOT NULL DEFAULT 'pending',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "review_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_items" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "location" TEXT,
    "current_qty" INTEGER NOT NULL DEFAULT 0,
    "min_stock_qty" INTEGER NOT NULL DEFAULT 0,
    "unit" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "project_id" UUID NOT NULL,

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_inventories" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "sub_task_id" UUID,
    "inventory_id" UUID NOT NULL,
    "qty_used" INTEGER NOT NULL,

    CONSTRAINT "task_inventories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_usage_logs" (
    "id" UUID NOT NULL,
    "inventory_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "project_id" UUID,
    "qty_change" INTEGER NOT NULL,
    "reason" TEXT,
    "logged_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_damages" (
    "id" UUID NOT NULL,
    "inventory_id" UUID NOT NULL,
    "reported_by" UUID NOT NULL,
    "description" TEXT,
    "qty_damaged" INTEGER NOT NULL,
    "photo_url" TEXT,
    "status" "InventoryDamageStatus" NOT NULL DEFAULT 'unresolved',
    "resolved_at" TIMESTAMP(3),
    "reported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_damages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "geofences" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "zone_name" TEXT NOT NULL,
    "polygon_coords" JSONB,
    "total_area_sqft" DOUBLE PRECISION,
    "perimeter_ft" DOUBLE PRECISION,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "geofences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "geofence_id" UUID,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "event_type" "LocationEventType" NOT NULL,
    "logged_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "duration_seconds" INTEGER,
    "is_inside_zone" BOOLEAN DEFAULT false,

    CONSTRAINT "location_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "geofence_violations" (
    "id" UUID NOT NULL,
    "geofence_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "distance_m" DOUBLE PRECISION NOT NULL,
    "description" TEXT,
    "is_resolved" BOOLEAN NOT NULL DEFAULT false,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "geofence_violations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "company_id" UUID,
    "project_id" UUID,
    "uploaded_by" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_url" TEXT NOT NULL,
    "file_type" TEXT,
    "file_size_mb" DOUBLE PRECISION,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public_content_pages" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "body" JSONB,
    "sections" JSONB,
    "is_published" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "public_content_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_requests" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "role" TEXT,
    "subject" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_threads" (
    "id" UUID NOT NULL,
    "type" "MessageThreadType" NOT NULL DEFAULT 'direct',
    "name" TEXT,
    "project_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mailbox_conversations" (
    "id" UUID NOT NULL,
    "manager_id" UUID NOT NULL,
    "client_email" TEXT NOT NULL,
    "client_name" TEXT NOT NULL,
    "proxy_address" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "is_starred" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mailbox_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "thread_participants" (
    "id" UUID NOT NULL,
    "thread_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" TEXT,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "thread_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "thread_id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "content" TEXT,
    "media_url" TEXT,
    "media_type" "MediaType",
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mailbox_messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "sender_id" UUID,
    "direction" TEXT NOT NULL,
    "from_email" TEXT NOT NULL,
    "to_email" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body_text" TEXT,
    "body_html" TEXT,
    "attachments" JSONB,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mailbox_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "type" "NotificationType" NOT NULL DEFAULT 'general',
    "ref_id" TEXT,
    "ref_type" TEXT,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_domain_key" ON "tenants"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_employee_id_key" ON "users"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "worker_manager_map_worker_id_key" ON "worker_manager_map"("worker_id");

-- CreateIndex
CREATE UNIQUE INDEX "message_blocks_blocker_id_blocked_user_id_key" ON "message_blocks"("blocker_id", "blocked_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_settings_user_id_key" ON "user_settings"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_key" ON "invitations"("token");

-- CreateIndex
CREATE UNIQUE INDEX "company_members_company_id_user_id_key" ON "company_members"("company_id", "user_id");

-- CreateIndex
CREATE INDEX "quotes_project_type_property_type_unit_type_idx" ON "quotes"("project_type", "property_type", "unit_type");

-- CreateIndex
CREATE UNIQUE INDEX "project_members_project_id_user_id_key" ON "project_members"("project_id", "user_id");

-- CreateIndex
CREATE INDEX "sub_tasks_task_id_unit_id_idx" ON "sub_tasks"("task_id", "unit_id");

-- CreateIndex
CREATE INDEX "sub_tasks_created_by_idx" ON "sub_tasks"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "sub_task_units_sub_task_id_unit_id_key" ON "sub_task_units"("sub_task_id", "unit_id");

-- CreateIndex
CREATE UNIQUE INDEX "task_floors_task_id_floor_id_key" ON "task_floors"("task_id", "floor_id");

-- CreateIndex
CREATE UNIQUE INDEX "task_units_task_id_unit_id_key" ON "task_units"("task_id", "unit_id");

-- CreateIndex
CREATE UNIQUE INDEX "task_assignees_task_id_user_id_unit_id_key" ON "task_assignees"("task_id", "user_id", "unit_id");

-- CreateIndex
CREATE UNIQUE INDEX "work_schedule_assignments_schedule_id_user_id_key" ON "work_schedule_assignments"("schedule_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "attendances_user_id_date_key" ON "attendances"("user_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_configs_company_id_key" ON "payroll_configs"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_task_id_key" ON "expenses"("task_id");

-- CreateIndex
CREATE UNIQUE INDEX "task_inventories_sub_task_id_inventory_id_key" ON "task_inventories"("sub_task_id", "inventory_id");

-- CreateIndex
CREATE UNIQUE INDEX "public_content_pages_slug_key" ON "public_content_pages"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "mailbox_conversations_proxy_address_key" ON "mailbox_conversations"("proxy_address");

-- CreateIndex
CREATE INDEX "mailbox_conversations_manager_id_status_idx" ON "mailbox_conversations"("manager_id", "status");

-- CreateIndex
CREATE INDEX "mailbox_conversations_manager_id_is_starred_idx" ON "mailbox_conversations"("manager_id", "is_starred");

-- CreateIndex
CREATE UNIQUE INDEX "thread_participants_thread_id_user_id_key" ON "thread_participants"("thread_id", "user_id");

-- CreateIndex
CREATE INDEX "mailbox_messages_conversation_id_created_at_idx" ON "mailbox_messages"("conversation_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "device_tokens_token_key" ON "device_tokens"("token");

-- AddForeignKey
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_purchases" ADD CONSTRAINT "subscription_purchases_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_purchases" ADD CONSTRAINT "subscription_purchases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_purchases" ADD CONSTRAINT "subscription_purchases_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_manager_map" ADD CONSTRAINT "worker_manager_map_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_manager_map" ADD CONSTRAINT "worker_manager_map_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_blocks" ADD CONSTRAINT "message_blocks_blocker_id_fkey" FOREIGN KEY ("blocker_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_blocks" ADD CONSTRAINT "message_blocks_blocked_user_id_fkey" FOREIGN KEY ("blocked_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_contacts" ADD CONSTRAINT "emergency_contacts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_certifications" ADD CONSTRAINT "user_certifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_receiver_id_fkey" FOREIGN KEY ("receiver_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_members" ADD CONSTRAINT "company_members_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_members" ADD CONSTRAINT "company_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_certifications" ADD CONSTRAINT "company_certifications_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "floors" ADD CONSTRAINT "floors_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_floor_id_fkey" FOREIGN KEY ("floor_id") REFERENCES "floors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_floor_id_fkey" FOREIGN KEY ("floor_id") REFERENCES "floors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_tasks" ADD CONSTRAINT "sub_tasks_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_tasks" ADD CONSTRAINT "sub_tasks_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_tasks" ADD CONSTRAINT "sub_tasks_task_assignee_id_fkey" FOREIGN KEY ("task_assignee_id") REFERENCES "task_assignees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_tasks" ADD CONSTRAINT "sub_tasks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_task_units" ADD CONSTRAINT "sub_task_units_sub_task_id_fkey" FOREIGN KEY ("sub_task_id") REFERENCES "sub_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_task_units" ADD CONSTRAINT "sub_task_units_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_floors" ADD CONSTRAINT "task_floors_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_floors" ADD CONSTRAINT "task_floors_floor_id_fkey" FOREIGN KEY ("floor_id") REFERENCES "floors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_units" ADD CONSTRAINT "task_units_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_units" ADD CONSTRAINT "task_units_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_reports" ADD CONSTRAINT "task_reports_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_reports" ADD CONSTRAINT "task_reports_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_reports" ADD CONSTRAINT "task_reports_sub_task_id_fkey" FOREIGN KEY ("sub_task_id") REFERENCES "sub_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_schedule_assignments" ADD CONSTRAINT "work_schedule_assignments_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "work_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_schedule_assignments" ADD CONSTRAINT "work_schedule_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_attendance_id_fkey" FOREIGN KEY ("attendance_id") REFERENCES "attendances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_adjustment_requests" ADD CONSTRAINT "time_adjustment_requests_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payrolls" ADD CONSTRAINT "payrolls_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payrolls" ADD CONSTRAINT "payrolls_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payrolls" ADD CONSTRAINT "payrolls_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_inventories" ADD CONSTRAINT "task_inventories_inventory_id_fkey" FOREIGN KEY ("inventory_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_inventories" ADD CONSTRAINT "task_inventories_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_inventories" ADD CONSTRAINT "task_inventories_sub_task_id_fkey" FOREIGN KEY ("sub_task_id") REFERENCES "sub_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_usage_logs" ADD CONSTRAINT "inventory_usage_logs_inventory_id_fkey" FOREIGN KEY ("inventory_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_usage_logs" ADD CONSTRAINT "inventory_usage_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_damages" ADD CONSTRAINT "inventory_damages_inventory_id_fkey" FOREIGN KEY ("inventory_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "geofences" ADD CONSTRAINT "geofences_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_logs" ADD CONSTRAINT "location_logs_geofence_id_fkey" FOREIGN KEY ("geofence_id") REFERENCES "geofences"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_logs" ADD CONSTRAINT "location_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "geofence_violations" ADD CONSTRAINT "geofence_violations_geofence_id_fkey" FOREIGN KEY ("geofence_id") REFERENCES "geofences"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_requests" ADD CONSTRAINT "support_requests_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mailbox_conversations" ADD CONSTRAINT "mailbox_conversations_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thread_participants" ADD CONSTRAINT "thread_participants_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "message_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thread_participants" ADD CONSTRAINT "thread_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "message_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mailbox_messages" ADD CONSTRAINT "mailbox_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "mailbox_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mailbox_messages" ADD CONSTRAINT "mailbox_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
