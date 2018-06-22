const ROMVID = 0x0451;
const ROMPID = 0x6141;
const BOOTPS = 67;
const BOOTPC = 68;
const IPUDP = 17;
const IP_IGMP = 2;
const IPV6_HOP_BY_HOP_OPTION = 0;
const IPV6_ICMP = 0x3A;
const ICMPV6_LENGTH = 28;
const TFTP_PORT = 69;
const NETCONSOLE_UDP_PORT = 6666;
const MDNS_UDP_PORT = 5353;
const SPLVID = 0x0451;
const SPLPID = 0xd022;
const DEVVID = 0x1d6b;
const DEVPID = 0x0104;
const ETHIPP = 0x0800;
const ETH_TYPE_ARP = 0x0806;
const ETH_TYPE_IPV4 = 0x0800;
const ETH_TYPE_IPV6 = 0x86DD;
const MAXBUF = 450;
const SERVER_IP = [0xc0, 0xa8, 0x01, 0x09]; // 192.168.1.9
const BB_IP = [0xc0, 0xa8, 0x01, 0x03]; // 192.168.1.3
const SERVER_NAME = [66, 69, 65, 71, 76, 69, 66, 79, 79, 84]; // ASCII ['B','E','A','G','L','E','B','O','O','T']

// Size of all protocol headers
const RNDIS_SIZE = 44;
const ETHER_SIZE = 14;
const ARP_SIZE = 28;
const IPV4_SIZE = 20;
const IPV6_SIZE = 40;
const UDP_SIZE = 8;
const BOOTP_SIZE = 300;
const TFTP_SIZE = 4;
const FULL_SIZE = 386;


// Include modules
const usb = require('usb');
const protocols = require('./src/protocols');
const EventEmitter = require('events').EventEmitter;
const emitter = new EventEmitter();
const fs = require('fs');
const path = require('path');
const os = require('os');
const platform = os.platform();
const rndis_win = require('./src/rndis_win');
const emitterMod = new EventEmitter(); // Emitter for module status

const progress = {
  percent: 0, // Percentage for progress
  increment: 5
};

// Set usb debug log
//usb.setDebugLevel(4);   

// TFTP server for USB Mass Storage, binaries must be placed in 'bin/'
exports.usbMassStorage = () => {
  return exports.tftpServer([{
    vid: ROMVID,
    pid: ROMPID,
    bootpFile: 'u-boot-spl.bin'
  }, {
    vid: SPLVID,
    pid: SPLPID,
    bootpFile: 'u-boot.img'
  }, {
    vid: DEVVID,
    pid: DEVPID
  }]);
};


// TFTP server for any file transfer
exports.tftpServer = (serverConfigs) => {
  let foundDevice;
  progress.increment = (100 / (serverConfigs.length * 10));
  usb.on('attach', (device) => {
    switch (device) {
      case usb.findByIds(ROMVID, ROMPID):
        foundDevice = 'ROM';
        break;
      case usb.findByIds(SPLVID, SPLPID):
        foundDevice = (device.deviceDescriptor.bNumConfigurations == 2) ? 'SPL' : 'UMS';
        break;
      case usb.findByIds(DEVVID, DEVPID):
        foundDevice = 'DEV';
        break;
      default:
        foundDevice = `Device ${device.deviceDescriptor}`;
    }
    emitterMod.emit('connect', foundDevice);

    // Setup BOOTP/ARP/TFTP servers
    serverConfigs.forEach((server) => {
      if (device === usb.findByIds(server.vid, server.pid) && foundDevice != 'UMS') {
        server.device = device;
        server.foundDevice = foundDevice;
        const timeout = (foundDevice == 'SPL') ? 500 : 0;
        setTimeout(() => {
          transfer(server);
        }, timeout);
      }
    });
  });

  // USB detach
  usb.on('detach', () => {
    emitterMod.emit('disconnect', foundDevice);
  });
  return emitterMod; // Event Emitter for progress
};


// Function for device initialization
const transfer = (server) => {
  if (server.foundDevice == 'ROM') progress.percent = progress.increment;
  updateProgress(`${server.foundDevice} ->`);
  try {
    if (server.foundDevice == 'SPL' && platform != 'linux') {
      server.device.open(false);
      server.device.setConfiguration(2, (err) => {
        if (err) emitterMod.emit('error', `Can't set configuration ${err}`);
        server.device.__open();
        onOpen(server);
      });
    } else {
      server.device.open();
      onOpen(server);
    }
  } catch (ex) {
    emitterMod.emit('error', `Can't open device ${ex}`);
  }
};

const onOpen = (server) => {
  try {
    const deviceInterface = server.device.interface(1); // Select interface 1 for BULK transfers
    if (platform != 'win32') { // Not supported in Windows
      // Detach Kernel Driver
      if (deviceInterface && deviceInterface.isKernelDriverActive()) {
        deviceInterface.detachKernelDriver();
      }
    }
    deviceInterface.claim();

    // Claim CDC interface to disable networking by Host for Device running Debian
    if (server.foundDevice === 'DEV') {
      const devInt = server.device.interface(3);
      if (devInt && devInt.isKernelDriverActive()) {
        devInt.detachKernelDriver();
      }
      devInt.claim();
    }

    // Set endpoints for usb transfer
    server.inEndpoint = deviceInterface.endpoint(deviceInterface.endpoints[0].address);
    server.outEndpoint = deviceInterface.endpoint(deviceInterface.endpoints[1].address);
  } catch (err) {
    emitterMod.emit('error', `Can't claim interface ${err}`);
    return;
  }
  updateProgress('Interface claimed');

  // Code to initialize RNDIS device on Windows and OSX
  if (platform != 'linux' && server.foundDevice == 'ROM') {
    const intf0 = server.device.interface(0); // Select interface 0 for CONTROL transfer
    intf0.claim();
    const CONTROL_BUFFER_SIZE = 1025;
    const RNDIS_INIT_SIZE = 24;
    const RNDIS_SET_SIZE = 28;
    const rndis_buf = Buffer.alloc(CONTROL_BUFFER_SIZE);
    const init_msg = rndis_win.make_rndis_init();
    init_msg.copy(rndis_buf, 0, 0, RNDIS_INIT_SIZE);

    // Windows Control Transfer
    // https://msdn.microsoft.com/en-us/library/aa447434.aspx
    // http://www.beyondlogic.org/usbnutshell/usb6.shtml
    const bmRequestType_send = 0x21; // USB_TYPE=CLASS | USB_RECIPIENT=INTERFACE
    const bmRequestType_receive = 0xA1; // USB_DATA=DeviceToHost | USB_TYPE=CLASS | USB_RECIPIENT=INTERFACE

    // Sending rndis_init_msg (SEND_ENCAPSULATED_COMMAND)
    server.device.controlTransfer(bmRequestType_send, 0, 0, 0, rndis_buf, () => {
      // This error doesn't affect the functionality, so ignoring
      //if(error) emitterMod.emit('error', "Control transfer error on SEND_ENCAPSULATED " +error);
    });

    // Receive rndis_init_cmplt (GET_ENCAPSULATED_RESPONSE)
    server.device.controlTransfer(bmRequestType_receive, 0x01, 0, 0, CONTROL_BUFFER_SIZE, (error) => {
      if (error) emitterMod.emit('error', `Control transfer error on GET_ENCAPSULATED ${error}`);
    });


    const set_msg = rndis_win.make_rndis_set();
    set_msg.copy(rndis_buf, 0, 0, RNDIS_SET_SIZE + 4);

    // Send rndis_set_msg (SEND_ENCAPSULATED_COMMAND)
    server.device.controlTransfer(bmRequestType_send, 0, 0, 0, rndis_buf, () => {
      // This error doesn't affect the functionality, so ignoring
      //if(error) emitterMod.emit('error', "Control transfer error on SEND_ENCAPSULATED " +error);
    });

    // Receive rndis_init_cmplt (GET_ENCAPSULATED_RESPONSE)
    server.device.controlTransfer(bmRequestType_receive, 0x01, 0, 0, CONTROL_BUFFER_SIZE, (error) => {
      if (error) emitterMod.emit('error', `Control transfer error on GET_ENCAPSULATED ${error}`);
    });
  }

  try {
    // Set endpoint transfer type
    server.inEndpoint.transferType = usb.LIBUSB_TRANSFER_TYPE_BULK;
    server.outEndpoint.transferType = usb.LIBUSB_TRANSFER_TYPE_BULK;
  } catch (err) {
    emitterMod.emit('error', `Interface disappeared: ${err}`);
    return;
  }

  // Start polling the In Endpoint for transfers
  server.inEndpoint.startPoll(1, MAXBUF);
  emitter.emit('inTransfer', server);
};



// Event for inEnd transfer
emitter.on('inTransfer', (server) => {
  server.inEndpoint.on('data', (data) => {
    const request = identifyRequest(data);
    console.log(request);
    switch (request) {
      case 'notIdentified':
        emitterMod.emit('error', `${request} packet type`);
        break;
      case 'TFTP':
        updateProgress('TFTP request recieved');
        emitter.emit('processTFTP', server, data);
        break;
      case 'BOOTP':
        updateProgress('BOOTP request recieved');
        emitter.emit('outTransfer', server, processBOOTP(server, data), request);
        break;
      case 'ARP':
        emitter.emit('outTransfer', server, processARP(server, data), request);
        break;
      case 'TFTP_Data':
        if (server.tftp.i <= server.tftp.blocks) { // Transfer until all blocks of file are transferred
          emitter.emit('outTransfer', server, processTFTP_Data(server), request);
        } else {
          updateProgress(`${server.foundDevice} TFTP transfer complete`);
          server.inEndpoint.stopPoll();
        }
        break;
      case 'NC':
        emitter.emit('nc', server, data);
        break;
      case 'mDNS':
        parseDNS(server, data);
        break;
      case 'ICMPv6':
        processIcmpv6(server, data);
        break;
      case 'IGMP':
        processIgmp(server, data);
        break;
      default:
        console.log(request);
    }
  });
  server.inEndpoint.on('error', (error) => {
    console.log(error);
  });
});


// Event for outEnd Transfer
emitter.on('outTransfer', (server, data, request) => {  
  server.outEndpoint.transfer(data, (error) => {
    if (!error) {
      if (request == 'BOOTP') updateProgress(`${request} reply done`);
      if (request == 'DHCP') console.log('DHCP done');
      if (request == 'ICMPv6') console.log('ICMPv6 done');
      if (request == 'MDNS') console.log('MDNS done');
    }
  });
});


// Function to identify request packet
const identifyRequest = (buff) => {
  const ether = protocols.decode_ether(buff.slice(RNDIS_SIZE));
  if (ether.h_proto === ETH_TYPE_ARP) return 'ARP';
  if (ether.h_proto === ETH_TYPE_IPV4) {
    const ipv4 = protocols.parseIpv4(buff.slice(RNDIS_SIZE + ETHER_SIZE));
    //console.log(ipv4);
    if (ipv4.Protocol === 2) return 'IGMP';
    if (ipv4.Protocol === IPUDP) {
      const udp = protocols.parse_udp(buff.slice(RNDIS_SIZE + ETHER_SIZE + IPV4_SIZE));
      const sPort = udp.udpSrc;
      const dPort = udp.udpDest;
      if (sPort == BOOTPC && dPort == BOOTPS) return 'BOOTP'; // Port 68: BOOTP Client, Port 67: BOOTP Server
      if (dPort == TFTP_PORT) {
        const opcode = buff[RNDIS_SIZE + ETHER_SIZE + IPV4_SIZE + UDP_SIZE + 1];
        if (opcode == 1) return 'TFTP'; // Opcode = 1 for Read Request (RRQ)
        if (opcode == 4) return 'TFTP_Data'; // Opcode = 4 for Acknowledgement (ACK)
      }
      if (dPort == NETCONSOLE_UDP_PORT) return 'NC';
      if (dPort == MDNS_UDP_PORT && sPort == MDNS_UDP_PORT) return 'mDNS';
      emitterMod.emit('error', `Unidentified UDP packet type: sPort=${sPort} dPort=${dPort}`);
    }
  }
  if (ether.h_proto === ETH_TYPE_IPV6) {
    const ipv6 = protocols.parseIpv6(buff.slice(RNDIS_SIZE + ETHER_SIZE));
    //console.log(ipv6);
    if (ipv6.NextHeader === IPV6_HOP_BY_HOP_OPTION) {
      const ipv6Option = protocols.parseIpv6Option(buff.slice(RNDIS_SIZE + ETHER_SIZE + IPV6_SIZE));
      if (ipv6Option.NextHeader === IPV6_ICMP) return 'ICMPv6';
    }
    if (ipv6.NextHeader === IPUDP) {
      const udp = protocols.parse_udp(buff.slice(RNDIS_SIZE + ETHER_SIZE + IPV6_SIZE));
      if (udp.udpSrc == MDNS_UDP_PORT && udp.udpDest == MDNS_UDP_PORT) return 'mDNS';
    }
  }
  return 'unidentified';
};

// Function to process BOOTP request
const processBOOTP = (server, data) => {
  const ether_buf = Buffer.alloc(MAXBUF - RNDIS_SIZE);
  const udp_buf = Buffer.alloc(UDP_SIZE);
  const bootp_buf = Buffer.alloc(BOOTP_SIZE);
  data.copy(udp_buf, 0, RNDIS_SIZE + ETHER_SIZE + IPV4_SIZE, MAXBUF);
  data.copy(bootp_buf, 0, RNDIS_SIZE + ETHER_SIZE + IPV4_SIZE + UDP_SIZE, MAXBUF);
  data.copy(ether_buf, 0, RNDIS_SIZE, MAXBUF);
  server.ether = protocols.decode_ether(ether_buf); // Gets decoded ether packet data
  const udpUboot = protocols.parse_udp(udp_buf); // parsed udp header
  const bootp = protocols.parse_bootp(bootp_buf); // parsed bootp header
  const rndis = protocols.make_rndis(FULL_SIZE - RNDIS_SIZE);
  const eth2 = protocols.make_ether2(server.ether.h_source, server.ether.h_dest, ETHIPP);
  const ip = protocols.make_ipv4(SERVER_IP, BB_IP, IPUDP, 0, IPV4_SIZE + UDP_SIZE + BOOTP_SIZE, 0);
  const udp = protocols.make_udp(BOOTP_SIZE, udpUboot.udpDest, udpUboot.udpSrc);
  const bootreply = protocols.make_bootp(SERVER_NAME, server.bootpFile, bootp.xid, server.ether.h_source, BB_IP, SERVER_IP);
  return Buffer.concat([rndis, eth2, ip, udp, bootreply], FULL_SIZE);
};

// Function to process ARP request
const processARP = (server, data) => {
  const arp_buf = Buffer.alloc(ARP_SIZE);
  data.copy(arp_buf, 0, RNDIS_SIZE + ETHER_SIZE, RNDIS_SIZE + ETHER_SIZE + ARP_SIZE);
  server.receivedARP = protocols.parse_arp(arp_buf); // Parsed received ARP request
  const arpResponse = protocols.make_arp(2, server.ether.h_dest, server.receivedARP.ip_dest, server.receivedARP.hw_source, server.receivedARP.ip_source);
  const rndis = protocols.make_rndis(ETHER_SIZE + ARP_SIZE);
  const eth2 = protocols.make_ether2(server.ether.h_source, server.ether.h_dest, ETH_TYPE_ARP);
  return Buffer.concat([rndis, eth2, arpResponse], RNDIS_SIZE + ETHER_SIZE + ARP_SIZE);
};

// Event to process TFTP request
emitter.on('processTFTP', (server, data) => {
  const udpTFTP_buf = Buffer.alloc(UDP_SIZE);
  data.copy(udpTFTP_buf, 0, RNDIS_SIZE + ETHER_SIZE + IPV4_SIZE, RNDIS_SIZE + ETHER_SIZE + IPV4_SIZE + UDP_SIZE);
  server.tftp = {}; // Object containing TFTP parameters
  server.tftp.i = 1; // Keeps count of File Blocks transferred
  server.tftp.receivedUdp = protocols.parse_udp(udpTFTP_buf); // Received UDP packet for SPL tftp
  server.tftp.eth2 = protocols.make_ether2(server.ether.h_source, server.ether.h_dest, ETHIPP); // Making ether header here, as it remains same for all tftp block transfers
  const fileName = extractName(data);
  server.filePath = path.join('bin', fileName);
  updateProgress(`${fileName} transfer starts`);
  fs.readFile(server.filePath, (error, file_data) => {
    if (!error) {
      server.tftp.blocks = Math.ceil((file_data.length + 1) / 512); // Total number of blocks of file
      server.tftp.start = 0;
      server.tftp.fileData = file_data;
      emitter.emit('outTransfer', server, processTFTP_Data(server), 'TFTP');
    } else {
      emitter.emit('outTransfer', server, processTFTP_Error(server), 'TFTP');
      emitterMod.emit('error', `Error reading ${server.filePath}: ${error}`);
    }
  });
});

// Event for netconsole in
emitter.on('nc', (server, data) => {
  const nc_buf = Buffer.alloc(MAXBUF);
  data.copy(nc_buf, 0, RNDIS_SIZE + ETHER_SIZE + IPV4_SIZE + UDP_SIZE, MAXBUF);
  process.stdout.write(nc_buf.toString());
  if (!server.isNcActive) {
    server.isNcActive = true;
    emitterMod.emit('ncStarted', server);
  }
});

// Event for sending netconsole commands
emitterMod.on('ncin', (server, command) => {
  const data = Buffer.from(command);
  const blockSize = data.length;
  const ncStdinData = Buffer.alloc(blockSize);
  data.copy(ncStdinData, 0, 0, blockSize);
  const rndis = protocols.make_rndis(ETHER_SIZE + IPV4_SIZE + UDP_SIZE + blockSize);
  const eth2 = protocols.make_ether2(server.ether.h_source, server.ether.h_dest, ETHIPP);
  const ip = protocols.make_ipv4(server.receivedARP.ip_dest, server.receivedARP.ip_source, IPUDP, 0, IPV4_SIZE + UDP_SIZE + blockSize, 0);
  const udp = protocols.make_udp(blockSize, NETCONSOLE_UDP_PORT, NETCONSOLE_UDP_PORT);
  const packet = Buffer.concat([rndis, eth2, ip, udp, data]);
  emitter.emit('outTransfer', server, packet, 'NC');
});

// Function to process File data for TFTP
const processTFTP_Data = (server) => {
  let blockSize = server.tftp.fileData.length - server.tftp.start;
  if (blockSize > 512) blockSize = 512;
  const blockData = Buffer.alloc(blockSize);
  server.tftp.fileData.copy(blockData, 0, server.tftp.start, server.tftp.start + blockSize); // Copying data to block
  server.tftp.start += blockSize; // Keep counts of bytes transferred upto
  const rndis = protocols.make_rndis(ETHER_SIZE + IPV4_SIZE + UDP_SIZE + TFTP_SIZE + blockSize);
  const ip = protocols.make_ipv4(server.receivedARP.ip_dest, server.receivedARP.ip_source, IPUDP, 0, IPV4_SIZE + UDP_SIZE + TFTP_SIZE + blockSize, 0);
  const udp = protocols.make_udp(TFTP_SIZE + blockSize, server.tftp.receivedUdp.udpDest, server.tftp.receivedUdp.udpSrc);
  const tftp = protocols.make_tftp(3, server.tftp.i);
  server.tftp.i++;
  return Buffer.concat([rndis, server.tftp.eth2, ip, udp, tftp, blockData], RNDIS_SIZE + ETHER_SIZE + IPV4_SIZE + UDP_SIZE + TFTP_SIZE + blockSize);
};

// Function to handle TFTP error
const processTFTP_Error = (server) => {
  const error_msg = 'File not found';
  const rndis = protocols.make_rndis(ETHER_SIZE + IPV4_SIZE + UDP_SIZE + TFTP_SIZE + error_msg.length + 1);
  const ip = protocols.make_ipv4(server.receivedARP.ip_dest, server.receivedARP.ip_source, IPUDP, 0, IPV4_SIZE + UDP_SIZE + TFTP_SIZE + error_msg.length + 1, 0);
  const udp = protocols.make_udp(TFTP_SIZE + error_msg.length + 1, server.tftp.receivedUdp.udpDest, server.tftp.receivedUdp.udpSrc);
  const tftp = protocols.make_tftp(5, 1, error_msg);
  return Buffer.concat([rndis, server.tftp.eth2, ip, udp, tftp], RNDIS_SIZE + ETHER_SIZE + IPV4_SIZE + UDP_SIZE + TFTP_SIZE + error_msg.length + 1);
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
  const fv = RNDIS_SIZE + ETHER_SIZE + IPV4_SIZE + UDP_SIZE + 2;
  let nameCount = 0;
  let name = '';
  while (data[fv + nameCount] != 0) {
    name += String.fromCharCode(data[fv + nameCount]);
    nameCount++;
  }
  return name;
};

// Function to process mDNS
const parseDNS = (server, data) => {
  const buf = data.slice(RNDIS_SIZE + ETHER_SIZE + IPV4_SIZE + UDP_SIZE);
  const parsedDns = protocols.parse_dns(buf);
  console.log(parsedDns.Header);/*
  parsedDns.Questions.forEach((question) => {
    console.log(question.name);
    console.log(question.otherFields);
  });
  parsedDns.NameServers.forEach((question) => {
    console.log(question.name);
    console.log(question.otherFields);
  });
  parsedDns.AnswerRecords.forEach((question) => {
    console.log(question.name);
    console.log(question.otherFields);
  });*/
  //console.log(protocols.parse_dns(protocols.encodeMdns(parsedDns)));

  let mdnsPacket = {
    Header: {
      ID: 0,
      QR: 0,
      Opcode: 0,
      AA: 0,
      TC: 0,
      RD: 0,
      RA: 0,
      Z: 0,
      RCode: 0,
      QCount: 2,
      ANCount: 0,
      NSCount: 2,
      ARCount: 0
    },
    Questions: [
      {
        name: ['a', '6', '1', '0', 'd', '1', 'b', '1', '2', 'f', '7', 'f', 'e', '5', 'b', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '8', 'e', 'f', 'ip6', 'arpa'],
        otherFields: {
          QType: 255,
          UnicastResponse: 0,
          QClass: 1
        }
      },
      {
        name: ['BeagleBoot', 'local'],
        otherFields: {
          QType: 255,
          UnicastResponse: 0,
          QClass: 1
        }
      }
    ],
    AnswerRecords: [],
    NameServers: [
      {
        name: ['BeagleBoot', 'local'],
        otherFields: {
          RRType: 28,
          CacheFlush: 0,
          Class: 1,
          TTL: 120,
          RDLength: 16,
          Address: [0xfe, 0x80, 0, 0, 0, 0, 0, 0, 0x0b, 0x5e, 0xf7, 0xf2, 0x1b, 0x1d, 0x01, 0x6a] 
        }
      },
      {
        name: ['a', '6', '1', '0', 'd', '1', 'b', '1', '2', 'f', '7', 'f', 'e', '5', 'b', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '8', 'e', 'f', 'ip6', 'arpa'],
        otherFields: {
          RRType: 12,
          CacheFlush: 0,
          Class: 1,
          TTL: 120,
          RDLength: 2
        },
        DomainName: ['BeagleBoot', 'local']
      }
    ],
    AdditionalRecords: []
  };
  const mdnsBuff = protocols.encodeMdns(mdnsPacket);
  const rndisBuff = protocols.make_rndis(FULL_SIZE - RNDIS_SIZE);
  const etherSrc = [0x33, 0x33, 0, 0, 0, 0xfb];
  const etherDst = [0x43, 0xa3, 0x16, 0xdf, 0x50, 0xc1];
  const etherBuff = protocols.make_ether2(etherDst, etherSrc, ETH_TYPE_IPV6);
  const sourceAdd = [0xfe, 0x80, 0, 0, 0, 0, 0, 0, 0x0b, 0x5e, 0xf7, 0xf2, 0x1b, 0x1d, 0x01, 0x6a];
  const destAdd = [0xff, 0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xfb];
  const ipv6Header = {
    //Version: 6,
    //TrafficClass: 0,
    //FlowLabel: 0xbecee,
    VTF: [0x60, 0x0b, 0xec, 0xee],
    PayloadLength: UDP_SIZE + mdnsBuff.length,
    NextHeader: IPUDP,
    HopLimit: 255,
    SourceAddress: sourceAdd,
    DestinationAddress: destAdd
  };
  const ipBuff = protocols.encodeIpv6(ipv6Header);
  const udpBuff = protocols.make_udp(mdnsBuff.length, MDNS_UDP_PORT, MDNS_UDP_PORT);
  const outputBuff = Buffer.concat([rndisBuff, etherBuff, ipBuff, udpBuff, mdnsBuff]);
  emitter.emit('outTransfer', server, outputBuff, 'MDNS');

  mdnsPacket.Questions = [];
  mdnsPacket.NameServers = [];
  mdnsPacket.AnswerRecords = [
    {
      name: ['a', '6', '1', '0', 'd', '1', 'b', '1', '2', 'f', '7', 'f', 'e', '5', 'b', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '8', 'e', 'f', 'ip6', 'arpa'],
      otherFields: {
        RRType: 12,
        CacheFlush: 0,
        Class: 1,
        TTL: 120,
        RDLength: 2
      }
    },
    {
      name: ['BeagleBoot', 'local'],
      otherFields: {
        RRType: 28,
        CacheFlush: 0,
        Class: 1,
        TTL: 120,
        RDLength: 16,
        Address: [0xfe, 0x80, 0, 0, 0, 0, 0, 0, 0x0b, 0x5e, 0xf7, 0xf2, 0x1b, 0x1d, 0x01, 0x6a] 
      }
    }
  ];
  processDhcp(server, data);
};

const processIcmpv6 = (server, data) => {
  const ipv6Option = protocols.parseIpv6Option(data.slice(RNDIS_SIZE + ETHER_SIZE + IPV6_SIZE));
  const optionLength = (ipv6Option.Length + 1) * 8; // https://www.ietf.org/rfc/rfc2460.txt#Section-4.3
  const icmp = protocols.parseIcmp(data.slice(RNDIS_SIZE + ETHER_SIZE + IPV6_SIZE + optionLength));
  console.log(icmp);

  const rndisBuff = protocols.make_rndis(FULL_SIZE - RNDIS_SIZE);
  const etherSrc = [0x04, 0xa3, 0x16, 0xdf, 0x50, 0xc1];
  const etherDst = [0x33, 0x33, 0x00, 0x00, 0x00, 0x16];
  const etherBuff = protocols.make_ether2(etherDst, etherSrc, ETH_TYPE_IPV4);
  const sourceAdd = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const destAdd = [0xff, 0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x16];
  const ipv6Header = {
    //Version: 6,
    //TrafficClass: 0,
    //FlowLabel: 0,
    VTF: [0x60, 0x00, 0x00, 0x00],
    PayloadLength: 36,
    NextHeader: 58,
    HopLimit: 1,
    SourceAddress: sourceAdd,
    DestinationAddress: destAdd
  };
  const ipBuff = protocols.encodeIpv6(ipv6Header);
  const pseudoIpv6 = {
    SourceAddress: sourceAdd,
    DestinationAddress: destAdd,
    Length: ICMPV6_LENGTH,
    Zeros: [0,0,0],
    NextHeader: IPV6_ICMP
  };
  const icmpHeader = {
    Type: 143, // Multicast Listener
    Code: 0,
    Checksum: 0,
    Reserved: 0,
    MulticastRecords: 1
  };
  const multicastRecords = {
    Type: 4,
    AuxDataLen: 0,
    NumberOfSources: 0,
    MulticastAddress: [0xff, 0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x01, 0xff, 0x1d, 0x01, 0x6a]
  };
  const icmpBuff = protocols.encodeIcmp(icmpHeader, pseudoIpv6, multicastRecords);
  const icmpPacket = Buffer.concat([rndisBuff, etherBuff, ipBuff, icmpBuff]);
  emitter.emit('outTransfer', server, icmpPacket, 'ICMPv6');
};

const processIgmp = (server, data) => {
  const rndis = protocols.make_rndis(FULL_SIZE - RNDIS_SIZE);
  const etherSrc = [0x04, 0xa3, 0x16, 0xdf, 0x50, 0xc1];
  const etherDst = [0x01, 0x00, 0x5e, 0x00, 0x00, 0x16];
  const etherBuff = protocols.make_ether2(etherDst, etherSrc, ETH_TYPE_IPV4);
  const ipHeader = {
    Version: 4,
    IHL: 6,
    TypeOfService: 0xc0,
    TotalLength: 40,
    Identification: 0,
    Flags: 0x02,
    FragmentOffset: 0,
    TimeToLIve: 1,
    Protocol: IP_IGMP,
    HeaderChecksum: 0,
    SourceAddress: [192, 168, 7, 1],
    DestinationAddress: [224, 0, 0, 22]
  };
  const ipOptions = {
    Type: 148,
    Length: 4,
    Data: 0
  };
  const ipBuff = protocols.encodeIpv4(ipHeader, ipOptions);
  const igmp = data.slice(RNDIS_SIZE + ETHER_SIZE + IPV4_SIZE + 4);
  const outputData = Buffer.concat([rndis, etherBuff, ipBuff, igmp], MAXBUF);
  emitter.emit('outTransfer', server, outputData, 'IGMP');
  processDhcp(server, data);
};

const processDhcp = (server, data) => {
  const bootp = {
    MessageType: 1,
    HardwareType: 1,
    HwAddressLength: 6,
    HopCount: 0,
    TransactionId: 0x9000d259,
    SecondsElapsed: 3,
    Flags: 0,
    ClientIpAddress: [0, 0, 0, 0],
    YourIpAddress: [0, 0, 0, 0],
    NextServerIpAddress: [0, 0, 0, 0],
    RelayAgentIpAddress: [0, 0, 0, 0],
    ClientMacAddress: [0x04, 0xa3, 0x16, 0xdf, 0x50, 0xc1],
    MacOffset: Array.apply(null, Array(10)).map(Number.prototype.valueOf,0),
    ServerNameOffset: Array.apply(null, Array(64)).map(Number.prototype.valueOf,0),
    BootFileName: Array.apply(null, Array(128)).map(Number.prototype.valueOf,0),
    MagicCookie: 'DHCP',
    Option1: 53,
    Length1: 1,
    DhcpRequest: 3,
    Optionx: 50,
    Lengthx: 4,
    ReqIp: [192, 168, 7, 1],
    Option2: 12,
    Length2: 10,
    HostName: 'BeagleBoot',
    Option3: 55,
    Length3: 16,
    ParameterRequest: [1, 28, 2, 3, 15, 6, 119, 12, 44, 47, 26, 121, 42, 249, 33, 252],
    Option4: 255
  };
  const bootpBuff = protocols.encodeBootp(bootp);
  const rndis = protocols.make_rndis(FULL_SIZE - RNDIS_SIZE);
  const etherSrc = [0x04, 0xa3, 0x16, 0xdf, 0x50, 0xc1];
  const etherDst = [0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
  const etherBuff = protocols.make_ether2(etherDst, etherSrc, ETH_TYPE_IPV4);
  const ipHeader = {
    Version: 4,
    IHL: 5,
    TypeOfService: 0x10,
    TotalLength: IPV4_SIZE + UDP_SIZE + BOOTP_SIZE,
    Identification: 0,
    Flags: 0x00,
    FragmentOffset: 0,
    TimeToLIve: 128,
    Protocol: IPUDP,
    HeaderChecksum: 0,
    SourceAddress: [0, 0, 0, 0],
    DestinationAddress: [255, 255, 255, 255]
  };
  const ipBuff = protocols.encodeIpv4(ipHeader, {});
  const udpBuff = protocols.make_udp(BOOTP_SIZE, 68, 67);
  const outputData = Buffer.concat([rndis, etherBuff, ipBuff, udpBuff, bootpBuff], FULL_SIZE);
  emitter.emit('outTransfer', server, outputData, 'DHCP');
};