CREATE TABLE IF NOT EXISTS public_content_pages (
    id UUID NOT NULL PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    subtitle TEXT,
    body JSONB,
    sections JSONB,
    is_published BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS support_requests (
    id UUID NOT NULL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT,
    role TEXT,
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    created_by_id UUID,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'support_requests_created_by_id_fkey'
    ) THEN
        ALTER TABLE support_requests
        ADD CONSTRAINT support_requests_created_by_id_fkey
        FOREIGN KEY (created_by_id) REFERENCES users(id)
        ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
