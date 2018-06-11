const bp = require('binary-parser-encoder'); // Binary parser module
const Parser = bp.Parser;

// Parser for IPv6 Header
const ipv6Hdr = new Parser()
  .endianess('big')
  .bit4('Version')
  .uint8('TrafficClass')
  .bit20('FlowLabel')
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
  .array('SourceAddress', {
    type: 'uint8',
    length: 4
  });

// Functions for parsing binary data
const parseIpv4 = (data) => ipv4Hdr.parse(data);
const parseIpv6 = (data) => ipv6Hdr.parse(data);

// exports
exports.parseIpv4 = parseIpv4;
exports.parseIpv6 = parseIpv6;