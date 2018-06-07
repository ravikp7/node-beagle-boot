const bp = require('binary-parser'); // Binary parser module
const Parser = bp.Parser;

// Resource Record Type
const RR_TYPE_ADDRESS = 1;
const RR_TYPE_POINTER = 12;
const RR_TYPE_TEXT = 16;
const RR_TYPE_SERVICE = 33;

const QUESTION_SIZE = 4; // Size of question section excluding Domain Name
const RR_ADDRESS_SIZE = 14; // Size of Address RR section excluding Domain Name
const RR_TXT_DATA_SIZE = 11; // Size of Text Data RR section excluding Domain Name
const RR_POINTER_SIZE = 10; // Size of Pointer RR section excluding Domain Name
const RR_SERVICE_SIZE = 16; // Size of  Service RR section excluding Domain Name

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////// Headers for parsing (Binary-Parser) /////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////

// Paser for mDNS header
const dnsHdr = new Parser()
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

// Parser for Domain Name
const dnsName = new Parser()
  .endianess('big')
  .uint8('len') // String Length
  .string('Name', {
    encoding: 'ascii',
    length: 'len'
  });

// Parser for mDNS question Type and Class Fields
const mdnsQuesTypeClass = new Parser()
  .uint16be('QType') // Question Type
  .uint16be('QClass'); // Question Class

// mDNS RR Type Parsers
const parseAddress = new Parser()
  .endianess('big')
  .uint16('Class') // RR Class
  .uint32('TTL') // Time to Live
  .uint16('RDLength') // Resource Data Length
  .array('Address', { // 32 bit IP address
    type: 'uint8',
    length: 4
  });
const parsePointer = new Parser()
  .endianess('big')
  .uint16('Class') // RR Class
  .uint32('TTL') // Time to Live
  .uint16('RDLength'); // Resource Data Length
const parseText = new Parser()
  .endianess('big')
  .uint16('Class') // RR Class
  .uint32('TTL') // Time to Live
  .uint16('RDLength') // Resource Data Length
  .uint8('TxtLength') // Text Data Length
  .string('TxtData', { // Text Data
    encoding: 'ascii',
    length: 'TxtLength'
  });
const parseService = new Parser()
  .endianess('big')
  .uint16('Class') // RR Class
  .uint32('TTL') // Time to Live
  .uint16('RDLength') // Resource Data Length
  .uint16('Priority') // Priority of Target Host, Lower = more preferred
  .uint16('Weight') // Relative weight for records with same priority, higher = more preferred
  .uint16('Port'); // TCP Port on whicch service is to be found


// mDNS Resource Record Parsing
const dnsResourceRecordParser = new Parser().uint16be('RRType').choice('Fields', {
  tag: 'RRType',
  choices: {
    1: parseAddress, // Parses when RR Type = Address
    12: parsePointer, // Parses when RR Type = Pointer
    16: parseText, // Parses when RR Type = Text String
    33: parseService // Parses when RR Type = Service Record
  }
});

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////// Packet decode functions ///////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * @summary Extract DNS Name Using DNS Name Notation and Compression
 * @public
 * @description See http://www.tcpipguide.com/free/t_DNSNameNotationandMessageCompressionTechnique-2.htm
 * 
 * @param {Buffer} data -mDNS Packet
 * @param {Number} buffCount - Keeps Buffer bytes count
 * @returns {Object} result - Containing Name and new buffCount
 * 
 * @example
 *{ name:
 *   [ { len: 25, Name: 'Cloud9 IDE for beaglebone' },
 *     { len: 5, Name: '_http' },
 *     { len: 4, Name: '_tcp' },
 *     { len: 5, Name: 'local' } ],
 *  newBuffCount: 56 }
 */
const getDnsName = (data, buffCount) => {
  const ONE_BYTE_OFFSET = 1; // Used to move pointer to next byte to be processed
  const MAX_LABEL_SIZE = 63; // Max Label Size for Domain Name
  const NAME_POINTER_IDENTIFIER = 192; // Identifies a Name Pointer
  const name = []; // Stores the Name
  const result = {}; // Stores the Name and Next Byte Location
  let newBuffCount = buffCount; // Keeps Count of Next Byte in Buffer
  let buffPointer = buffCount; // Points to Locations to find Names
  let namePartCount = 0; // Keeps Name parts count
  let pointerFound = false; // Keeps track if pointer is found
  while (data[buffPointer] !== 0) { // Keep Looping Until finds a Zero which marks end of Domain Name
    if (data[buffPointer] <= MAX_LABEL_SIZE) { // Real Name Found (not Pointer)
      name.push(dnsName.parse(data.slice(buffPointer))); // Parse it and push this Name part
      buffPointer += (name[namePartCount].Name.length + ONE_BYTE_OFFSET); // Move Pointer beside previous Name part
      namePartCount++;
      if (!pointerFound) newBuffCount = buffPointer; // Keep Buffer Count Pointer moving until a pointer is found
    } else if (data[buffPointer] >= NAME_POINTER_IDENTIFIER) { // Pointer to Name is found     
      let namePointer = buffPointer + ONE_BYTE_OFFSET; // Get the Pointer that points the Name
      let nameLocation = data[namePointer]; // Get the location of Name from pointer value
      if (!pointerFound) newBuffCount = namePointer + ONE_BYTE_OFFSET; // Move to next byte
      pointerFound = true;
      buffPointer = nameLocation; // Point to new Name Location
    }
  }
  if (!pointerFound) newBuffCount += ONE_BYTE_OFFSET; // Move to next byte
  result.name = name; // Final Name
  result.newBuffCount = newBuffCount; // Final Buffer Count Pointer
  return result;
};


/**
 * @summary Parse DNS Payload
 * @public
 * @description Parses DNS Packet Questions and Resource Record Sections
 * 
 * @param {Buffer} data - mDNS Packet
 * @param {Number} totalNum - Total no. of entries in a Section
 * @param {Number} offset
 * @param {Parser} parser : Parser for Question or Resource Record Section
 * @returns {Object} result
 * 
 * @example
 * { section:
 * [ { name: [Array], otherFields: [Object] },
 *   { name: [Array], otherFields: [Object] },
 *   { name: [Array], otherFields: [Object] },
 *   { name: [Array], otherFields: [Object] } ],
 * newOffset: 137 }
 */
const parseDnsPayload = (data, totalNum, offset, parser) => {
  let buffCount = offset; // Keeps Buffer Count
  let nameCount = 0; // Keeps Names Count
  const section = []; // Represents a Section in Question or Resource Record
  const result = {}; // Stores the Section and offset for next Section
  while (nameCount < totalNum) { // Loop till all Names are parsed in a Section
    const sectionEntry = {}; // Represents a Section Entry
    let result = getDnsName(data, buffCount); // Get DNS Name
    buffCount = result.newBuffCount; // Get new Buffer Count Pointer Location
    sectionEntry.name = result.name; // Fill Name in Section Entry
    let otherFields = parser.parse(data.slice(buffCount)); // Get Fields other than DNS Name
    if (otherFields.QType) { // It is Question Section
      buffCount = buffCount + QUESTION_SIZE; // Move Buffer Count Pointer to next byte to be processed
    }
    // Resource Record Section
    let RRType = otherFields.RRType;
    if (RRType) { // Check Resource Record Type
      if (RRType === RR_TYPE_ADDRESS) {
        buffCount += RR_ADDRESS_SIZE;
      }
      if (RRType === RR_TYPE_POINTER) {
        buffCount += RR_POINTER_SIZE;
        let result = getDnsName(data, buffCount); // Domain Name is present at end in RR TYPE POINTER
        otherFields.DomainName = result.name;
        buffCount = result.newBuffCount;
      }
      if (RRType === RR_TYPE_TEXT) {
        buffCount += RR_TXT_DATA_SIZE + otherFields.Fields.TxtLength;
      }
      if (RRType === RR_TYPE_SERVICE) {
        buffCount += RR_SERVICE_SIZE;
        let result = getDnsName(data, buffCount, offset); // Target is present at end in RR TYPE SERVICE
        otherFields.Target = result.name;
        buffCount = result.newBuffCount;
      }
    }
    sectionEntry.otherFields = otherFields;
    section.push(sectionEntry);
    nameCount++;
  }
  result.section = section; // Store Parsed Section
  result.newOffset = buffCount; // Store offset for next Section
  return result;
};

/**
 * @summary Parse mDNS Packet
 * @param {Buffer} data
 * @return {Object} mDnsPacket
 * 
 * @example
 * { Header:
 *  { ID: 0,
 *    QR: 0,
 *    Opcode: 0,
 *    AA: 0,
 *    TC: 0,
 *    RD: 0,
 *    RA: 0,
 *    Z: 0,
 *    RCode: 0,
 *    QCount: 4,
 *    ANCount: 0,
 *    NSCount: 6,
 *    ARCount: 0 },
 * Questions:
 *  [ { name: [Array], otherFields: [Object] },
 *    { name: [Array], otherFields: [Object] },
 *    { name: [Array], otherFields: [Object] },
 *    { name: [Array], otherFields: [Object] } ],
 * AnswerRecords: [],
 * NameServers:
 *  [ { name: [Array], otherFields: [Object] },
 *    { name: [Array], otherFields: [Object] },
 *    { name: [Array], otherFields: [Object] },
 *    { name: [Array], otherFields: [Object] },
 *    { name: [Array], otherFields: [Object] },
 *    { name: [Array], otherFields: [Object] } ],
 * AdditionalRecords: [] }
 */
const dnsParse = (data) => {
  const mDnsPacket = {}; // To be returned
  const HDR_SIZE = 12; // Header Size
  const hdrBuff = data.slice(0, HDR_SIZE); // mDNS Header Buffer
  mDnsPacket.Header = dnsHdr.parse(hdrBuff); // mDNS Parsed Header
  const qCount = mDnsPacket.Header.QCount; // Get no. of entries in Question Section
  const answerCount = mDnsPacket.Header.ANCount; // Get no. of entries in Answer Record Section
  const authoritativeCount = mDnsPacket.Header.NSCount; // Get no. of entries in Authoritative Record Section
  const additionalCount = mDnsPacket.Header.ARCount; // Get no. of entries in Additional Record Section

  // Parse Question Section
  const qParseResult = parseDnsPayload(data, qCount, HDR_SIZE, mdnsQuesTypeClass);
  mDnsPacket.Questions = qParseResult.section;
  let offset = qParseResult.newOffset;

  // Parse Answer Record Section
  const anParseResult = parseDnsPayload(data, answerCount, offset, dnsResourceRecordParser);
  mDnsPacket.AnswerRecords = anParseResult.section;
  offset = anParseResult.newOffset;

  // Parse Authoritative (Name Server) Record Section
  const nsParseResult = parseDnsPayload(data, authoritativeCount, offset, dnsResourceRecordParser);
  mDnsPacket.NameServers = nsParseResult.section;
  offset = nsParseResult.newOffset;

  // Parse Additional Record Section
  const arParseResult = parseDnsPayload(data, additionalCount, offset, dnsResourceRecordParser);
  mDnsPacket.AdditionalRecords = arParseResult.section;
  return mDnsPacket;
};

// exports
exports.decodeDNS = dnsParse;