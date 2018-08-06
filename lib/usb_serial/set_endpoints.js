const constants = require('../constants');
const EventEmitter = require('events').EventEmitter;
const serial = new EventEmitter();

module.exports = (serverConfigs) => {
  const cdcDataInterface = serverConfigs.device.interfaces[5];

  const inEndpoint = cdcDataInterface.endpoint(cdcDataInterface.endpoints[0].address);
  const outEndpoint = cdcDataInterface.endpoint(cdcDataInterface.endpoints[1].address);

  inEndpoint.startPoll(1, constants.MAXBUF);
  inEndpoint.on('data', (data) => {
    serial.emit('data', data);
  });
  inEndpoint.on('error', (error) => {
    serial.emit('error', error);
  });

  serial.on('send', (data) => {
    outEndpoint.transfer(data, (error) => {
      if (error) serial.emit('error', error);
    });
  });
  return serial;
};