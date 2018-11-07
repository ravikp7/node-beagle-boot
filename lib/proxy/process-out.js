const constants = require('../constants');
const protocols = require('../protocols');
const proxyUtils = require('./proxy-utils');
const identifyRequest = require('../identifyRequest');

exports.processOut = (server, capture, data, proxyConfig) => {
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
  const request = identifyRequest(server, data);
  if (request === 'ARP') {
    const receivedARP = protocols.parse_arp(data.slice(constants.ETHER_SIZE));

    // ARP request Who has 192.168.6.1? Tell 192.168.6.2
    if (receivedARP.opcode === constants.ARP_OPCODE_REQUEST && receivedARP.ip_dest[2] === 6) {

      // Change it to Who has Host.GatewayIP? Tell ProxyIp
      const etherSrc = proxyConfig.Host.SourceMac;
      const etherDst = [0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
      const ipSrc = proxyConfig.ProxyIp;
      const ipDst = proxyConfig.Host.GatewayIp;
      const arpHeader = protocols.make_arp(constants.ARP_OPCODE_REQUEST, etherSrc, ipSrc, etherDst, ipDst);
      const etherHeader = protocols.make_ether2(etherDst, etherSrc, constants.ETH_TYPE_ARP);
      const changedPacket = Buffer.concat([etherHeader, arpHeader]);
      proxyUtils.sendToNetwork(capture, changedPacket);
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
    const receivedIP = protocols.parseIpv4(data.slice(constants.ETHER_SIZE));
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
          const arpHeader = protocols.make_arp(constants.ARP_OPCODE_REQUEST, etherSrc, ipSrc, etherDst, ipDst);
          const etherHeader = protocols.make_ether2(etherDst, etherSrc, constants.ETH_TYPE_ARP);
          const changedPacket = Buffer.concat([etherHeader, arpHeader]);
          proxyUtils.sendToNetwork(capture, changedPacket);
        }
        if (proxyUtils.compareIp(receivedIP.DestinationAddress, proxyConfig.Host.SourceIp)) {
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
    let ipPayload = data.slice(constants.ETHER_SIZE + constants.IPV4_SIZE, constants.ETHER_SIZE + ipHeader.TotalLength);
    if (ipHeader.Protocol === constants.IP_TCP) {
      ipPayload = protocols.regenerateTcpChecksum(ipHeader, ipPayload);
    }
    if (ipHeader.Protocol === constants.IP_UDP) {
      ipPayload = Buffer.concat([ipPayload.slice(0, 6), Buffer.from([0, 0]), ipPayload.slice(8)]);
    }
    const ipBuff = protocols.encodeIpv4(ipHeader);
    const etherBuff = protocols.make_ether2(etherDst, etherSrc, constants.ETH_TYPE_IPV4);
    const changedPacket = Buffer.concat([etherBuff, ipBuff, ipPayload]);
    proxyUtils.sendToNetwork(capture, changedPacket);
  }
};