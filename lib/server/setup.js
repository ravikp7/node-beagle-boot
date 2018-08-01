const ROM_VID = 0x0451;
const ROM_PID = 0x6141;
const SPL_VID = 0x0451;
const SPL_PID = 0xd022;
const LINUX_COMPOSITE_DEVICE_VID = 0x1d6b;
const LINUX_COMPOSITE_DEVICE_PID = 0x0104;

const usb = require('usb');
const constants = require('../constants');

module.exports.setup = (device, serverConfigs, emitterMod, transfer) => {
  let foundDevice;
  switch (device) {
    case usb.findByIds(ROM_VID, ROM_PID):
      foundDevice = constants.ROM;
      break;
    case usb.findByIds(SPL_VID, SPL_PID):
      foundDevice = (device.deviceDescriptor.bNumConfigurations == 2) ? constants.SPL : constants.UMS;
      break;
    case usb.findByIds(LINUX_COMPOSITE_DEVICE_VID, LINUX_COMPOSITE_DEVICE_PID):
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