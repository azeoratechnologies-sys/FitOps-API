const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

router.post('/check-unique', authController.checkUnique);
router.post('/register', authController.registerUser);
router.post('/login', authController.loginUser);
router.get('/config/country-rules', authController.getCountryRules);
router.get('/subscription/:clientId', authController.getSubscription);
router.post('/admin/renew', authController.adminRenew);

module.exports = router;
