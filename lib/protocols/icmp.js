const bp = require('binary-parser-encoder'); // Binary parser module
const Parser = bp.Parser;
const ip = require('./ip');

const RouterSolicitation = new Parser()
  .uint8('Code')
  .uint16('Checksum')
  .uint16('Reserved');
const NeighbourSolicitation = new Parser()
  .uint8('Code')
  .uint16('Checksum')
  .uint16('Reserved')
  .array('TargetAddress', {
    type: 'uint8',
    length: 16
  });
const MulticastListener = new Parser()
  .uint8('Code')
  .uint16('Checksum')
  .uint16('Reserved')
  .uint16('MulticastRecords');

const icmp = new Parser()
  .endianess('big')
  .uint8('Type')
  .choice({
    tag: 'Type',
    choices: {
      133: RouterSolicitation,
      135: NeighbourSolicitation,
      143: MulticastListener
    }
  });

const MulticastAddressRecords = new Parser()
  .uint8('Type')
  .uint8('AuxDataLen')
  .uint16('NumberOfSources')
  .array('MulticastAddress', {
    type: 'uint8',
    length: 16
  });

// Function to parse ICMP
const parseIcmp = (data) => {
  const icmpPacket = icmp.parse(data);
  if (icmpPacket.Type === 143) {
    const totalRecords = icmpPacket.MulticastRecords;
    let i = 0;
    const records = [];
    while (i < totalRecords) {
      records.push(MulticastAddressRecords.parse(data.slice(8 + i*20)));
      i++;
    }
    icmpPacket.MulticastRecords = records;
  }
  return icmpPacket;
};

// Function to encode ICMP
const encodeIcmp = (icmpHeader, ipv6Pseudo, multicastRecords) => {
  let icmpBuff = icmp.encode(icmpHeader);
  if (icmpHeader.Type === 143) {
    const recordsBuff = MulticastAddressRecords.encode(multicastRecords);
    icmpBuff = Buffer.concat([icmpBuff, recordsBuff]);
  }
  // Calculating Checksum and adding it in packet
  if (!icmpHeader.Checksum) {
    const ipv6PseudoBuff = ip.encodeIpv6Pseudo(ipv6Pseudo);
    const icmpChecksumBuffer = Buffer.concat([ipv6PseudoBuff, icmpBuff]);
    const icmpParser = new Parser() // Parsing packet data as array of 2 byte words
      .array('data', {
        type: 'uint16be',
        length: icmpChecksumBuffer.length / 2
      });
    const icmpPacket = icmpParser.parse(icmpChecksumBuffer);
    // Checksum calculation
    let i = 0;
    let sum = 0;
    let a;
    while (i < icmpPacket.data.length) {
      sum += icmpPacket.data[i++];
      a = sum.toString(16);
      if (a.length > 4) {
        sum = parseInt(a[1] + a[2] + a[3] + a[4], 16) + 1;
      }
    }
    a = (~sum >>> 0).toString(16); // Invert bitwise and unsign the number
    sum = parseInt(a[4] + a[5] + a[6] + a[7], 16); // Taking 2 bytes out of the inverted bytes
    const icmpHeaderWithChecksum = Object.assign(icmpHeader);
    icmpHeaderWithChecksum.Checksum = sum;
    icmpBuff = encodeIcmp(icmpHeaderWithChecksum, ipv6Pseudo, multicastRecords);
  }
  return icmpBuff;
};

exports.parseIcmp = parseIcmp;
exports.encodeIcmp = encodeIcmp;