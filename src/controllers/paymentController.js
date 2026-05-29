const supabase = require('../config/supabase');
const { sendRenewalEmail } = require('../config/emailService');

/**
 * Payment Controller handles direct Subscription renewal after successful payment
 */

async function renewAfterPayment(req, res) {
  const { clientId, planId, paymentId, couponId } = req.body;

  try {
    console.log(`Renewing subscription for Client ${clientId}, Plan ${planId}, Payment ${paymentId}, Coupon ${couponId || 'NONE'}`);

    // Call Supabase RPC to renew subscription
    // The RPC handles: updating expiry_date, recording payment, setting is_trial=false, and applying coupon
    const { data: newExpiry, error: renewError } = await supabase.rpc('renew_subscription', {
      p_client_id: clientId,
      p_plan_id: planId,
      p_payment_mode: 'ONLINE_RAZORPAY',
      p_transaction_ref: paymentId,
      p_coupon_id: couponId || null
    });

    if (renewError) throw renewError;

    // Update the clients table expiry_date (if RPC doesn't do it directly)
    await supabase.from('clients').update({ expiry_date: newExpiry }).eq('client_id', clientId);

    res.json({
      success: true,
      message: 'Subscription renewed successfully',
      newExpiry: newExpiry
    });

    // 4. Send Renewal Email (Non-blocking)
    try {
      const { data: client } = await supabase.from('clients').select('email, business_name').eq('client_id', clientId).single();
      const { data: plan } = await supabase.from('subscription_plans').select('plan_name').eq('plan_id', planId).single();
      
      if (client && client.email) {
        sendRenewalEmail(
          client.email, 
          client.business_name, 
          plan ? plan.plan_name : 'Subscription Plan', 
          newExpiry
        );
      }
    } catch (e) {
      console.error('Failed to trigger renewal email:', e.message);
    }

  } catch (error) {
    console.error('Renewal Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
}

async function getPaymentConfig(req, res) {
  try {
    const { data: gateway, error } = await supabase
      .from('merchant_gateways')
      .select('key_id, key_secret')
      .eq('gateway_name', 'RAZORPAY')
      .eq('is_active', true)
      .single();

    if (error || !gateway) {
      return res.status(404).json({ error: 'Razorpay configuration not found' });
    }

    res.json({
      razorpayKey: gateway.key_id,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function validateCoupon(req, res) {
  const { couponCode, clientId } = req.body;
  
  try {
    // 1. Find coupon
    const { data: coupon, error: couponError } = await supabase
      .from('coupons')
      .select('*')
      .eq('coupon_code', couponCode.toUpperCase())
      .eq('is_active', true)
      .single();

    if (couponError || !coupon) {
      return res.status(404).json({ success: false, error: 'Invalid coupon code' });
    }

    // 2. Check date validity
    const now = new Date();
    if (now < new Date(coupon.valid_from) || now > new Date(coupon.valid_to)) {
      return res.status(400).json({ success: false, error: 'Coupon is expired or not yet active' });
    }

    // 3. Check for previous usage
    const { data: usage, error: usageError } = await supabase
      .from('coupon_usage')
      .select(' usage_id')
      .eq('client_id', clientId)
      .eq('coupon_id', coupon.coupon_id);

    if (usage && usage.length > 0) {
      return res.status(400).json({ success: false, error: 'Coupon already utilized by this user' });
    }

    res.json({
      success: true,
      couponId: coupon.coupon_id,
      discountType: coupon.discount_type,
      discountValue: coupon.discount_value
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}

module.exports = {
  renewAfterPayment,
  getPaymentConfig,
  validateCoupon
};
