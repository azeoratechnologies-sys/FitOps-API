const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'FitOps Subscription API',
      version: '1.0.0',
      description: 'API for FitOps Cloud Subscription and Multi-tenant management',
    },
    servers: [
      {
        url: 'https://v4xm2ks2-8081.inc1.devtunnels.ms',
        description: 'Dev Tunnel server',
      },
      {
        url: 'http://localhost:8081',
        description: 'Development server',
      },
    ],
  },
  apis: ['./src/controllers/*.js'], // Path to the API docs
};

const specs = swaggerJsdoc(options);

module.exports = {
  specs,
  swaggerUi,
};
