const bp = require('binary-parser-encoder'); // Binary parser module
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
const NAME_POINTER_IDENTIFIER = 192; // Identifies a Name Pointer

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
  .endianess('big')
  .uint16('QType') // Question Type
  .bit1('UnicastResponse')
  .bit15('QClass'); // Question Class

// mDNS RR Type Parsers
const parseIpv4Address = new Parser()
  .endianess('big')
  .bit1('CacheFlush')
  .bit15('Class') // RR Class
  .uint32('TTL') // Time to Live
  .uint16('RDLength') // Resource Data Length
  .array('Address', { // 32 bit IP address
    type: 'uint8',
    length: 4
  });
const parsePointer = new Parser()
  .endianess('big')
  .bit1('CacheFlush')
  .bit15('Class') // RR Class
  .uint32('TTL') // Time to Live
  .uint16('RDLength'); // Resource Data Length
const parseText = new Parser()
  .endianess('big')
  .bit1('CacheFlush')
  .bit15('Class') // RR Class
  .uint32('TTL') // Time to Live
  .uint16('RDLength') // Resource Data Length
  .uint8('TxtLength') // Text Data Length
  .string('TxtData', { // Text Data
    encoding: 'ascii',
    length: 'TxtLength'
  });
const parseIpv6Address = new Parser()
  .endianess('big')
  .bit1('CacheFlush')
  .bit15('Class') // RR Class
  .uint32('TTL') // Time to Live
  .uint16('RDLength') // Resource Data Length
  .array('Address', { // 16 byte IP address
    type: 'uint8',
    length: 16
  });
const parseService = new Parser()
  .endianess('big')
  .bit1('CacheFlush')
  .bit15('Class') // RR Class
  .uint32('TTL') // Time to Live
  .uint16('RDLength') // Resource Data Length
  .uint16('Priority') // Priority of Target Host, Lower = more preferred
  .uint16('Weight') // Relative weight for records with same priority, higher = more preferred
  .uint16('Port'); // TCP Port on whicch service is to be found


// mDNS Resource Record Parsing
const dnsResourceRecordParser = new Parser().uint16be('RRType').choice({
  tag: 'RRType',
  choices: {
    1: parseIpv4Address, // Parses when RR Type = IPv4 Address
    12: parsePointer, // Parses when RR Type = Pointer
    16: parseText, // Parses when RR Type = Text String
    28: parseIpv6Address, // Parses when RR Type = IPv6 Address
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
 * @example (return)
 *{ name: ['Cloud9 IDE for beaglebone', '_http', '_tcp', 'local'],
 *  newBuffCount: 56 }
 */
const getDnsName = (data, buffCount) => {
  const ONE_BYTE_OFFSET = 1; // Used to move pointer to next byte to be processed
  const MAX_LABEL_SIZE = 63; // Max Label Size for Domain Name
  const name = []; // Stores the Name
  const result = {}; // Stores the Name and Next Byte Location
  let newBuffCount = buffCount; // Keeps Count of Next Byte in Buffer
  let buffPointer = buffCount; // Points to Locations to find Names
  let namePartCount = 0; // Keeps Name parts count
  let pointerFound = false; // Keeps track if pointer is found
  while (data[buffPointer] !== 0) { // Keep Looping Until finds a Zero which marks end of Domain Name
    if (data[buffPointer] <= MAX_LABEL_SIZE) { // Real Name Found (not Pointer)
      name.push(dnsName.parse(data.slice(buffPointer)).Name); // Parse it and push this Name part
      buffPointer += (name[namePartCount].length + ONE_BYTE_OFFSET); // Move Pointer beside previous Name part
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
        sectionEntry.DomainName = result.name;
        buffCount = result.newBuffCount;
      }
      if (RRType === RR_TYPE_TEXT) {
        buffCount += RR_TXT_DATA_SIZE + otherFields.TxtLength;
      }
      if (RRType === RR_TYPE_SERVICE) {
        buffCount += RR_SERVICE_SIZE;
        let result = getDnsName(data, buffCount, offset); // Target is present at end in RR TYPE SERVICE
        sectionEntry.Target = result.name;
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

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////// Packet encode functions ///////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * @summary Encode DNS name
 * @param {Array} name - Contains Name parts as string
 * @param {Object} namePointers - Contains pointer to a Name part
 * @param {Number} buffCount - Keeps count of data buffer bytes
 * @return {Object} result
 * @example (return)
 * { nameBuff: <Buffer c0 0c>,
 * newNamePointers:
 *  { '2': 77,
 *    '7': 79,
 *    '168': 81,
 *    '192': 85,
 *    'Cloud9 IDE for beaglebone': 12,
 *    _http: 38,
 *    _tcp: 44,
 *    local: 49,
 *    beaglebone: 60,
 *    'in-addr': 89,
 *    arpa: 97,
 *   'Node-RED for beaglebone': 107 },
 * newbuffCount: 202 }
 */
const getNameBuff = (name, namePointers, buffCount) => {
  const NAME_POINTER_BUFFER_SIZE = 2; // Name pointer buffer size (Two value- Identifier and Pointer)let 
  let storePointer = true;
  const result = {}; // Object to be returned
  let nameBuff = Buffer.alloc(0); // Stores name
  let i;
  for (i = 0; i < name.length; i++) {
    if (!namePointers[name[i]]) { // When the name part has a pointer
      if (storePointer) namePointers[name[i]] = buffCount; // Save name part pointer
      else if (name[i].length > 1) namePointers[name[i]] = buffCount;
      if (name[i].length < 2 && storePointer) storePointer = false; // Store Pointer only once for single character name part
      const namePart = { // name part for encoding
        len: name[i].length,
        Name: name[i]
      };
      const namePartBuff = dnsName.encode(namePart); // Encode name part
      nameBuff = Buffer.concat([nameBuff, namePartBuff]); // Concat name parts buffers
      buffCount += namePartBuff.length; // Increse buffer counter
    } else { // When the name part doesn't have a pointer
      const pointerBuffer = Buffer.alloc(2); // Buffer to store pointer
      pointerBuffer.writeUInt8(NAME_POINTER_IDENTIFIER, 0); // Write pointer identifier
      pointerBuffer.writeUInt8(namePointers[name[i]], 1); // Write pointer value
      nameBuff = Buffer.concat([nameBuff, pointerBuffer]); // Concat all name parts
      buffCount += NAME_POINTER_BUFFER_SIZE; // Increment Buffer counter
      break; // Break loop when pointer is found
    }
  }
  if (i === name.length) { // Push a zero when pointer isn't foundto mark name end
    nameBuff = Buffer.concat([nameBuff, Buffer.alloc(1)]);
    buffCount += 1;
  }
  result.nameBuff = nameBuff; // Store Name Buffer
  result.newNamePointers = namePointers; // Store new name pointers
  result.newbuffCount = buffCount; // Store new Buffer count
  return result;
};

/**
 * @summary Encode DNS Payload
 * @param {Array} section - Contains objects of section entry
 * @param {Object} namePointers - Contains Pointer to Name part
 * @param {Number} buffCount - Keeps count of data buffer bytes 
 * @param {Parser/Encoder} fieldEncoder - Encodes Other Fields
 * @return {Object} result
 * @example (return)
 * { sectionBuff: <Buffer >,
 * newNamePointers:
 *  { '2': 77,
 *    '7': 79,
 *    '168': 81,
 *    '192': 85,
 *    'Cloud9 IDE for beaglebone': 12,
 *    _http: 38,
 *    _tcp: 44,
 *    local: 49,
 *    beaglebone: 60,
 *    'in-addr': 89,
 *    arpa: 97,
 *    'Node-RED for beaglebone': 107 },
 * newbuffCount: 137 }
 */
const encodeDnsPayload = (section, namePointers, buffCount, fieldEncoder) => {
  const result = {}; // Object to be returned
  let sectionBuff = Buffer.alloc(0); // Buffer for Record section
  section.forEach((entry) => { // Loop through all section entries
    const nameBuffResult = getNameBuff(entry.name, namePointers, buffCount); // Encode name
    const nameBuff = nameBuffResult.nameBuff; // Buffer for encoded name
    namePointers = nameBuffResult.newNamePointers; // new name pointer
    buffCount = nameBuffResult.newbuffCount; // new buffer count
    let otherFieldsBuff = fieldEncoder.encode(entry.otherFields); // encode other fields of entry
    buffCount += otherFieldsBuff.length; // increment buffer count
    if (entry.DomainName || entry.Target) { // If Domain name or Target is present
      const nameResult = getNameBuff(entry.DomainName || entry.Target, namePointers, buffCount); // Encode name
      const nameBuff = nameResult.nameBuff;
      namePointers = nameResult.newNamePointers;
      buffCount = nameResult.newbuffCount;
      otherFieldsBuff = Buffer.concat([otherFieldsBuff, nameBuff]); // Concat other fields with the name at end
    }
    const entryBuff = Buffer.concat([nameBuff, otherFieldsBuff]); // Concat name with other fields
    sectionBuff = Buffer.concat([sectionBuff, entryBuff]); // Concat sections
  });
  result.sectionBuff = sectionBuff; // Section buffer
  result.newNamePointers = namePointers; // new name pointers
  result.newbuffCount = buffCount; // new buffer count
  return result;
};

/**
 * @summary Encode mDNS packet
 * @param {Object} mdnsPacket - mDNS packet of format as retured by dnsParse function
 * @return {Buffer}
 */
const encodeMdns = (mdnsPacket) => {
  const headerBuff = dnsHdr.encode(mdnsPacket.Header); // Buffer for mDNS hedaer
  let namePointers = {}; // Stores pointers to Name parts
  let buffCount = headerBuff.length; // Keeps buffer count

  // Encode Question section
  const quesResult = encodeDnsPayload(mdnsPacket.Questions, namePointers, buffCount, mdnsQuesTypeClass);
  const quesBuffer = quesResult.sectionBuff;
  namePointers = quesResult.newNamePointers;
  buffCount = quesResult.newbuffCount;

  // Encode Answers section
  const anResult = encodeDnsPayload(mdnsPacket.AnswerRecords, namePointers, buffCount, dnsResourceRecordParser);
  const anBuffer = anResult.sectionBuff;
  namePointers = anResult.newNamePointers;
  buffCount = anResult.newbuffCount;

  // Encode Name Servers section
  const nsResult = encodeDnsPayload(mdnsPacket.NameServers, namePointers, buffCount, dnsResourceRecordParser);
  const nsBuffer = nsResult.sectionBuff;
  namePointers = nsResult.newNamePointers;
  buffCount = nsResult.newbuffCount;

  // Encode Additional Records section
  const arResult = encodeDnsPayload(mdnsPacket.AdditionalRecords, namePointers, buffCount, dnsResourceRecordParser);
  const arBuffer = arResult.sectionBuff;
  namePointers = arResult.newNamePointers;
  buffCount = arResult.newbuffCount;

  return Buffer.concat([headerBuff, quesBuffer, anBuffer, nsBuffer, arBuffer]);
};

// exports
exports.decodeDNS = dnsParse;
exports.encodeMdns = encodeMdns;