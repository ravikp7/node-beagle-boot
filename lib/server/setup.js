const usb = require('usb');
const constants = require('../constants');

module.exports.setup = (device, serverConfigs, emitterMod, transfer) => {
  let foundDevice;
  switch (device) {
    case usb.findByIds(constants.ROM_VID, constants.ROM_PID):
      foundDevice = constants.ROM;
      break;
    case usb.findByIds(constants.SPL_VID, constants.SPL_PID):
      foundDevice = (device.deviceDescriptor.bNumConfigurations == 2) ? constants.SPL : constants.UMS;
      break;
    case usb.findByIds(constants.LINUX_COMPOSITE_DEVICE_VID, constants.LINUX_COMPOSITE_DEVICE_PID):
      foundDevice = constants.LINUX_COMPOSITE_DEVICE;
      break;
    default:
      foundDevice = `Device ${device.deviceDescriptor}`;
  }
  emitterMod.emit('connect', foundDevice);

  // Setup servers
  serverConfigs.forEach((serverConfig) => {
    if (device === usb.findByIds(serverConfig.vid, serverConfig.pid) && foundDevice != constants.UMS) {
      serverConfig.device = device;
      serverConfig.foundDevice = foundDevice;
      const timeout = (foundDevice == constants.SPL) ? 500 : 0;
      setTimeout(() => {
        transfer(serverConfig);
      }, timeout);
    }
  });
  return foundDevice;
};