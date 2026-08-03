'use strict';

const app = require('./src/app');
const config = require('./src/config');

const port = parseInt(process.env.PORT, 10) || config.port || 5000;

const server = app.listen(port, () => {
  console.log(`Bedo SimuLearn API listening on port ${port} in ${config.env} mode`);
});

server.on('error', (error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});
