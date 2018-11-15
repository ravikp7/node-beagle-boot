const usb = require('usb');
const protocols = require('./lib/protocols');
const EventEmitter = require('events').EventEmitter;
const emitter = new EventEmitter();
const fs = require('fs');
const path = require('path');
const cap = require('cap').Cap;
const os = require('os');
const platform = os.platform();
const rndisInit = require('./lib/rndis_init');
const emitterMod = new EventEmitter(); // Emitter for module status
const capture = new cap();
const proxy = require('./lib/proxy');
const identifyRequest = require('./lib/identifyRequest');
const constants = require('./lib/constants');
const usbUtils = require('./lib/usb-utils');
const server = require('./lib/server');
const serial = require('./lib/usb_serial');

const proxyConfig = {
  Host: {},
  BB: {},
  ProxyIp: [],
  ArpList: {},
  ActiveInterface: {}
};

const progress = {
  percent: 0, // Percentage for progress
  increment: 5
};

// Set usb debug log
//usb.setDebugLevel(4);   

// TFTP serverConfig for USB Mass Storage, binaries must be placed in 'bin/'
exports.usbMassStorage = () => {
  return exports.serveClient([{
    vid: constants.ROM_VID,
    pid: constants.ROM_PID,
    bootpFile: 'u-boot-spl.bin'
  }, {
    vid: constants.SPL_VID,
    pid: constants.SPL_PID,
    bootpFile: 'u-boot.img'
  }]);
};

// Proxy Server for Linux Composite Device
exports.proxyServer = () => {
  return exports.serveClient([{
    vid: constants.LINUX_COMPOSITE_DEVICE_VID,
    pid: constants.LINUX_COMPOSITE_DEVICE_PID
  }]);
};

// Configuring Server to serve Client
exports.serveClient = (serverConfigs) => {
  let foundDevice;
  progress.increment = (100 / (serverConfigs.length * 10));
  usb.on('attach', (device) => {
    foundDevice = server.setup(device, serverConfigs, emitterMod, runServer);
  });

  // USB detach
  usb.on('detach', () => {
    emitterMod.emit('disconnect', foundDevice);
  });

  // Configure Proxy Server for Linux Composite Device
  if (serverConfigs[0].vid === constants.LINUX_COMPOSITE_DEVICE_VID && serverConfigs[0].pid === constants.LINUX_COMPOSITE_DEVICE_PID) {
    proxy.configure(proxyConfig, emitterMod, (proxyIp) => {
      console.log(`Using Proxy IP Address: ${proxyIp}`);
    });
  }
  return emitterMod; // Event Emitter for progress
};

// Function for opening device
const runServer = (serverConfig) => {
  if (serverConfig.foundDevice == constants.ROM) progress.percent = progress.increment;
  updateProgress(`${serverConfig.foundDevice} ->`);
  try {
    serverConfig.device.open();
    onOpen(serverConfig);
  } catch (ex) {
    emitterMod.emit('error', `Can't open device ${ex}`);
  }
};

// Function after opeing device
const onOpen = (serverConfig) => {

  // Initialize RNDIS device on Windows and OSX
  if (platform != 'linux' && (serverConfig.foundDevice === constants.ROM || serverConfig.foundDevice === constants.SPL)) {
    rndisInit(serverConfig, emitterMod);
  }
  usbUtils.claimInterface(serverConfig, emitterMod); // Claim USB interfaces
  updateProgress('Interface claimed');

  // For Proxy Server
  if (serverConfig.foundDevice === constants.LINUX_COMPOSITE_DEVICE) {
    serial.configureNet(serverConfig, proxyConfig);  // Configure Network over USB serial

    // Initialize the CDC ECM interface for Networking and expose Endpoints to interface
    serverConfig.deviceInterface.setAltSetting(1, (error) => {
      if (error) emitterMod.emit('error', `Can't initilaize CDC ECM for Networking: ${error}`);
      else {
        usbUtils.setupEndpoints(serverConfig, emitterMod); // Setup USB Interface endpoints

        // Setup Network Capture
        const captureDevice = cap.findDevice(proxyConfig.ActiveInterface.ip_address);
        const filter = '';
        const bufSize = 10 * 1024 * 1024;
        let buffer = Buffer.alloc(65535);
        capture.open(captureDevice, filter, bufSize, buffer);

        capture.on('packet', () => {
          proxy.processIn(serverConfig, capture, buffer, proxyConfig, emitter);
        });
        emitter.emit('inTransfer', serverConfig);
      }
    });
  }
  // For Bootloader Server
  else {
    usbUtils.setupEndpoints(serverConfig, emitterMod); // Setup USB Interface endpoints
    emitter.emit('inTransfer', serverConfig);
  }
};

// Event for inEnd transfer
emitter.on('inTransfer', (serverConfig) => {
  serverConfig.inEndpoint.on('data', (data) => {

    if (serverConfig.foundDevice === constants.LINUX_COMPOSITE_DEVICE) {
      proxy.processOut(serverConfig, capture, data, proxyConfig);
    }
    else {
      const request = identifyRequest(serverConfig, data);
      switch (request) {
        case 'unidentified':
          emitterMod.emit('error', `${request} packet type`);
          break;
        case 'TFTP':
          updateProgress('TFTP request recieved');
          emitter.emit('processTFTP', serverConfig, data);
          break;
        case 'BOOTP':
          updateProgress('BOOTP request recieved');
          emitter.emit('outTransfer', serverConfig, processBOOTP(serverConfig, data), request);
          break;
        case 'ARP':
          emitter.emit('outTransfer', serverConfig, processARP(serverConfig, data), request);
          break;
        case 'TFTP_Data':
          if (serverConfig.tftp.i <= serverConfig.tftp.blocks) { // Transfer until all blocks of file are transferred
            emitter.emit('outTransfer', serverConfig, processTFTP_Data(serverConfig), request);
          } else {
            updateProgress(`${serverConfig.foundDevice} TFTP transfer complete`);
            if (serverConfig.foundDevice === constants.ROM) serverConfig.device.close();
            serverConfig.inEndpoint.stopPoll();
          }
          break;
        case 'NC':
          emitter.emit('nc', serverConfig, data);
          break;
        default:
          console.log(request);
      }
    }
  });
  serverConfig.inEndpoint.on('error', (error) => {
    console.log(error);
  });
});


// Event for outEnd Transfer
emitter.on('outTransfer', (serverConfig, data, request) => {
  serverConfig.outEndpoint.transfer(data, (error) => {
    if (!error) {
      if (request == 'BOOTP') updateProgress(`${request} reply done`);
    }
  });
});

// Function to process BOOTP request
const processBOOTP = (serverConfig, data) => {
  const ether_buf = Buffer.alloc(constants.MAXBUF - constants.RNDIS_SIZE);
  const udp_buf = Buffer.alloc(constants.UDP_SIZE);
  const bootp_buf = Buffer.alloc(constants.BOOTP_SIZE);
  data.copy(udp_buf, 0, constants.RNDIS_SIZE + constants.ETHER_SIZE + constants.IPV4_SIZE, constants.MAXBUF);
  data.copy(bootp_buf, 0, constants.RNDIS_SIZE + constants.ETHER_SIZE + constants.IPV4_SIZE + constants.UDP_SIZE, constants.MAXBUF);
  data.copy(ether_buf, 0, constants.RNDIS_SIZE, constants.MAXBUF);
  serverConfig.ether = protocols.decode_ether(ether_buf); // Gets decoded ether packet data
  const udpUboot = protocols.parse_udp(udp_buf); // parsed udp header
  const bootp = protocols.parse_bootp(bootp_buf); // parsed bootp header
  const rndis = protocols.make_rndis(constants.FULL_SIZE - constants.RNDIS_SIZE);
  const eth2 = protocols.make_ether2(serverConfig.ether.h_source, serverConfig.ether.h_dest, constants.ETH_TYPE_IPV4);
  const ip = protocols.make_ipv4(constants.SERVER_IP, constants.BB_IP, constants.IP_UDP, 0, constants.IPV4_SIZE + constants.UDP_SIZE + constants.BOOTP_SIZE, 0);
  const udp = protocols.make_udp(constants.BOOTP_SIZE, udpUboot.udpDest, udpUboot.udpSrc);
  const bootreply = protocols.make_bootp(constants.SERVER_NAME, serverConfig.bootpFile, bootp.xid, serverConfig.ether.h_source, constants.BB_IP, constants.SERVER_IP);
  return Buffer.concat([rndis, eth2, ip, udp, bootreply], constants.FULL_SIZE);
};

// Function to process ARP request
const processARP = (serverConfig, data) => {
  const arp_buf = Buffer.alloc(constants.ARP_SIZE);
  data.copy(arp_buf, 0, constants.RNDIS_SIZE + constants.ETHER_SIZE, constants.RNDIS_SIZE + constants.ETHER_SIZE + constants.ARP_SIZE);
  serverConfig.receivedARP = protocols.parse_arp(arp_buf); // Parsed received ARP request
  const arpResponse = protocols.make_arp(2, serverConfig.ether.h_dest, serverConfig.receivedARP.ip_dest, serverConfig.receivedARP.hw_source, serverConfig.receivedARP.ip_source);
  const rndis = protocols.make_rndis(constants.ETHER_SIZE + constants.ARP_SIZE);
  const eth2 = protocols.make_ether2(serverConfig.ether.h_source, serverConfig.ether.h_dest, constants.ETH_TYPE_ARP);
  return Buffer.concat([rndis, eth2, arpResponse], constants.RNDIS_SIZE + constants.ETHER_SIZE + constants.ARP_SIZE);
};

// Event to process TFTP request
emitter.on('processTFTP', (serverConfig, data) => {
  const udpTFTP_buf = Buffer.alloc(constants.UDP_SIZE);
  data.copy(udpTFTP_buf, 0, constants.RNDIS_SIZE + constants.ETHER_SIZE + constants.IPV4_SIZE, constants.RNDIS_SIZE + constants.ETHER_SIZE + constants.IPV4_SIZE + constants.UDP_SIZE);
  serverConfig.tftp = {}; // Object containing TFTP parameters
  serverConfig.tftp.i = 1; // Keeps count of File Blocks transferred
  serverConfig.tftp.receivedUdp = protocols.parse_udp(udpTFTP_buf); // Received UDP packet for SPL tftp
  serverConfig.tftp.eth2 = protocols.make_ether2(serverConfig.ether.h_source, serverConfig.ether.h_dest, constants.ETH_TYPE_IPV4); // Making ether header here, as it remains same for all tftp block transfers
  const fileName = extractName(data);
  serverConfig.filePath = path.join('bin', fileName);
  updateProgress(`${fileName} transfer starts`);
  fs.readFile(serverConfig.filePath, (error, file_data) => {
    if (!error) {
      serverConfig.tftp.blocks = Math.ceil((file_data.length + 1) / 512); // Total number of blocks of file
      serverConfig.tftp.start = 0;
      serverConfig.tftp.fileData = file_data;
      emitter.emit('outTransfer', serverConfig, processTFTP_Data(serverConfig), 'TFTP');
    } else {
      emitter.emit('outTransfer', serverConfig, processTFTP_Error(serverConfig), 'TFTP');
      emitterMod.emit('error', `Error reading ${serverConfig.filePath}: ${error}`);
    }
  });
});

// Event for netconsole in
emitter.on('nc', (serverConfig, data) => {
  const nc_buf = Buffer.alloc(constants.MAXBUF);
  data.copy(nc_buf, 0, constants.RNDIS_SIZE + constants.ETHER_SIZE + constants.IPV4_SIZE + constants.UDP_SIZE, constants.MAXBUF);
  process.stdout.write(nc_buf.toString());
  if (!serverConfig.isNcActive) {
    serverConfig.isNcActive = true;
    emitterMod.emit('ncStarted', serverConfig);
  }
});

// Event for sending netconsole commands
emitterMod.on('ncin', (serverConfig, command) => {
  const data = Buffer.from(command);
  const blockSize = data.length;
  const ncStdinData = Buffer.alloc(blockSize);
  data.copy(ncStdinData, 0, 0, blockSize);
  const rndis = protocols.make_rndis(constants.ETHER_SIZE + constants.IPV4_SIZE + constants.UDP_SIZE + blockSize);
  const eth2 = protocols.make_ether2(serverConfig.ether.h_source, serverConfig.ether.h_dest, constants.ETH_TYPE_IPV4);
  const ip = protocols.make_ipv4(serverConfig.receivedARP.ip_dest, serverConfig.receivedARP.ip_source, constants.IP_UDP, 0, constants.IPV4_SIZE + constants.UDP_SIZE + blockSize, 0);
  const udp = protocols.make_udp(blockSize, constants.NETCONSOLE_UDP_PORT, constants.NETCONSOLE_UDP_PORT);
  const packet = Buffer.concat([rndis, eth2, ip, udp, data]);
  emitter.emit('outTransfer', serverConfig, packet, 'NC');
});

// Function to process File data for TFTP
const processTFTP_Data = (serverConfig) => {
  let blockSize = serverConfig.tftp.fileData.length - serverConfig.tftp.start;
  if (blockSize > 512) blockSize = 512;
  const blockData = Buffer.alloc(blockSize);
  serverConfig.tftp.fileData.copy(blockData, 0, serverConfig.tftp.start, serverConfig.tftp.start + blockSize); // Copying data to block
  serverConfig.tftp.start += blockSize; // Keep counts of bytes transferred upto
  const rndis = protocols.make_rndis(constants.ETHER_SIZE + constants.IPV4_SIZE + constants.UDP_SIZE + constants.TFTP_SIZE + blockSize);
  const ip = protocols.make_ipv4(serverConfig.receivedARP.ip_dest, serverConfig.receivedARP.ip_source, constants.IP_UDP, 0, constants.IPV4_SIZE + constants.UDP_SIZE + constants.TFTP_SIZE + blockSize, 0);
  const udp = protocols.make_udp(constants.TFTP_SIZE + blockSize, serverConfig.tftp.receivedUdp.udpDest, serverConfig.tftp.receivedUdp.udpSrc);
  const tftp = protocols.make_tftp(3, serverConfig.tftp.i);
  serverConfig.tftp.i++;
  return Buffer.concat([rndis, serverConfig.tftp.eth2, ip, udp, tftp, blockData], constants.RNDIS_SIZE + constants.ETHER_SIZE + constants.IPV4_SIZE + constants.UDP_SIZE + constants.TFTP_SIZE + blockSize);
};

// Function to handle TFTP error
const processTFTP_Error = (serverConfig) => {
  const error_msg = 'File not found';
  const rndis = protocols.make_rndis(constants.ETHER_SIZE + constants.IPV4_SIZE + constants.UDP_SIZE + constants.TFTP_SIZE + error_msg.length + 1);
  const ip = protocols.make_ipv4(serverConfig.receivedARP.ip_dest, serverConfig.receivedARP.ip_source, constants.IP_UDP, 0, constants.IPV4_SIZE + constants.UDP_SIZE + constants.TFTP_SIZE + error_msg.length + 1, 0);
  const udp = protocols.make_udp(constants.TFTP_SIZE + error_msg.length + 1, serverConfig.tftp.receivedUdp.udpDest, serverConfig.tftp.receivedUdp.udpSrc);
  const tftp = protocols.make_tftp(5, 1, error_msg);
  return Buffer.concat([rndis, serverConfig.tftp.eth2, ip, udp, tftp], constants.RNDIS_SIZE + constants.ETHER_SIZE + constants.IPV4_SIZE + constants.UDP_SIZE + constants.TFTP_SIZE + error_msg.length + 1);
};

// Function for progress update
const updateProgress = (description) => {
  emitterMod.emit('progress', {
    description: description,
    complete: +progress.percent.toFixed(2)
  });
  if (progress.percent <= 100) {
    progress.percent += progress.increment;
  }
};

// Function to extract FileName from TFTP packet
const extractName = (data) => {
  const fv = constants.RNDIS_SIZE + constants.ETHER_SIZE + constants.IPV4_SIZE + constants.UDP_SIZE + 2;
  let nameCount = 0;
  let name = '';
  while (data[fv + nameCount] != 0) {
    name += String.fromCharCode(data[fv + nameCount]);
    nameCount++;
  }
  return name;
};
