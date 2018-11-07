const constants = require('../constants');

exports.setupEndpoints = (server, emitterMod) => {
  try {
    // Set endpoints for usb transfer
    server.inEndpoint = server.deviceInterface.endpoint(server.deviceInterface.endpoints[0].address);
    server.outEndpoint = server.deviceInterface.endpoint(server.deviceInterface.endpoints[1].address);
  } catch (err) {
    emitterMod.emit('error', `Interface disappeared: ${err}`);
    return;
  }

  // Start polling the In Endpoint for transfers
  server.inEndpoint.startPoll(1, constants.MAXBUF);
};