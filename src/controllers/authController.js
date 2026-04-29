const supabase = require('../config/supabase');
const bcrypt = require('bcryptjs');

/**
 * @swagger
 * /api/check-unique:
 *   post:
 *     summary: Check uniqueness of mobile, email, or username
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               mobileNo:
 *                 type: string
 *               email:
 *                 type: string
 *               username:
 *                 type: string
 *     responses:
 *       200:
 *         description: Conflict status
 */
async function checkUnique(req, res) {
  const { mobileNo, email, username } = req.body;
  try {
    const { data, error } = await supabase.from('clients').select('mobile_no, email, username');
    if (error) throw error;

    const conflicts = {
      mobileNo: data.some(c => c.mobile_no === mobileNo),
      email: data.some(c => c.email === email),
      username: data.some(c => c.username === username)
    };

    res.json({ conflicts });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

/**
 * @swagger
 * /api/register:
 *   post:
 *     summary: Register a new business client
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - businessName
 *               - mobileNo
 *               - email
 *               - username
 *               - password
 *             properties:
 *               businessName: { type: string }
 *               storeName: { type: string }
 *               gstTaxNumber: { type: string }
 *               mobileNo: { type: string }
 *               email: { type: string }
 *               address: { type: string }
 *               country: { type: string }
 *               username: { type: string }
 *               password: { type: string }
 *     responses:
 *       200:
 *         description: Successfully registered
 */
const { COUNTRY_RULES } = require('../config/countryRules');

/**
 * @swagger
 * /api/config/country-rules:
 *   get:
 *     summary: Get country-specific validation rules and currency info
 *     tags: [Config]
 *     responses:
 *       200:
 *         description: Config returned successfully
 */
async function getCountryRules(req, res) {
  res.json(COUNTRY_RULES);
}

const { sendWelcomeEmail } = require('../config/emailService');

async function registerUser(req, res) {
  const {
    businessName, storeName, gstTaxNumber,
    mobileNo, email, address, country,
    username, password, referralCode
  } = req.body;

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const { data, error } = await supabase.rpc('register_client', {
      p_business_name: businessName,
      p_store_name: storeName,
      p_gst_tax_number: gstTaxNumber,
      p_mobile_no: mobileNo,
      p_email: email,
      p_address: address,
      p_country: country,
      p_username: username,
      p_password_hash: hashedPassword,
      p_referral_code: referralCode
    });

    if (error) throw error;

    // Fetch the generated business code for the new client
    const { data: newClient } = await supabase
      .from('clients')
      .select('business_code')
      .eq('client_id', data)
      .single();

    // Send Real Welcome Email
    await sendWelcomeEmail(email, businessName);

    res.json({ 
      success: true, 
      clientId: data, 
      businessCode: newClient ? newClient.business_code : null 
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
}

/**
 * @swagger
 * /api/login:
 *   post:
 *     summary: Login for clients
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - password
 *             properties:
 *               username: { type: string }
 *               password: { type: string }
 *     responses:
 *       200:
 *         description: Login successful
 */
async function loginUser(req, res) {
  const { username, password, deviceId, platform } = req.body;
  const ip = req.ip || req.headers['x-forwarded-for'];

  try {
    const { data, error } = await supabase
      .from('clients')
      .select('*')
      .eq('username', username)
      .single();

    if (error || !data) {
      // Log failure (client_id unknown)
      await supabase.from('failed_logins').insert({ ip_address: ip });
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const isValid = await bcrypt.compare(password, data.password_hash);
    
    if (!isValid) {
      // Log failure
      await supabase.from('failed_logins').insert({ 
        client_id: data.client_id, 
        ip_address: ip 
      });
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // 1. Log Successful Login
    await supabase.from('login_audit').insert({
      client_id: data.client_id,
      ip_address: ip,
      user_agent: req.headers['user-agent'],
      device_id: deviceId
    });

    // 2. Track Device (for single device rule)
    if (deviceId) {
      await supabase.from('client_devices').upsert({
        client_id: data.client_id,
        device_token: deviceId,
        platform: platform || 'mobile',
        last_seen: new Date()
      }, { onConflict: 'device_token' });
    }

    res.json({ success: true, user: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

/**
 * @swagger
 * /api/subscription/{clientId}:
 *   get:
 *     summary: Get subscription details for a client
 *     tags: [Subscription]
 */
async function getSubscription(req, res) {
  const { clientId } = req.params;
  try {
    // 1. Fetch Client Basic Info
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .select('client_id, business_code, business_name, expiry_date, wallet_balance, created_at')
      .eq('client_id', clientId)
      .single();

    if (clientErr) throw clientErr;

    // 2. Fetch Active Subscription
    const { data: sub } = await supabase
      .from('client_subscriptions')
      .select('*, subscription_plans(*)')
      .eq('client_id', clientId)
      .eq('is_active', true)
      .order('expiry_date', { ascending: false })
      .limit(1)
      .single();

    // 3. Fetch Recent Payments
    const { data: payments } = await supabase
      .from('payments')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(5);

    // 4. Fetch Wallet History
    const { data: wallet } = await supabase
      .from('wallet_transactions')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(5);

    res.json({
      client,
      activeSubscription: sub,
      paymentHistory: payments,
      walletHistory: wallet
    });
  } catch (error) {
    res.status(404).json({ error: 'Client or Subscription not found' });
  }
}

/**
 * @swagger
 * /api/admin/renew:
 *   post:
 *     summary: Manually renew a subscription (Admin Only)
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - clientId
 *               - months
 *             properties:
 *               clientId: { type: integer }
 *               months: { type: integer }
 *               transactionRef: { type: string }
 *     responses:
 *       200:
 *         description: Renewal successful
 */
async function adminRenew(req, res) {
  const { clientId, months, transactionRef } = req.body;
  try {
    const { data, error } = await supabase.rpc('renew_subscription', {
      p_client_id: clientId,
      p_months: months,
      p_tx_ref: transactionRef
    });

    if (error) throw error;
    res.json({ success: true, newExpiry: data });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
}

module.exports = {
  checkUnique,
  registerUser,
  loginUser,
  getSubscription,
  getCountryRules,
  adminRenew
};
