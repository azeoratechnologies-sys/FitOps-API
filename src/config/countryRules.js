const COUNTRY_RULES = {
  'India': {
    currencyCode: 'INR',
    currencySymbol: '₹',
    mobileRegex: '^[6-9]\\d{9}$',
    mobilePrefix: '+91',
    mobileExample: '9876543210'
  },
  'USA': {
    currencyCode: 'USD',
    currencySymbol: '$',
    mobileRegex: '^\\d{10}$',
    mobilePrefix: '+1',
    mobileExample: '2025550123'
  },
  'UK': {
    currencyCode: 'GBP',
    currencySymbol: '£',
    mobileRegex: '^7\\d{9}$',
    mobilePrefix: '+44',
    mobileExample: '7123456789'
  },
  'UAE': {
    currencyCode: 'AED',
    currencySymbol: 'د.إ',
    mobileRegex: '^5\\d{8}$',
    mobilePrefix: '+971',
    mobileExample: '501234567'
  }
};

module.exports = { COUNTRY_RULES };
