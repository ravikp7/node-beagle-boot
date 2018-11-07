const claimInterface = require('./claim-interface');
const setupEndpoints = require('./setup-endpoints');

module.exports = Object.assign({}, claimInterface, setupEndpoints);