const bp = require('binary-parser-encoder'); // Binary parser module
const Parser = bp.Parser;

// Parser for IPv6 Header
const ipv6Hdr = new Parser()
  .endianess('big')
  //.bit4('Version')
  //.uint8('TrafficClass')
  //.bit20('FlowLabel') // Left 4 bits to hackaround bug
  .array('VTF', {
    type: 'uint8',
    length: 4
  })
  .uint16('PayloadLength')
  .uint8('NextHeader')
  .uint8('HopLimit')
  .array('SourceAddress', {
    type: 'uint8',
    length: 16
  })
  .array('DestinationAddress', {
    type: 'uint8',
    length: 16
  });

// IPv6 Hop By Hop Option
const ipv6Option = new Parser()
  .endianess('big')
  .uint8('NextHeader')
  .uint8('Length')
  .string('Data', {
    encoding: 'hex',
    length: 'Length'
  });

// Ipv6 Pseudo Header
const ipv6PseudoHeader = new Parser()
  .endianess('big')
  .array('SourceAddress', {
    type: 'uint8',
    length: 16
  })
  .array('DestinationAddress', {
    type: 'uint8',
    length: 16
  })
  .uint32('Length')
  .array('Zeros', {
    type: 'uint8',
    length: 3
  })
  .uint8('NextHeader');

// Parser for IPv4 Header
const ipv4Hdr = new Parser()
  .endianess('big')
  .bit4('Version')
  .bit4('IHL')
  .uint8('TypeOfService')
  .uint16('TotalLength')
  .uint16('Identification')
  .bit3('Flags')
  .bit13('FragmentOffset')
  .uint8('TimeToLIve')
  .uint8('Protocol')
  .uint16('HeaderChecksum')
  .array('SourceAddress', {
    type: 'uint8',
    length: 4
  })
  .array('DestinationAddress', {
    type: 'uint8',
    length: 4
  });

const ipv4Option = new Parser()
  .endianess('big')
  .uint8('Type')
  .uint8('Length')
  .uint16('Data');

// Functions for parsing binary data
const parseIpv4 = (data) => ipv4Hdr.parse(data);
const parseIpv6 = (data) => ipv6Hdr.parse(data);

// Functions for encoding data
const encodeIpv4 = (ipHeader, options) => {
  const ipHdrBuff = ipv4Hdr.encode(ipHeader);
  const ipOptionsBuff = ipv4Option.encode(options);
  let ipBuff = Buffer.concat([ipHdrBuff, ipOptionsBuff]);

  // Calculating Checksum and adding it in packet
  if (!ipHeader.HeaderChecksum) {
    const ip = new Parser() // Parsing packet data as array of 2 byte words
      .array('data', {
        type: 'uint16be',
        length: ipBuff.length / 2
      });
    const ipPacket = ip.parse(ipBuff);
    // Checksum calculation
    let i = 0;
    let sum = 0;
    let a;
    while (i < ipPacket.data.length) {
      sum += ipPacket.data[i++];
      a = sum.toString(16);
      if (a.length > 4) {
        sum = parseInt(a[1] + a[2] + a[3] + a[4], 16) + 1;
      }
    }
    a = (~sum >>> 0).toString(16); // Invert bitwise and unsign the number
    sum = parseInt(a[4] + a[5] + a[6] + a[7], 16); // Taking 2 bytes out of the inverted bytes
    const ipHeaderWithChecksum = Object.assign(ipHeader);
    ipHeaderWithChecksum.HeaderChecksum = sum;
    ipBuff = encodeIpv4(ipHeaderWithChecksum, options);
  }
  return ipBuff;
};

const encodeIpv6 = (ipHeader) => ipv6Hdr.encode(ipHeader);

const parseIpv6Option = (header) => ipv6Option.parse(header);

const encodeIpv6Pseudo = (header) => ipv6PseudoHeader.encode(header);

// exports
exports.parseIpv4 = parseIpv4;
exports.parseIpv6 = parseIpv6;
exports.encodeIpv4 = encodeIpv4;
exports.encodeIpv6 = encodeIpv6;
exports.parseIpv6Option = parseIpv6Option;
exports.encodeIpv6Pseudo = encodeIpv6Pseudo;