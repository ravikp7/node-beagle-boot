const bp = require('binary-parser-encoder'); // Binary parser module
const Parser = bp.Parser;

const bootp = new Parser()
  .uint8('MessageType')
  .uint8('HardwareType')
  .uint8('HwAddressLength')
  .uint8('HopCount')
  .uint32be('TransactionId')
  .uint16be('SecondsElapsed')
  .uint16be('Flags')
  .array('ClientIpAddress', {
    type: 'uint8',
    length: 4
  })
  .array('YourIpAddress', {
    type: 'uint8',
    length: 4
  })
  .array('NextServerIpAddress', {
    type: 'uint8',
    length: 4
  })
  .array('RelayAgentIpAddress', {
    type: 'uint8',
    length: 4
  })
  .array('ClientMacAddress', {
    type: 'uint8',
    length: 6
  })
  .array('MacOffset', {
    type: 'uint8',
    length: 10
  })/*
  .string('ServerName', {
    encoding: 'ascii',
    length: 10
  })*/
  .array('ServerNameOffset', {
    type: 'uint8',
    length: 64
  })
  .array('BootFileName', {
    type: 'uint8',
    length: 128
  })
  .string('MagicCookie', {
    encoding: 'ascii',
    length: 4
  })
  .uint8('Option1')
  .uint8('Length1')
  .uint8('DhcpRequest')
  .uint8('Optionx')
  .uint8('Lengthx')
  .array('ReqIp', {
    type: 'uint8',
    length: 'Lengthx'
  })
  .uint8('Option2')
  .uint8('Length2')
  .string('HostName', {
    encoding: 'ascii',
    length: 'Length2'
  })
  .uint8('Option3')
  .uint8('Length3')
  .array('ParameterRequest', {
    type: 'uint8',
    length: 'Length3'
  })
  .uint8('Option4');

const encodeBootp = (packet)=> bootp.encode(packet);
const parseBootp = (data) => bootp.parse(data);

exports.encodeBootp = encodeBootp;
exports.parseBootp = parseBootp;