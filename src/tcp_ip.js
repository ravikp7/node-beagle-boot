const bp = require('binary-parser'); // Binary parser module
const Parser = bp.Parser;

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////// Headers for parsing (Binary-Praser) /////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////

// mDNS header for parsing
const mdnsHdr = new Parser()
  .endianess('big')
  .uint16('ID') // Identifier
  .bit1('QR') // Query/Response Flag
  .bit4('Opcode') // Operation Code
  .bit1('AA') // Authoritative Answer Flag
  .bit1('TC') // Truncation Flag
  .bit1('RD') // Recursion Desired
  .bit1('RA') // Recursion Available
  .bit3('Z') // Zero
  .bit4('RCode') // Response Code
  .uint16('QCount') // Question Count
  .uint16('ANCount') // Answer Record Count
  .uint16('NSCount') // Authority Record Count
  .uint16('ARCount'); // Additional Record Count

// mDNS question Name for parsing
const mdnsQuesName = new Parser()
  .endianess('big')
  .uint8('len')
  .string('QName', {
    encoding: 'ascii',
    length: 'len'
  });

// mDNS question Type and Class parsing
const mdnsQuesTypeClass = new Parser()
  .uint16be('QType') // Question Type
  .uint16be('QClass'); // Question Class


///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////// Packet decode functions ///////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////

// Function for parsing DNS Question Names
// Using DNS Name Notation and Compression, See http://www.tcpipguide.com/free/t_DNSNameNotationandMessageCompressionTechnique-2.htm
const dnsQuesParse = (data, qCount, hdrSize) => {
  let buffCount = 0; // Keeps Buffer Count
  let quesCount = 0; // Keeps Question Count
  const questions = [];
  const oneByteOffset = 1;
  const qTypeClassSize = 4;
  const maxLabelSize = 63;
  const namePointerIdentifier = 192;
  while (quesCount < qCount) {
    const qSection = {};
    const qName = [];
    let namePartCount = 0; // Keeps Question Name part count
    let buffPointer = buffCount;
    let pointerFound = false;
    while (data[buffPointer] !== 0) {
      if (data[buffPointer] <= maxLabelSize) { // Real Name
        qName.push(mdnsQuesName.parse(data.slice(buffPointer)));
        buffPointer += (qName[namePartCount].QName.length + oneByteOffset);
        namePartCount++;
        if (!pointerFound) buffCount = buffPointer;
      } else if (data[buffPointer] >= namePointerIdentifier) { // Pointer to Name
        pointerFound = !pointerFound;
        let namePointer = buffPointer + oneByteOffset;
        let pointerValue = data[namePointer] - hdrSize;
        buffCount = namePointer;
        buffPointer = pointerValue;
      }
    }
    let qTypeClass = mdnsQuesTypeClass.parse(data.slice(buffCount + oneByteOffset));
    qSection.qName = qName;
    qSection.qTypeClass = qTypeClass;
    questions.push(qSection);
    buffCount = buffCount + qTypeClassSize + oneByteOffset;
    quesCount++;
  }
  return questions;
};

// Function to parse mDNS
const dnsParse = (data) => {
  const mdnsPacket = {}; // To be returned
  const hdrSize = 12; // Header Size
  const hdrBuff = Buffer.alloc(hdrSize); // mDNS Header
  data.copy(hdrBuff, 0, 0, hdrSize);
  mdnsPacket.Header = mdnsHdr.parse(hdrBuff);
  const qCount = mdnsPacket.Header.QCount;
  mdnsPacket.Questions = dnsQuesParse(data.slice(hdrSize), qCount, hdrSize);
  return mdnsPacket;
};

// exports
exports.decodeDNS = dnsParse;