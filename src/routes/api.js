const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

const paymentController = require('../controllers/paymentController');

router.post('/check-unique', authController.checkUnique);
router.post('/register', authController.registerUser);
router.post('/login', authController.loginUser);
router.get('/config/country-rules', authController.getCountryRules);
router.get('/config/support', authController.getSupportConfig);
router.get('/config/versions/:platform', authController.getAppVersionByPlatform);
router.get('/subscription/:clientId', authController.getSubscription);
router.post('/admin/renew', authController.adminRenew);

// Payments
router.post('/payments/renew', paymentController.renewAfterPayment);
router.get('/payments/config', paymentController.getPaymentConfig);
router.post('/payments/validate-coupon', paymentController.validateCoupon);

// Plans
router.get('/plans', authController.getPlans);

// Leads
router.post('/leads', authController.createLead);

// Suggestions
router.post('/suggestions', authController.submitSuggestion);
router.get('/suggestions/:clientId', authController.getClientSuggestions);
router.get('/admin/suggestions', authController.getAllSuggestions);
router.post('/admin/suggestions/:id/reply', authController.replyToSuggestion);
router.post('/clients/:id/last-usage', authController.updateLastUsage);

module.exports = router;
