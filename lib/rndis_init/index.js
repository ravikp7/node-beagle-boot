const rndisUtils = require('./rndis_utils');
const constants = require('../constants');

// Initialize RNDIS device on Windows and OSX
module.exports = (server, emitterMod) => {
  const CONTROL_BUFFER_SIZE = 1025;
  const init_msg = rndisUtils.make_rndis_init();  // RNDIS INIT Message
  const intf0 = server.device.interface(0); // Select interface 0 for CONTROL transfer
  intf0.claim();
  // Windows Control Transfer
  // https://msdn.microsoft.com/en-us/library/aa447434.aspx
  // http://www.beyondlogic.org/usbnutshell/usb6.shtml
  const bmRequestType_send = 0x21; // USB_TYPE=CLASS | USB_RECIPIENT=INTERFACE
  const bmRequestType_receive = 0xA1; // USB_DATA=DeviceToHost | USB_TYPE=CLASS | USB_RECIPIENT=INTERFACE

  const iEndpoint = intf0.endpoint(intf0.endpoints[0].address);
  iEndpoint.on('error', (error) => {
    console.log(error);
  });
  iEndpoint.startPoll(1, 256);
  // Sending rndis_init_msg (SEND_ENCAPSULATED_COMMAND)
  server.device.controlTransfer(bmRequestType_send, 0, 0, 0, init_msg, (error) => {
    if (error) emitterMod.emit('error', `Control transfer error on SEND_ENCAPSULATED ${error}`);
  });

  // Receive rndis_init_cmplt (GET_ENCAPSULATED_RESPONSE)
  server.device.controlTransfer(bmRequestType_receive, 0x01, 0, 0, CONTROL_BUFFER_SIZE, (error) => {
    if (error) emitterMod.emit('error', `Control transfer error on GET_ENCAPSULATED ${error}`);
  });

  const set_msg = rndisUtils.make_rndis_set();  // RNDIS SET Message

  // Send rndis_set_msg (SEND_ENCAPSULATED_COMMAND)
  server.device.controlTransfer(bmRequestType_send, 0, 0, 0, set_msg, (error) => {
    if (error) emitterMod.emit('error', `Control transfer error on SEND_ENCAPSULATED ${error}`);
  });

  // Receive rndis_init_cmplt (GET_ENCAPSULATED_RESPONSE)
  server.device.controlTransfer(bmRequestType_receive, 0x01, 0, 0, CONTROL_BUFFER_SIZE, (error) => {
    if (error) emitterMod.emit('error', `Control transfer error on GET_ENCAPSULATED ${error}`);
  });
  return iEndpoint;
};