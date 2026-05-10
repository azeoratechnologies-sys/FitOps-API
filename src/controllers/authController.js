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
    username, password, referralCode, deviceId
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
      p_referral_code: referralCode,
      p_device_id: deviceId
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
    // We'll use the client_login RPC for secure authentication and device locking
    // Note: client_login expects a password_hash, but we are using bcrypt in JS.
    // However, the database setup usually has its own hashing or expects the hash.
    // In this specific system, the JS controller handles bcrypt.
    
    // Step 1: Find the user first to get the hash
    const { data: user, error: userError } = await supabase
      .from('clients')
      .select('*')
      .or(`username.eq.${username},mobile_no.eq.${username}`)
      .single();

    if (userError || !user) {
      await supabase.from('failed_logins').insert({ ip_address: ip });
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Step 2: Verify password via bcrypt
    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      await supabase.from('failed_logins').insert({ 
        client_id: user.client_id, 
        ip_address: ip 
      });
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Step 3: Now use the client_login RPC (or a simplified version) to verify Device ID
    const { data: authResult, error: authError } = await supabase.rpc('client_login', {
      p_username: username,
      p_password_hash: user.password_hash, // Passing the hash because it matches what's in DB
      p_device_id: deviceId
    });

    if (authError) throw authError;

    if (authResult.success === false) {
      return res.status(403).json({ error: authResult.message });
    }

    // 4. Log Successful Login Audit
    await supabase.from('login_audit').insert({
      client_id: user.client_id,
      ip_address: ip,
      user_agent: req.headers['user-agent'],
      device_id: deviceId
    });

    res.json({ success: true, user: user });
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
 *     parameters:
 *       - in: path
 *         name: clientId
 *         required: true
 *         schema:
 *           type: integer
 *         description: The unique ID of the client
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       404:
 *         description: Not Found
 *       500:
 *         description: Server Error
 */
async function getSubscription(req, res) {
  const { clientId } = req.params;
  try {
    // 1. Fetch Client Basic Info
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .select('client_id, business_code, business_name, expiry_date, wallet_balance, register_date')
      .eq('client_id', clientId)
      .single();

    if (clientErr) throw clientErr;

    // 2. Fetch Active Subscription (Don't use .single() to avoid 404 if no sub exists)
    const { data: subs, error: subErr } = await supabase
      .from('client_subscriptions')
      .select('*, subscription_plans(*)')
      .eq('client_id', clientId)
      .eq('is_active', true)
      .order('expiry_date', { ascending: false })
      .limit(1);

    const sub = (subs && subs.length > 0) ? subs[0] : null;

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
      paymentHistory: payments || [],
      walletHistory: wallet || []
    });
  } catch (error) {
    console.error('Subscription Fetch Error:', error);
    res.status(500).json({ error: error.message || 'Server error fetching subscription' });
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
    
    // Update clients table with new expiry date
    if (data) {
      await supabase.from('clients').update({ expiry_date: data }).eq('client_id', clientId);
    }

    res.json({ success: true, newExpiry: data });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
}

async function getPlans(req, res) {
  const { country } = req.query;
  try {
    let query = supabase
      .from('subscription_plans')
      .select('*')
      .eq('is_active', true)
      .is('deleted_at', null);

    if (country) {
      query = query.eq('country', country);
    }

    const { data, error } = await query.order('duration_days', { ascending: true });

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function createLead(req, res) {
  try {
    const { data, error } = await supabase
      .from('leads')
      .insert([req.body])
      .select();

    if (error) throw error;
    res.json({ success: true, data: data[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// --- Suggestions Logic ---

async function submitSuggestion(req, res) {
  try {
    const { clientId, suggestionText } = req.body;
    const { data, error } = await supabase
      .from('client_suggestions')
      .insert([{ client_id: clientId, suggestion_text: suggestionText }])
      .select();

    if (error) throw error;
    res.json({ success: true, data: data[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function getClientSuggestions(req, res) {
  try {
    const { clientId } = req.params;
    const { data, error } = await supabase
      .from('client_suggestions')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function getAllSuggestions(req, res) {
  try {
    const { data, error } = await supabase
      .from('client_suggestions')
      .select('*, clients(business_name, mobile_no)')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function replyToSuggestion(req, res) {
  try {
    const { id } = req.params;
    const { replyText } = req.body;
    const { data, error } = await supabase
      .from('client_suggestions')
      .update({ 
        reply_text: replyText, 
        status: 'REPLIED', 
        replied_at: new Date().toISOString() 
      })
      .eq('id', id)
      .select();

    if (error) throw error;
    res.json({ success: true, data: data[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

module.exports = {
  checkUnique,
  registerUser,
  loginUser,
  getSubscription,
  getCountryRules,
  adminRenew,
  getPlans,
  createLead,
  submitSuggestion,
  getClientSuggestions,
  getAllSuggestions,
  replyToSuggestion
};
