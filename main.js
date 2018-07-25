const ROMVID = 0x0451;
const ROMPID = 0x6141;
const BOOTPS = 67;
const BOOTPC = 68;
const IPUDP = 17;
const IPV6_HOP_BY_HOP_OPTION = 0;
const IPV6_ICMP = 0x3A;
const IP_TCP = 0x06;
const TFTP_PORT = 69;
const NETCONSOLE_UDP_PORT = 6666;
const MDNS_UDP_PORT = 5353;
const SPLVID = 0x0451;
const SPLPID = 0xd022;
const DEBIAN_VID = 0x1d6b;
const DEBIAN_PID = 0x0104;
const ETHIPP = 0x0800;
const ETH_TYPE_ARP = 0x0806;
const ETH_TYPE_IPV4 = 0x0800;
const ETH_TYPE_IPV6 = 0x86DD;
const ARP_OPCODE_REQUEST = 1;
const ARP_OPCODE_REPLY = 2;
const MAXBUF = 500;
const SERVER_IP = [0xc0, 0xa8, 0x01, 0x09]; // 192.168.1.9
const BB_IP = [0xc0, 0xa8, 0x01, 0x03]; // 192.168.1.3
const SERVER_NAME = [66, 69, 65, 71, 76, 69, 66, 79, 79, 84]; // ASCII ['B','E','A','G','L','E','B','O','O','T']

// Size of all protocol headers
const RNDIS_SIZE = 0;
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
const network = require('network');
const cap = require('cap').Cap;
const ping = require('ping');
const os = require('os');
const platform = os.platform();
const rndis_win = require('./src/rndis_win');
const emitterMod = new EventEmitter(); // Emitter for module status
const capture = new cap();

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

// TFTP server for USB Mass Storage, binaries must be placed in 'bin/'
exports.usbMassStorage = () => {
  return exports.serveClient([{
    vid: ROMVID,
    pid: ROMPID,
    bootpFile: 'u-boot-spl.bin'
  }, {
    vid: SPLVID,
    pid: SPLPID,
    bootpFile: 'u-boot.img'
  }, {
    vid: DEBIAN_VID,
    pid: DEBIAN_PID
  }]);
};

// Proxy Server for Debian
exports.proxyServer = () => {
  return exports.serveClient([{
    vid: DEBIAN_VID,
    pid: DEBIAN_PID
  }]);
};

// Configuring Server to serve Client
exports.serveClient = (serverConfigs) => {
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
      case usb.findByIds(DEBIAN_VID, DEBIAN_PID):
        foundDevice = 'DEBIAN';
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

  // Configure Proxy Server for Debian Device
  if (serverConfigs[0].vid === DEBIAN_VID && serverConfigs[0].pid === DEBIAN_PID) emitter.emit('configureProxy');
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

// Get address array from string
const getAddressArray = (addString) => {
  const addArray = [];
  let isIp = false;
  let addressPart = '';
  for (let i = 0; i < addString.length; i++) {
    if (addString.charAt(i) === '.') {
      isIp = true;
      addArray.push(parseInt(addressPart));
      addressPart = '';
    }
    else if (addString.charAt(i) === ':') {
      addArray.push(parseInt(addressPart, 16));
      addressPart = '';
    }
    else addressPart += addString.charAt(i);
    if (i === addString.length - 1) {
      addArray.push(parseInt(addressPart, (isIp) ? 0 : 16));
    }
  }
  return addArray;
};

// Compare IP Addresses
const compareIp = (ip1, ip2) => {
  let i = 0;
  while (i < 4) {
    if (ip1[i] === ip2[i]) i++;
    else break;
  }
  if (i === 4) return true;
  else return false;
};

// Find available IP address from Host's subnet
const getAvailableIp = async (hostIp) => {
  const pingConfig = {
    timeout: 1
  };
  const incrementIp = (ip, inc) => {
    let newIp = '';
    let lastPart = '';
    let dotCount = 0;
    for (let i = 0; i < ip.length; i++) {
      if (dotCount < 3) newIp += ip.charAt(i);
      else lastPart += ip.charAt(i);
      if (ip.charAt(i) === '.') dotCount++;
    }
    lastPart = parseInt(lastPart) + inc;
    if (lastPart > 254) lastPart = 2;
    return newIp + lastPart;
  };
  let host = incrementIp(hostIp, 10);
  let isAvailable = false;
  while (!isAvailable) {
    let result = await ping.promise.probe(host, pingConfig);
    isAvailable = !result.alive;
    if (isAvailable) break;
    host = incrementIp(host, 1);
  }
  return host;
};

// Configure Proxy Server
emitter.on('configureProxy', () => {
  // Proxy Server configs
  network.get_active_interface((error, activeInterface) => {
    if (!error) {
      proxyConfig.Host = {
        SourceMac: getAddressArray(activeInterface.mac_address),
        SourceIp: getAddressArray(activeInterface.ip_address),
        GatewayIp: getAddressArray(activeInterface.gateway_ip)
      };
      proxyConfig.BB = {
        SourceIp: [192, 168, 6, 2],
        GatewayIp: [192, 168, 6, 1],
      };
      proxyConfig.ActiveInterface = activeInterface;
      getAvailableIp(activeInterface.ip_address).then((proxyIp) => {
        proxyConfig.ProxyIp = getAddressArray(proxyIp);
        console.log(`Using Proxy IP Address: ${proxyIp}`);
      });
    }
  });
});


const onOpen = (server) => {
  try {
    let interfaceNumber = 1; // Interface for data transfer

    // Claim CDC interface to disable networking by Host for Device running Debian
    if (server.foundDevice === 'DEBIAN') {
      [0, 1, 2, 3, 4, 5].forEach((i) => {
        const devInt = server.device.interface(i);
        if (platform != 'win32') {
          if (devInt && devInt.isKernelDriverActive()) {
            devInt.detachKernelDriver();
          }
        }
        devInt.claim();
      });
      interfaceNumber = 3;
    }

    server.deviceInterface = server.device.interface(interfaceNumber); // Select interface 1 for BULK transfers
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

  if (server.foundDevice === 'DEBIAN') {
    server.deviceInterface.setAltSetting(1, (error) => {
      if (error) console.log(error);
      else {
        try {
          // Set endpoints for usb transfer
          server.inEndpoint = server.deviceInterface.endpoint(server.deviceInterface.endpoints[0].address);
          server.outEndpoint = server.deviceInterface.endpoint(server.deviceInterface.endpoints[1].address);

          // Set endpoint transfer type
          server.inEndpoint.transferType = usb.LIBUSB_TRANSFER_TYPE_BULK;
          server.outEndpoint.transferType = usb.LIBUSB_TRANSFER_TYPE_BULK;
        } catch (err) {
          emitterMod.emit('error', `Interface disappeared: ${err}`);
          return;
        }

        // Start polling the In Endpoint for transfers
        server.inEndpoint.startPoll(1, MAXBUF);

        const device = cap.findDevice(proxyConfig.ActiveInterface.ip_address);
        const filter = '';
        const bufSize = 10 * 1024 * 1024;
        let buffer = Buffer.alloc(65535);
        capture.open(device, filter, bufSize, buffer);

        capture.on('packet', () => {
          const request = identifyRequest(buffer);
          if (request === 'ARP') {
            const receivedARP = protocols.parse_arp(buffer.slice(ETHER_SIZE));
            if (receivedARP.ip_dest[3] === proxyConfig.ProxyIp[3]) {

              // Response Host.GatewayIp is at Host.GatewayMac
              if (receivedARP.opcode === ARP_OPCODE_REPLY) {
                if (receivedARP.ip_source[3] === proxyConfig.Host.GatewayIp[3]) {
                  proxyConfig.Host.GatewayMac = receivedARP.hw_source;
                  const etherSrc = proxyConfig.BB.GatewayMac;
                  const etherDst = proxyConfig.BB.SourceMac;
                  const ipSrc = proxyConfig.BB.GatewayIp;
                  const ipDst = proxyConfig.BB.SourceIp;
                  const arpHeader = protocols.make_arp(ARP_OPCODE_REPLY, etherSrc, ipSrc, etherDst, ipDst);
                  const etherHeader = protocols.make_ether2(etherDst, etherSrc, ETH_TYPE_ARP);
                  const proxyArp = Buffer.concat([etherHeader, arpHeader], ETHER_SIZE + ARP_SIZE);
                  emitter.emit('outTransfer', server, proxyArp, 'ARP');
                }
                else {
                  proxyConfig.ArpList[receivedARP.ip_source[3]] = receivedARP.hw_source;
                }
              }

              // Request Who has ProxyIp ? Tell SomeIp
              if (receivedARP.opcode === ARP_OPCODE_REQUEST) {
                const etherSrc = proxyConfig.Host.SourceMac;
                const etherDst = receivedARP.hw_source;
                const ipSrc = proxyConfig.ProxyIp;
                const ipDst = receivedARP.ip_source;
                const arpHeader = protocols.make_arp(ARP_OPCODE_REPLY, etherSrc, ipSrc, etherDst, ipDst);
                const etherHeader = protocols.make_ether2(etherDst, etherSrc, ETH_TYPE_ARP);
                const proxyArp = Buffer.concat([etherHeader, arpHeader], ETHER_SIZE + ARP_SIZE);
                sendToNetwork(proxyArp);
              }
            }
          }

          else {
            const etherSrc = proxyConfig.BB.GatewayMac;
            const etherDst = proxyConfig.BB.SourceMac;
            const receivedIP = protocols.parseIpv4(buffer.slice(ETHER_SIZE));
            if (receivedIP.DestinationAddress[3] === proxyConfig.ProxyIp[3]) {
              let ipSrc;
              if (compareIp(receivedIP.SourceAddress, proxyConfig.Host.GatewayIp)) {
                ipSrc = proxyConfig.BB.GatewayIp;
              }
              else ipSrc = receivedIP.SourceAddress;
              const ipHeader = {
                Version: receivedIP.Version,
                IHL: receivedIP.IHL,
                TypeOfService: receivedIP.TypeOfService,
                TotalLength: receivedIP.TotalLength,
                Identification: receivedIP.Identification,
                Flags: receivedIP.Flags,
                FragmentOffset: receivedIP.FragmentOffset,
                TimeToLIve: receivedIP.TimeToLIve,
                Protocol: receivedIP.Protocol,
                HeaderChecksum: 0,
                SourceAddress: ipSrc,
                DestinationAddress: proxyConfig.BB.SourceIp
              };
              let ipPayload = buffer.slice(ETHER_SIZE + IPV4_SIZE, ETHER_SIZE + ipHeader.TotalLength);
              if (ipHeader.Protocol === IP_TCP) {
                ipPayload = protocols.regenerateTcpChecksum(ipHeader, ipPayload);
              }
              if (ipHeader.Protocol === IPUDP) {
                ipPayload = Buffer.concat([ipPayload.slice(0, 6), Buffer.from([0, 0]), ipPayload.slice(8)]);
              }
              const ipBuff = protocols.encodeIpv4(ipHeader);
              const etherBuff = protocols.make_ether2(etherDst, etherSrc, ETH_TYPE_IPV4);
              const changedPacket = Buffer.concat([etherBuff, ipBuff, ipPayload]);
              emitter.emit('outTransfer', server, changedPacket, 'IP');
            }
          }
        });
        emitter.emit('inTransfer', server);

      }
    });
  }
  else {
    try {
      // Set endpoints for usb transfer
      server.inEndpoint = server.deviceInterface.endpoint(server.deviceInterface.endpoints[0].address);
      server.outEndpoint = server.deviceInterface.endpoint(server.deviceInterface.endpoints[1].address);

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
  }
};

const sendToNetwork = (data) => {
  try {

    // send will not work if pcap_sendpacket is not supported by underlying `device`
    capture.send(data, data.length);
  } catch (e) {
    console.log(`Error sending packet: ${e}`);
  }
};


// Event for inEnd transfer
emitter.on('inTransfer', (server) => {
  server.inEndpoint.on('data', (data) => {

    if (server.foundDevice === 'DEBIAN') {
      const etherHeader = protocols.decode_ether(data);
      // Update Source and Gateway Mac for BeagleBone
      if (!proxyConfig.BB.SourceMac) {
        proxyConfig.BB.SourceMac = etherHeader.h_source;
        let tempMac = etherHeader.h_source;
        let gatewayMac = [];
        tempMac.forEach((part) => {
          if (tempMac.indexOf(part) === 5) gatewayMac.push(part - 1);
          else gatewayMac.push(part);
        });
        proxyConfig.BB.GatewayMac = gatewayMac;
      }
      const request = identifyRequest(data);
      if (request === 'ARP') {
        const receivedARP = protocols.parse_arp(data.slice(ETHER_SIZE));

        // ARP request Who has 192.168.6.1? Tell 192.168.6.2
        if (receivedARP.opcode === ARP_OPCODE_REQUEST && receivedARP.ip_dest[2] === 6) {

          // Change it to Who has Host.GatewayIP? Tell ProxyIp
          const etherSrc = proxyConfig.Host.SourceMac;
          const etherDst = [0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
          const ipSrc = proxyConfig.ProxyIp;
          const ipDst = proxyConfig.Host.GatewayIp;
          const arpHeader = protocols.make_arp(ARP_OPCODE_REQUEST, etherSrc, ipSrc, etherDst, ipDst);
          const etherHeader = protocols.make_ether2(etherDst, etherSrc, ETH_TYPE_ARP);
          const changedPacket = Buffer.concat([etherHeader, arpHeader]);
          sendToNetwork(changedPacket);
        }
      }
      else {
        const etherSrc = proxyConfig.Host.SourceMac;
        let etherDst;
        const ether = protocols.decode_ether(data);
        if (proxyConfig.Host.GatewayMac) {
          etherDst = proxyConfig.Host.GatewayMac;
        }
        else etherDst = ether.h_dest;
        const receivedIP = protocols.parseIpv4(data.slice(ETHER_SIZE));
        let ipDst;
        if (receivedIP.DestinationAddress[0] === proxyConfig.BB.GatewayIp[0]) {
          if (receivedIP.DestinationAddress[2] === proxyConfig.BB.GatewayIp[2]) {
            ipDst = proxyConfig.Host.GatewayIp;
          }
          else {
            ipDst = receivedIP.DestinationAddress;
            if (proxyConfig.ArpList[receivedIP.DestinationAddress[3]]) {
              etherDst = proxyConfig.ArpList[receivedIP.DestinationAddress[3]];
            }
            else {
              // Send ARP for host in local subnet
              const etherSrc = proxyConfig.Host.SourceMac;
              const etherDst = [0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
              const ipSrc = proxyConfig.ProxyIp;
              const ipDst = receivedIP.DestinationAddress;
              const arpHeader = protocols.make_arp(ARP_OPCODE_REQUEST, etherSrc, ipSrc, etherDst, ipDst);
              const etherHeader = protocols.make_ether2(etherDst, etherSrc, ETH_TYPE_ARP);
              const changedPacket = Buffer.concat([etherHeader, arpHeader]);
              sendToNetwork(changedPacket);
            }
            if (compareIp(receivedIP.DestinationAddress, proxyConfig.Host.SourceIp)) {
              etherDst = proxyConfig.Host.SourceMac;
            }
          }
        }
        else ipDst = receivedIP.DestinationAddress;
        const ipHeader = {
          Version: receivedIP.Version,
          IHL: receivedIP.IHL,
          TypeOfService: receivedIP.TypeOfService,
          TotalLength: receivedIP.TotalLength,
          Identification: receivedIP.Identification,
          Flags: receivedIP.Flags,
          FragmentOffset: receivedIP.FragmentOffset,
          TimeToLIve: receivedIP.TimeToLIve,
          Protocol: receivedIP.Protocol,
          HeaderChecksum: 0,
          SourceAddress: proxyConfig.ProxyIp,
          DestinationAddress: ipDst
        };
        let ipPayload = data.slice(ETHER_SIZE + IPV4_SIZE, ETHER_SIZE + ipHeader.TotalLength);
        if (ipHeader.Protocol === IP_TCP) {
          ipPayload = protocols.regenerateTcpChecksum(ipHeader, ipPayload);
        }
        if (ipHeader.Protocol === IPUDP) {
          ipPayload = Buffer.concat([ipPayload.slice(0, 6), Buffer.from([0, 0]), ipPayload.slice(8)]);
        }
        const ipBuff = protocols.encodeIpv4(ipHeader);
        const etherBuff = protocols.make_ether2(etherDst, etherSrc, ETH_TYPE_IPV4);
        const changedPacket = Buffer.concat([etherBuff, ipBuff, ipPayload]);
        sendToNetwork(changedPacket);
      }
    }
    else {
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
        default:
          console.log(request);
      }
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
      //emitterMod.emit('error', `Unidentified UDP packet type: sPort=${sPort} dPort=${dPort}`);
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
