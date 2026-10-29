'use strict';
const express = require('express');
const serverless = require('serverless-http');
const app = require('../../lib/app');

const wrapper = express();
wrapper.use(app.normalize);
wrapper.use(app);
exports.handler = serverless(wrapper, { binary: ['application/pdf'] });
