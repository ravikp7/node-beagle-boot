const rndisUtils = require('./rndis_utils');

// Initialize RNDIS device on Windows and OSX
module.exports = (server, emitterMod) => {
  const RNDIS_INIT_SIZE = 24;
  const RNDIS_SET_SIZE = 28;
 // const rndis_buf = Buffer.alloc(CONTROL_BUFFER_SIZE);
  const init_msg_rndis_buf = Buffer.alloc(24);
  const init_msg = rndisUtils.make_rndis_init();
  init_msg.copy(init_msg_rndis_buf, 0, 0, RNDIS_INIT_SIZE);
  const intf0 = server.device.interface(0); // Select interface 0 for CONTROL transfer
  intf0.claim();
  // Windows Control Transfer
  // https://msdn.microsoft.com/en-us/library/aa447434.aspx
  // http://www.beyondlogic.org/usbnutshell/usb6.shtml
  const bmRequestType_send = 0x21; // USB_TYPE=CLASS | USB_RECIPIENT=INTERFACE
  const bmRequestType_receive = 0xA1; // USB_DATA=DeviceToHost | USB_TYPE=CLASS | USB_RECIPIENT=INTERFACE
  
  if(server.foundDevice==='SPL'){
    var iEndpoint = intf0.endpoint(intf0.endpoints[0].address);
    iEndpoint.startPoll(1,256);
  }
  // Sending rndis_init_msg (SEND_ENCAPSULATED_COMMAND)
  server.device.controlTransfer(bmRequestType_send, 0, 0, 0, init_msg_rndis_buf, () => {
    // This error doesn't affect the functionality, so ignoring
    //if(error) emitterMod.emit('error', "Control transfer error on SEND_ENCAPSULATED " +error);
  });

  // Receive rndis_init_cmplt (GET_ENCAPSULATED_RESPONSE)
  server.device.controlTransfer(bmRequestType_receive, 0x01, 0, 0, 1025, (error) => {
    if (error) emitterMod.emit('error', `Control transfer error on GET_ENCAPSULATED ${error}`);
  });

  const set_msg_rndis_buf = Buffer.alloc(32);
  const set_msg = rndisUtils.make_rndis_set();
  set_msg.copy(set_msg_rndis_buf, 0, 0, RNDIS_SET_SIZE + 4);

  // Send rndis_set_msg (SEND_ENCAPSULATED_COMMAND)
  server.device.controlTransfer(bmRequestType_send, 0, 0, 0, set_msg_rndis_buf, () => {
    // This error doesn't affect the functionality, so ignoring
    //if(error) emitterMod.emit('error', "Control transfer error on SEND_ENCAPSULATED " +error);
  });

  // Receive rndis_init_cmplt (GET_ENCAPSULATED_RESPONSE)
  server.device.controlTransfer(bmRequestType_receive, 0x01, 0, 0, 1025, (error) => {
    if (error) emitterMod.emit('error', `Control transfer error on GET_ENCAPSULATED ${error}`);
  });
};