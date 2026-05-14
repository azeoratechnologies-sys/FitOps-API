const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

router.post('/check-unique', authController.checkUnique);
router.post('/register', authController.registerUser);
router.post('/login', authController.loginUser);
router.get('/config/country-rules', authController.getCountryRules);
router.get('/subscription/:clientId', authController.getSubscription);
router.post('/admin/renew', authController.adminRenew);

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
