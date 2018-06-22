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