require('dotenv').config();
const express = require('express');
const cors = require('cors');
const apiRoutes = require('./routes/api');
const { specs, swaggerUi } = require('./swagger');

const app = express();
const PORT = process.env.PORT || 8081;

app.use(cors());
app.use(express.json());

// API Routes
app.use('/api', apiRoutes);

// Swagger Documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));

app.get('/', (req, res) => {
  res.send('FitOps Subscription Backend is running. Visit /api-docs for documentation.');
});

const { sendWelcomeEmail } = require('./config/emailService');

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log(`Swagger docs available at http://localhost:${PORT}/api-docs`);
  
  // Startup Check: Verify Email Configuration
  console.log('Checking Email Configuration...');
  await sendWelcomeEmail('test@fitops.com', 'Startup Check');
});
