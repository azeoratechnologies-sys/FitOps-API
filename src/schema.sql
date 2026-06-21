-- =============================================================
-- AzeoraCRM & FitOps - Consolidated Database Schema
-- Includes: Clients, Subscriptions, Plans, Coupons, Payments, and Leads
-- =============================================================

-- 1️⃣ Subscription Plans
CREATE TABLE IF NOT EXISTS public.subscription_plans (
    plan_id        SERIAL PRIMARY KEY,
    plan_name      TEXT NOT NULL,
    duration_days  INT NOT NULL,
    price          NUMERIC(10,2) NOT NULL,
    discount       NUMERIC(5,2) DEFAULT 0,
    is_active      BOOLEAN DEFAULT TRUE,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at     TIMESTAMP
);

-- 2️⃣ Coupons
CREATE TABLE IF NOT EXISTS public.coupons (
    coupon_id      SERIAL PRIMARY KEY,
    coupon_code    TEXT UNIQUE NOT NULL,
    discount_type  TEXT CHECK (discount_type IN ('PERCENT', 'FIXED')),
    discount_value NUMERIC(10,2) NOT NULL,
    valid_from     TIMESTAMP NOT NULL,
    valid_to       TIMESTAMP NOT NULL,
    is_active      BOOLEAN DEFAULT TRUE,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at     TIMESTAMP
);

-- 3️⃣ Clients
CREATE TABLE IF NOT EXISTS public.clients (
    client_id       SERIAL PRIMARY KEY,
    business_code   TEXT UNIQUE NOT NULL,
    business_name   TEXT NOT NULL,
    store_name      TEXT,
    mobile_no       TEXT UNIQUE NOT NULL,
    email           TEXT,
    address         TEXT,
    country         TEXT DEFAULT 'India',
    username        TEXT UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,
    wallet_balance  NUMERIC(10,2) DEFAULT 0,
    referral_code   TEXT,
    is_active       BOOLEAN DEFAULT TRUE,
    register_date   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expiry_date     TIMESTAMP,
    deleted_at      TIMESTAMP,
    device_id       TEXT,
    business_type   TEXT,
    country_code    TEXT,
    platform        TEXT,
    app_version     TEXT
);

-- 4️⃣ Client Subscriptions
CREATE TABLE IF NOT EXISTS public.client_subscriptions (
    subscription_id SERIAL PRIMARY KEY,
    client_id       INT REFERENCES public.clients(client_id),
    plan_id         INT REFERENCES public.subscription_plans(plan_id),
    coupon_id       INT REFERENCES public.coupons(coupon_id),
    start_date      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expiry_date     TIMESTAMP NOT NULL,
    is_active       BOOLEAN DEFAULT TRUE,
    is_trial        BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at      TIMESTAMP
);

-- 5️⃣ Payments
CREATE TABLE IF NOT EXISTS public.payments (
    payment_id      SERIAL PRIMARY KEY,
    client_id       INT REFERENCES public.clients(client_id),
    plan_id         INT REFERENCES public.subscription_plans(plan_id),
    amount          NUMERIC(10,2) NOT NULL,
    payment_mode    TEXT,
    transaction_ref TEXT,
    payment_status  TEXT DEFAULT 'PENDING',
    payment_date    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6️⃣ CRM Leads
CREATE TABLE IF NOT EXISTS public.leads (
    lead_id          SERIAL PRIMARY KEY,
    lead_name        TEXT NOT NULL,
    business_name    TEXT NOT NULL,
    business_type    TEXT CHECK (business_type IN ('Tailoring', 'Boutique', 'Laundry')),
    city             TEXT,
    state            TEXT,
    phone            TEXT NOT NULL,
    email            TEXT,
    status           TEXT DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'demo', 'converted', 'lost')),
    source           TEXT,
    assigned_to      TEXT,
    last_contact_at  TIMESTAMP,
    follow_up_at     TIMESTAMP,
    estimated_value  NUMERIC(10,2) DEFAULT 0,
    notes            TEXT,
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at       TIMESTAMP
);

-- =============================================================
-- STORED PROCEDURES (Fixed Versions)
-- =============================================================

-- Register Client (with default auth)
CREATE OR REPLACE FUNCTION public.register_client(
    p_business_name TEXT,
    p_store_name TEXT,
    p_gst_tax_number TEXT,
    p_mobile_no TEXT,
    p_email TEXT,
    p_address TEXT,
    p_country TEXT,
    p_business_type TEXT DEFAULT 'Tailoring',
    p_username TEXT DEFAULT NULL,
    p_password_hash TEXT DEFAULT 'default_hash',
    p_referral_code TEXT DEFAULT NULL
) RETURNS INT AS $$
DECLARE
    v_client_id INT;
    v_business_code TEXT;
    v_expiry TIMESTAMP;
BEGIN
    v_business_code := 'AZ' || TO_CHAR(NOW(), 'DDMM') || FLOOR(RANDOM() * 9000 + 1000)::TEXT;
    v_expiry := NOW() + INTERVAL '15 days';

    INSERT INTO public.clients (
        business_code, business_name, store_name, gst_tax_number, mobile_no, 
        email, address, country, business_type, username, password_hash, 
        referral_code, expiry_date
    ) VALUES (
        v_business_code, p_business_name, p_store_name, p_gst_tax_number, p_mobile_no, 
        p_email, p_address, p_country, p_business_type, COALESCE(p_username, p_mobile_no), 
        p_password_hash, p_referral_code, v_expiry
    ) RETURNING client_id INTO v_client_id;

    -- Create initial trial subscription
    INSERT INTO public.client_subscriptions (client_id, plan_id, start_date, expiry_date, is_trial)
    SELECT v_client_id, plan_id, NOW(), v_expiry, TRUE
    FROM public.subscription_plans 
    WHERE duration_days = 30 OR plan_name ILIKE '%1 Month%'
    LIMIT 1;

    RETURN v_client_id;
END;
$$ LANGUAGE plpgsql;

-- Renew Subscription (Updated with Coupon Support)
CREATE OR REPLACE FUNCTION public.renew_subscription(
    p_client_id INT,
    p_plan_id   INT,
    p_coupon_id INT DEFAULT NULL,
    p_payment_mode TEXT DEFAULT 'UPI',
    p_transaction_ref TEXT DEFAULT NULL
) RETURNS TIMESTAMP AS $$
DECLARE
  v_plan   RECORD;
  v_coupon RECORD;
  v_current_exp TIMESTAMP;
  v_new_exp TIMESTAMP;
  v_amount NUMERIC;
  v_discount NUMERIC := 0;
BEGIN
  -- 1. Get Plan
  SELECT * INTO v_plan FROM subscription_plans WHERE plan_id = p_plan_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plan not found'; END IF;

  -- 2. Handle Coupon
  IF p_coupon_id IS NOT NULL THEN
    -- Check if already used
    IF EXISTS (SELECT 1 FROM coupon_usage WHERE client_id = p_client_id AND coupon_id = p_coupon_id) THEN
      RAISE EXCEPTION 'Coupon already used';
    END IF;

    -- Get Coupon Details
    SELECT * INTO v_coupon FROM coupons WHERE coupon_id = p_coupon_id AND is_active = TRUE AND NOW() BETWEEN valid_from AND valid_to;
    IF NOT FOUND THEN RAISE EXCEPTION 'Coupon invalid or expired'; END IF;

    -- Calculate Discount
    IF v_coupon.discount_type = 'PERCENT' THEN
      v_discount := (v_plan.price * v_coupon.discount_value) / 100;
    ELSE
      v_discount := v_coupon.discount_value;
    END IF;

    -- Record Usage
    INSERT INTO coupon_usage (client_id, coupon_id) VALUES (p_client_id, p_coupon_id);
  END IF;

  -- 3. Calculate Expiry
  SELECT COALESCE(MAX(expiry_date), NOW()) INTO v_current_exp FROM client_subscriptions
    WHERE client_id = p_client_id AND is_active = TRUE;
    
  IF v_current_exp < NOW() THEN v_current_exp := NOW(); END IF;
  v_new_exp := v_current_exp + (v_plan.duration_days || ' days')::INTERVAL;

  -- 4. Update Subscription
  UPDATE client_subscriptions 
  SET plan_id = p_plan_id, expiry_date = v_new_exp, is_trial = FALSE, coupon_id = p_coupon_id
  WHERE client_id = p_client_id;

  -- 5. Record Payment
  v_amount := v_plan.price - v_discount;
  IF v_amount < 0 THEN v_amount := 0; END IF;

  INSERT INTO payments (client_id, plan_id, amount, payment_mode, transaction_ref, payment_status)
  VALUES (p_client_id, p_plan_id, v_amount, p_payment_mode, p_transaction_ref, 'SUCCESS');

  RETURN v_new_exp;
END;
$$ LANGUAGE plpgsql;
-- 7️⃣ Coupon System Tracking
CREATE TABLE IF NOT EXISTS public.coupon_usage (
    usage_id SERIAL PRIMARY KEY,
    client_id INT REFERENCES public.clients(client_id),
    coupon_id INT REFERENCES public.coupons(coupon_id),
    used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(client_id, coupon_id)
);

-- 8️⃣ Admin Users (Internal Team)
CREATE TABLE IF NOT EXISTS public.admin_users (
    user_id        SERIAL PRIMARY KEY,
    email          TEXT UNIQUE NOT NULL,
    password_hash  TEXT NOT NULL,
    full_name      TEXT,
    role           TEXT DEFAULT 'user' CHECK (role IN ('admin', 'user')),
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 10️⃣ Merchant Gateways (Payment Keys)
CREATE TABLE IF NOT EXISTS public.merchant_gateways (
    gateway_id     SERIAL PRIMARY KEY,
    gateway_name   TEXT NOT NULL, -- e.g., 'RAZORPAY'
    key_id         TEXT NOT NULL,
    key_secret     TEXT NOT NULL,
    is_active      BOOLEAN DEFAULT TRUE,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed Razorpay Test Keys
INSERT INTO public.merchant_gateways (gateway_name, key_id, key_secret)
VALUES ('RAZORPAY', 'rzp_test_SvBDlz33nK8aoD', '9IRURXkYAkAI1bxgCGFhZlM5')
ON CONFLICT DO NOTHING;

-- 12️⃣ App Versions
CREATE TABLE IF NOT EXISTS public.app_versions (
    id SERIAL PRIMARY KEY,
    platform TEXT UNIQUE NOT NULL,
    latest_version TEXT NOT NULL,
    last_version TEXT NOT NULL,
    is_mandatory BOOLEAN DEFAULT FALSE,
    download_url TEXT,
    release_notes TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed Initial App Versions
INSERT INTO public.app_versions (platform, latest_version, last_version, is_mandatory, download_url)
VALUES 
  ('android', '1.0.0', '1.0.0', false, 'https://play.google.com/store/apps/details?id=com.fitsuite.fitops'),
  ('ios', '1.0.0', '1.0.0', false, 'https://apps.apple.com/app/fitops')
ON CONFLICT (platform) DO NOTHING;

-- 11️⃣ Audit Logs

-- Update Leads table to link to Clients
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS converted_client_id INT REFERENCES public.clients(client_id);

-- Add release_notes to app_versions for existing databases
ALTER TABLE public.app_versions ADD COLUMN IF NOT EXISTS release_notes TEXT DEFAULT '';

-- Ensure clients table has required fields for app version and platform tracking
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS platform TEXT;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS app_version TEXT;

-- =============================================================
-- SEED DATA
-- =============================================================

INSERT INTO public.admin_users (email, password_hash, full_name, role)
VALUES 
('azeoratechnologies@gmail.com', 'Azeez@786', 'Azeez Mohammad', 'admin'),
('Asif.ashu143@gmail.com', 'Asif@786', 'Asif', 'user')
ON CONFLICT (email) DO NOTHING;

-- =============================================================
-- PERMISSIONS
-- =============================================================
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;

-- Special fix for sequences if needed
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
