-- =============================================================
-- Supabase (PostgreSQL) schema for FitOps subscription system
-- Includes all tables from the original design and the additional
-- tables/features you requested (wallet, UPI status, login audit,
-- soft‑delete, API keys).
-- =============================================================

-- 1️⃣ Clients (core registration & login) – add soft‑delete column
CREATE TABLE public.clients (
  client_id      SERIAL PRIMARY KEY,
  business_code  VARCHAR(12) UNIQUE NOT NULL,       -- auto‑generated
  business_name  TEXT NOT NULL,
  store_name     TEXT,
  gst_tax_number TEXT,
  mobile_no      TEXT NOT NULL,
  email          TEXT,
  address        TEXT,
  country        TEXT,
  username       TEXT UNIQUE NOT NULL,
  password_hash  TEXT NOT NULL,
  referral_code  TEXT UNIQUE,
  wallet_balance NUMERIC(12,2) DEFAULT 0,
  register_date  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expiry_date    TIMESTAMP,
  is_active      BOOLEAN DEFAULT TRUE,
  deleted_at     TIMESTAMP           -- NULL = not deleted (soft delete)
);

-- 2️⃣ Subscription Plans
CREATE TABLE public.subscription_plans (
  plan_id       SERIAL PRIMARY KEY,
  plan_name     TEXT NOT NULL,          -- e.g. "1 Month"
  duration_days INT NOT NULL,           -- 30, 90, ...
  price         NUMERIC(10,2) NOT NULL,
  discount      NUMERIC(5,2) DEFAULT 0,
  is_active     BOOLEAN DEFAULT TRUE,
  deleted_at    TIMESTAMP
);

-- 3️⃣ Coupons / Offers
CREATE TABLE public.coupons (
  coupon_id      SERIAL PRIMARY KEY,
  coupon_code    TEXT UNIQUE NOT NULL,
  discount_type  TEXT NOT NULL CHECK (discount_type IN ('PERCENT','FIXED')),
  discount_value NUMERIC(10,2) NOT NULL,
  valid_from     TIMESTAMP NOT NULL,
  valid_to       TIMESTAMP NOT NULL,
  is_active      BOOLEAN DEFAULT TRUE,
  deleted_at     TIMESTAMP
);

-- 4️⃣ Client Subscriptions (current active subscription)
CREATE TABLE public.client_subscriptions (
  subscription_id SERIAL PRIMARY KEY,
  client_id       INT REFERENCES public.clients(client_id) ON DELETE CASCADE,
  plan_id         INT REFERENCES public.subscription_plans(plan_id),
  coupon_id       INT REFERENCES public.coupons(coupon_id),
  start_date      TIMESTAMP NOT NULL,
  expiry_date     TIMESTAMP NOT NULL,
  is_trial        BOOLEAN DEFAULT FALSE,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at      TIMESTAMP
);

-- 5️⃣ Subscription History (immutable audit)
CREATE TABLE public.subscription_history (
  history_id   SERIAL PRIMARY KEY,
  client_id    INT REFERENCES public.clients(client_id),
  plan_id      INT REFERENCES public.subscription_plans(plan_id),
  start_date   TIMESTAMP NOT NULL,
  expiry_date  TIMESTAMP NOT NULL,
  amount       NUMERIC(10,2) NOT NULL,
  action_type  TEXT NOT NULL CHECK (action_type IN ('TRIAL','NEW','RENEWAL')),
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at   TIMESTAMP
);

-- 6️⃣ Payments (UPI placeholder) – includes status column
CREATE TABLE public.payments (
  payment_id      SERIAL PRIMARY KEY,
  client_id       INT REFERENCES public.clients(client_id),
  plan_id         INT REFERENCES public.subscription_plans(plan_id),
  amount          NUMERIC(10,2) NOT NULL,
  payment_mode    TEXT NOT NULL,                     -- e.g. "UPI", "CARD"
  transaction_ref TEXT,
  payment_status  TEXT NOT NULL DEFAULT 'PENDING' CHECK (payment_status IN ('PENDING','SUCCESS','FAILED')),
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at      TIMESTAMP
);

-- 7️⃣ Wallet Transactions – every credit/debit is logged
CREATE TABLE public.wallet_transactions (
  txn_id      SERIAL PRIMARY KEY,
  client_id   INT REFERENCES public.clients(client_id),
  amount      NUMERIC(12,2) NOT NULL,               -- positive = credit, negative = debit
  description TEXT,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at  TIMESTAMP
);

-- 8️⃣ Login Audit – capture IP, user‑agent, time
CREATE TABLE public.login_audit (
  audit_id   SERIAL PRIMARY KEY,
  client_id  INT REFERENCES public.clients(client_id),
  ip_address TEXT,
  user_agent TEXT,
  login_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  success    BOOLEAN,
  deleted_at TIMESTAMP
);

-- 9️⃣ Client API Keys – for multi‑tenant external APIs
CREATE TABLE public.client_api_keys (
  api_key_id   SERIAL PRIMARY KEY,
  client_id    INT REFERENCES public.clients(client_id),
  api_key_hash TEXT NOT NULL,            -- store a bcrypt/sha256 hash, not the raw key
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at   TIMESTAMP,
  is_active    BOOLEAN DEFAULT TRUE,
  deleted_at   TIMESTAMP
);

-- 🔟 Connection Config – future offline sync
CREATE TABLE public.client_connection_config (
  config_id      SERIAL PRIMARY KEY,
  client_id      INT REFERENCES public.clients(client_id),
  api_url        TEXT,
  db_connection  TEXT,
  last_sync      TIMESTAMP,
  is_active      BOOLEAN DEFAULT TRUE,
  deleted_at     TIMESTAMP
);

-- =============================================================
-- Helper function to generate a unique 10‑digit business code.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_business_code()
RETURNS TEXT AS $$
DECLARE
  prefix TEXT := 'AZ' || TO_CHAR(NOW(),'YYMM');
  suffix TEXT;
BEGIN
  LOOP
    suffix := LPAD(FLOOR(RANDOM()*100000)::TEXT, 5, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM clients WHERE business_code = prefix || suffix);
  END LOOP;
  RETURN prefix || suffix;
END;
$$ LANGUAGE plpgsql VOLATILE;

-- =============================================================
-- Example stored procedures for registration and renewal (use via Supabase RPC)
-- -------------------------------------------------------------

-- Register a client (adds trial subscription & history)
CREATE OR REPLACE FUNCTION public.register_client(
    p_business_name TEXT,
    p_store_name TEXT,
    p_gst_tax_number TEXT,
    p_mobile_no TEXT,
    p_email TEXT,
    p_address TEXT,
    p_country TEXT,
    p_username TEXT,
    p_password_hash TEXT,
    p_referral_code TEXT DEFAULT NULL
) RETURNS INT AS $$
DECLARE
  v_client_id INT;
  v_code TEXT := generate_business_code();
  v_expiry TIMESTAMP := NOW() + INTERVAL '15 days';
BEGIN
  INSERT INTO clients (
    business_code, business_name, store_name, gst_tax_number, mobile_no, email,
    address, country, username, password_hash, referral_code, expiry_date
  ) VALUES (
    v_code, p_business_name, p_store_name, p_gst_tax_number, p_mobile_no, p_email,
    p_address, p_country, p_username, p_password_hash, p_referral_code, v_expiry
  ) RETURNING client_id INTO v_client_id;

  -- trial subscription (use the shortest plan, e.g., 1‑month)
  INSERT INTO client_subscriptions (client_id, plan_id, start_date, expiry_date, is_trial)
  SELECT v_client_id, plan_id, NOW(), v_expiry, TRUE
  FROM subscription_plans WHERE duration_days = 30 LIMIT 1;

  INSERT INTO subscription_history (client_id, plan_id, start_date, expiry_date, amount, action_type)
  SELECT v_client_id, plan_id, NOW(), v_expiry, 0, 'TRIAL'
  FROM subscription_plans WHERE duration_days = 30 LIMIT 1;

  -- Referral reward – credit referrer’s wallet if a valid code provided
  IF p_referral_code IS NOT NULL THEN
    UPDATE clients SET wallet_balance = wallet_balance + 10
    WHERE referral_code = p_referral_code;
  END IF;

  RETURN v_client_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Renew a subscription (applies optional coupon, creates payment & history)
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
BEGIN
  SELECT * INTO v_plan FROM subscription_plans WHERE plan_id = p_plan_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plan not found'; END IF;

  SELECT * INTO v_coupon FROM coupons WHERE coupon_id = p_coupon_id AND is_active;
  IF p_coupon_id IS NOT NULL AND NOT FOUND THEN RAISE EXCEPTION 'Coupon invalid'; END IF;

  SELECT COALESCE(expiry_date, NOW()) INTO v_current_exp FROM client_subscriptions
    WHERE client_id = p_client_id AND is_active = TRUE ORDER BY expiry_date DESC LIMIT 1;

  v_new_exp := v_current_exp + (v_plan.duration_days || ' days')::INTERVAL;

  UPDATE client_subscriptions SET expiry_date = v_new_exp, is_trial = FALSE
  WHERE client_id = p_client_id;

  -- Compute final amount after discount (if any)
  v_amount := v_plan.price;
  IF v_coupon IS NOT NULL THEN
    IF v_coupon.discount_type = 'PERCENT' THEN
      v_amount := v_amount * (1 - v_coupon.discount_value/100);
    ELSE
      v_amount := v_amount - v_coupon.discount_value;
    END IF;
  END IF;

  INSERT INTO payments (client_id, plan_id, amount, payment_mode, transaction_ref, payment_status)
  VALUES (p_client_id, p_plan_id, v_amount, p_payment_mode, p_transaction_ref, 'PENDING');

  INSERT INTO subscription_history (client_id, plan_id, start_date, expiry_date, amount, action_type)
  VALUES (p_client_id, p_plan_id, NOW(), v_new_exp, v_amount, 'RENEWAL');

  RETURN v_new_exp;
END;
$$ LANGUAGE plpgsql;

-- =============================================================
-- Rate‑limiting can be enforced via Supabase Edge Functions or a
-- lightweight Express middleware (not shown here). The schema above
-- already supports the needed audit trails and soft‑deletes.
-- =============================================================

-- 8️⃣ Login Audit – track successful logins and device info
CREATE TABLE public.login_audit (
  audit_id    SERIAL PRIMARY KEY,
  client_id   INT REFERENCES public.clients(client_id),
  ip_address  TEXT,
  user_agent  TEXT,
  device_id   TEXT,                       -- Unique ID from mobile app
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 9️⃣ Client API Keys – for potential integration usage
CREATE TABLE public.client_api_keys (
  key_id      SERIAL PRIMARY KEY,
  client_id   INT REFERENCES public.clients(client_id),
  api_key     TEXT UNIQUE NOT NULL,
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at  TIMESTAMP
);

-- 🔟 Client Connection Config – dynamic DB URLs or multi-tenant settings
CREATE TABLE public.client_connection_config (
  config_id   SERIAL PRIMARY KEY,
  client_id   INT REFERENCES public.clients(client_id),
  db_url      TEXT,                       -- if using separate DBs
  storage_bucket TEXT,
  settings    JSONB,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at  TIMESTAMP
);

-- =============================================================
CREATE TABLE public.referrals (
  referral_id   SERIAL PRIMARY KEY,
  referrer_client_id INT REFERENCES public.clients(client_id),
  referred_client_id INT REFERENCES public.clients(client_id),
  referral_code TEXT NOT NULL,            -- code used at registration
  reward_amount NUMERIC(10,2) DEFAULT 0,  -- amount credited to referrer's wallet
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);

-- 12️⃣ Failed login attempts – helps lockout after N failures
CREATE TABLE public.failed_logins (
  fail_id    SERIAL PRIMARY KEY,
  client_id  INT REFERENCES public.clients(client_id),
  ip_address TEXT,
  attempt_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);

-- 13️⃣ Generic audit log – capture any important action (e.g., plan changes)
CREATE TABLE public.audit_log (
  audit_id   SERIAL PRIMARY KEY,
  client_id  INT REFERENCES public.clients(client_id),
  action     TEXT NOT NULL,                -- description of the action
  details    JSONB,                         -- optional JSON payload
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);

-- 15️⃣ System Config – for global admin settings (Email, SMS, etc.)
CREATE TABLE public.system_config (
  config_id   SERIAL PRIMARY KEY,
  config_key  TEXT UNIQUE NOT NULL,         -- e.g., 'email_smtp_settings'
  config_value JSONB NOT NULL,              -- e.g., { "host": "...", "port": 587, "user": "...", "pass": "...", "enabled": true }
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed initial Email Config
INSERT INTO public.system_config (config_key, config_value)
VALUES ('email_settings', '{
  "host": "smtp.gmail.com",
  "port": 587,
  "user": "your-email@gmail.com",
  "pass": "your-app-password",
  "from": "FitOps Welcome <no-reply@fitops.com>",
  "enabled": true
}');

-- =============================================================
-- Indexes for performance and uniqueness enforcement
-- =============================================================

CREATE INDEX idx_clients_username ON public.clients(username);
CREATE INDEX idx_clients_business_code ON public.clients(business_code);
CREATE INDEX idx_clients_referral_code ON public.clients(referral_code);
CREATE INDEX idx_subscriptions_client_id ON public.client_subscriptions(client_id);
CREATE INDEX idx_subscriptions_plan_id ON public.client_subscriptions(plan_id);
CREATE INDEX idx_payments_client_id ON public.payments(client_id);
CREATE INDEX idx_wallet_txn_client_id ON public.wallet_transactions(client_id);
CREATE INDEX idx_login_audit_client_id ON public.login_audit(client_id);
CREATE INDEX idx_api_keys_client_id ON public.client_api_keys(client_id);

-- =============================================================
-- Trigger to automatically set default expiry_date on new client if not provided
-- =============================================================
CREATE OR REPLACE FUNCTION public.set_default_expiry()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.expiry_date IS NULL THEN
    NEW.expiry_date := NOW() + INTERVAL '15 days';   -- default free trial
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_set_default_expiry
BEFORE INSERT ON public.clients
FOR EACH ROW EXECUTE FUNCTION public.set_default_expiry();

-- =============================================================
-- End of additional schema additions
-- =============================================================
