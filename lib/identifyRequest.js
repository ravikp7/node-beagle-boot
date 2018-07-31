const protocols = require('./protocols');
const constants = require('./constants');

// Function to identify request packet
module.exports = (server, buff) => {
  let rndisHeaderSize = (server.foundDevice === constants.LINUX_COMPOSITE_DEVICE) ? 0 : constants.RNDIS_SIZE;
  const ether = protocols.decode_ether(buff.slice(rndisHeaderSize));
  if (ether.h_proto === constants.ETH_TYPE_ARP) return 'ARP';
  if (ether.h_proto === constants.ETH_TYPE_IPV4) {
    const ipv4 = protocols.parseIpv4(buff.slice(rndisHeaderSize + constants.ETHER_SIZE));
    //console.log(ipv4);
    if (ipv4.Protocol === 2) return 'IGMP';
    if (ipv4.Protocol === constants.IP_UDP) {
      const udp = protocols.parse_udp(buff.slice(rndisHeaderSize + constants.ETHER_SIZE + constants.IPV4_SIZE));
      const sPort = udp.udpSrc;
      const dPort = udp.udpDest;
      if (sPort == constants.BOOTPC && dPort == constants.BOOTPS) return 'BOOTP'; // Port 68: BOOTP Client, Port 67: BOOTP Server
      if (dPort == constants.TFTP_PORT) {
        const opcode = buff[rndisHeaderSize + constants.ETHER_SIZE + constants.IPV4_SIZE + constants.UDP_SIZE + 1];
        if (opcode == 1) return 'TFTP'; // Opcode = 1 for Read Request (RRQ)
        if (opcode == 4) return 'TFTP_Data'; // Opcode = 4 for Acknowledgement (ACK)
      }
      if (dPort == constants.NETCONSOLE_UDP_PORT) return 'NC';
      if (dPort == constants.MDNS_UDP_PORT && sPort == constants.MDNS_UDP_PORT) return 'mDNS';
      //emitterMod.emit('error', `Unidentified UDP packet type: sPort=${sPort} dPort=${dPort}`);
    }
  }
  if (ether.h_proto === constants.ETH_TYPE_IPV6) {
    const ipv6 = protocols.parseIpv6(buff.slice(rndisHeaderSize + constants.ETHER_SIZE));
    //console.log(ipv6);
    if (ipv6.NextHeader === constants.IPV6_HOP_BY_HOP_OPTION) {
      const ipv6Option = protocols.parseIpv6Option(buff.slice(rndisHeaderSize + constants.ETHER_SIZE + constants.IPV6_SIZE));
      if (ipv6Option.NextHeader === constants.IPV6_ICMP) return 'ICMPv6';
    }
    if (ipv6.NextHeader === constants.IPUDP) {
      const udp = protocols.parse_udp(buff.slice(rndisHeaderSize + constants.ETHER_SIZE + constants.IPV6_SIZE));
      if (udp.udpSrc == constants.MDNS_UDP_PORT && udp.udpDest == constants.MDNS_UDP_PORT) return 'mDNS';
    }
  }
  return 'unidentified';
};