'use strict';
// Local development runner (npm run dev). On Netlify the app runs as a function instead.
const express = require('express');
const path = require('path');
const app = require('./lib/app');
const root = express();
root.use(app);
root.use(express.static(path.join(__dirname, 'public')));
const port = process.env.PORT || 3000;
root.listen(port, () => console.log('Listening on http://localhost:' + port));
