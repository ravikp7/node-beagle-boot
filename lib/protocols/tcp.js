const bp = require('binary-parser-encoder'); // Binary parser module
const Parser = bp.Parser;

const checksumEncoder = new Parser()
  .endianess('big')
  .uint16('Checksum');

const tcpPseudoHeader = new Parser()
  .endianess('big')
  .array('SourceAddress', {
    type: 'uint8',
    length: 4
  })
  .array('DestinationAddress', {
    type: 'uint8',
    length: 4
  })
  .uint8('Reserved')
  .uint8('Protocol')
  .uint16('TCPLength');

const calculateChecksum = (buff) => {
  if (buff.length % 2 !== 0) buff = Buffer.concat([buff, Buffer.from([0])]);
  const check = new Parser() // Parsing packet data as array of 2 byte words
    .array('data', {
      type: 'uint16be',
      length: buff.length / 2
    });
  const packet = check.parse(buff);
  // Checksum calculation
  let i = 0;
  let sum = 0;
  let a;
  while (i < packet.data.length) {
    sum += packet.data[i++];
    a = sum.toString(16);
    if (a.length > 4) {
      sum = parseInt(a[1] + a[2] + a[3] + a[4], 16) + 1;
    }
  }
  a = (~sum >>> 0).toString(16); // Invert bitwise and unsign the number
  sum = parseInt(a[4] + a[5] + a[6] + a[7], 16); // Taking 2 bytes out of the inverted bytes
  return sum;
};

const regenerateTcpChecksum = (ipHeader, tcpPacket) => {
  const tcpPseudo = {
    SourceAddress: ipHeader.SourceAddress,
    DestinationAddress: ipHeader.DestinationAddress,
    Reserved: 0,
    Protocol: ipHeader.Protocol,
    TCPLength: tcpPacket.length
  };
  const pseudoBuff = tcpPseudoHeader.encode(tcpPseudo);

  // Set Checksum 0 in TCP
  const newTcpPacket = Buffer.concat([tcpPacket.slice(0, 16), Buffer.from([0, 0]), tcpPacket.slice(18)]);
  const checksum = {
    Checksum: calculateChecksum(Buffer.concat([pseudoBuff, newTcpPacket]))
  };
  const tcpWithChecksum = Buffer.concat([tcpPacket.slice(0, 16), checksumEncoder.encode(checksum), tcpPacket.slice(18)]);
  return tcpWithChecksum;
};

exports.regenerateTcpChecksum = regenerateTcpChecksum;