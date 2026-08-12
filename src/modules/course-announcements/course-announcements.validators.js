'use strict';

const { body } = require('express-validator');

exports.create = [
  body('body').trim().notEmpty(),
];
