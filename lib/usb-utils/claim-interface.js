const constants = require('../constants');
const platform = require('os').platform();

exports.claimInterface = (server, emitterMod) => {
  try {
    let interfaceNumber = 1; // Interface for data transfer

    // Claim all interfaces of LINUX_COMPOSITE_DEVICE except Mass Stoarge (Interface 7)
    if (server.foundDevice === constants.LINUX_COMPOSITE_DEVICE) {
      [0, 1, 2, 3, 4, 5].forEach((i) => {
        const devInt = server.device.interface(i);
        if (platform != 'win32') {
          if (devInt && devInt.isKernelDriverActive()) {
            devInt.detachKernelDriver();
          }
        }
        devInt.claim();
      });
      interfaceNumber = 3; // Change interface for LINUX_COMPOSITE_DEVICE (CDC ECM Data Interface)
    }

    server.deviceInterface = server.device.interface(interfaceNumber); // Select interface for BULK transfers
    if (platform != 'win32') { // Not supported in Windows
      // Detach Kernel Driver
      if (server.deviceInterface && server.deviceInterface.isKernelDriverActive()) {
        server.deviceInterface.detachKernelDriver();
      }
    }
    server.deviceInterface.claim();
  } catch (err) {
    emitterMod.emit('error', `Can't claim interface ${err}`);
    return;
  }
};