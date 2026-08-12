/**
 * OpenAPI 3.0 / Swagger configuration.
 * SRS refs: §4.16 API-01 — "API follows OpenAPI 3.0 spec; Swagger UI at /api/docs"
 * NFR-08: All API endpoints documented in OpenAPI 3.0.
 */
'use strict';

const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Bedo SimuLearn LMS API',
      version: '1.0.0',
      description:
        'REST API for the Bedo SimuLearn simulation-based Learning Management System. ' +
        'All endpoints are prefixed with /api/v1. ' +
        'Authentication via Bearer JWT unless marked [Public]. ' +
        'Errors follow RFC 7807 Problem Details format.',
      contact: { name: 'Bedo SimuLearn Engineering' },
    },
    servers: [
      { url: '/api/v1', description: 'Current version' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  // Scan all route files for @swagger JSDoc annotations
  apis: ['./src/modules/**/*.routes.js'],
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;
