const proxyUtils = require('./proxy-utils');
const processIn = require('./process-in');
const processOut = require('./process-out');
const configure = require('./configure');

module.exports = Object.assign({}, proxyUtils, processIn, processOut, configure);