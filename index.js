const serverless = require('serverless-http');
const express = require('express');
var bodyParser = require('body-parser');
var routes = require('./routes/routes.js');
const app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

routes(app);

module.exports.handler = serverless(app);

// USE THIS FOR LOCAL SERVER
// var server = app.listen(3000, function () {
//     console.log("app running on port.", server.address().port);
// });
