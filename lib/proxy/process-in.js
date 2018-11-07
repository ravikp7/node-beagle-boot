const constants = require('../constants');
const protocols = require('../protocols');
const proxyUtils = require('./proxy-utils');
const identifyRequest = require('../identifyRequest');

exports.processIn = (server, capture, buffer, proxyConfig, emitter) => {
  const request = identifyRequest(server, buffer);
  if (request === 'ARP') {
    const receivedARP = protocols.parse_arp(buffer.slice(constants.ETHER_SIZE));
    if (receivedARP.ip_dest[3] === proxyConfig.ProxyIp[3]) {

      // Response Host.GatewayIp is at Host.GatewayMac
      if (receivedARP.opcode === constants.ARP_OPCODE_REPLY) {
        if (receivedARP.ip_source[3] === proxyConfig.Host.GatewayIp[3]) {
          proxyConfig.Host.GatewayMac = receivedARP.hw_source;
          const etherSrc = proxyConfig.BB.GatewayMac;
          const etherDst = proxyConfig.BB.SourceMac;
          const ipSrc = proxyConfig.BB.GatewayIp;
          const ipDst = proxyConfig.BB.SourceIp;
          const arpHeader = protocols.make_arp(constants.ARP_OPCODE_REPLY, etherSrc, ipSrc, etherDst, ipDst);
          const etherHeader = protocols.make_ether2(etherDst, etherSrc, constants.ETH_TYPE_ARP);
          const proxyArp = Buffer.concat([etherHeader, arpHeader], constants.ETHER_SIZE + constants.ARP_SIZE);
          emitter.emit('outTransfer', server, proxyArp, 'ARP');
        }
        else {
          proxyConfig.ArpList[receivedARP.ip_source[3]] = receivedARP.hw_source;
        }
      }

      // Request Who has ProxyIp ? Tell SomeIp
      if (receivedARP.opcode === constants.ARP_OPCODE_REQUEST) {
        const etherSrc = proxyConfig.Host.SourceMac;
        const etherDst = receivedARP.hw_source;
        const ipSrc = proxyConfig.ProxyIp;
        const ipDst = receivedARP.ip_source;
        const arpHeader = protocols.make_arp(constants.ARP_OPCODE_REPLY, etherSrc, ipSrc, etherDst, ipDst);
        const etherHeader = protocols.make_ether2(etherDst, etherSrc, constants.ETH_TYPE_ARP);
        const proxyArp = Buffer.concat([etherHeader, arpHeader], constants.ETHER_SIZE + constants.ARP_SIZE);
        proxyUtils.sendToNetwork(capture, proxyArp);
      }
    }
  }

  else {
    const etherSrc = proxyConfig.BB.GatewayMac;
    const etherDst = proxyConfig.BB.SourceMac;
    const receivedIP = protocols.parseIpv4(buffer.slice(constants.ETHER_SIZE));
    if (receivedIP.DestinationAddress[3] === proxyConfig.ProxyIp[3]) {
      let ipSrc;
      if (proxyUtils.compareIp(receivedIP.SourceAddress, proxyConfig.Host.GatewayIp)) {
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
      let ipPayload = buffer.slice(constants.ETHER_SIZE + constants.IPV4_SIZE, constants.ETHER_SIZE + ipHeader.TotalLength);
      if (ipHeader.Protocol === constants.IP_TCP) {
        ipPayload = protocols.regenerateTcpChecksum(ipHeader, ipPayload);
      }
      if (ipHeader.Protocol === constants.IP_UDP) {
        ipPayload = Buffer.concat([ipPayload.slice(0, 6), Buffer.from([0, 0]), ipPayload.slice(8)]);
      }
      const ipBuff = protocols.encodeIpv4(ipHeader);
      const etherBuff = protocols.make_ether2(etherDst, etherSrc, constants.ETH_TYPE_IPV4);
      const changedPacket = Buffer.concat([etherBuff, ipBuff, ipPayload]);
      emitter.emit('outTransfer', server, changedPacket, 'IP');
    }
  }
};