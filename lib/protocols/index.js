var sp = require('schemapack');             // Serialization module
var bp = require('binary-parser-encoder');          // Binary parser module
var Parser = bp.Parser;
var toggle = require('endian-toggle');
var mDns = require('./dns');
var ip = require('./ip');
var icmp = require('./icmp');
var bootP = require('./bootp');
var tcp = require('./tcp');


///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////// Headers for encoding (Schemapack) //////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////

// rndis header for encoding
var rndis_1 = sp.build([
  { msg_type: 'uint32'},      // always
  { msg_len: 'uint32'},       // length of header + data + payload
  { data_offset: 'uint32'},   // offset from data until payload
  { data_len: 'uint32'},      // length of payload
  { band_offset: 'uint32'},   // not used here
  { pad: 'string'}
]);
var rndis_2 = sp.build([
  { band_len: 'uint32'},      // not used here
  { out_band_elements: 'uint32'}, //not used here
  { packet_offset: 'uint32'},     // not used here
  { packet_info_len: 'uint32'},   // not used here
  { reserved_first: 'uint32'},    // not used here
  { reserved_second: 'uint32'},   // not used here
  { pad: 'string'}
]);

// ether2 header for encoding
var ethhdr_e = sp.build([
  { h_dest:{0:'uint8',1:'uint8',2:'uint8',3:'uint8',4:'uint8',5:'uint8'} },       // Destination address
  { h_source:{0:'uint8',1:'uint8',2:'uint8',3:'uint8',4:'uint8',5:'uint8'} },     // Source address
  { h_proto : 'uint16' },        // Protocol Id
  { pad: 'string' }              // Padding to shift extra bit to last for Schemapack
]);

// ipv4 header in two parts for encoding
var iphdr1 = sp.build([
  { ver_hl: 'uint8'},            // version and header length each of 4 bits
  { tos: 'uint8'},               // Type of service
  { tot_len: 'uint16'},          // Total length of IP datagram
  { id: 'uint16'},               // Identfication
  { frag_off: 'uint16'},         // Flag and Fragment offset
  { ttl: 'uint8'},               // Time to live
  { protocol: 'uint8'},          // Protocol UDP/IP here
  { check: 'uint16'},            // Checksum for IP header
  { pad: 'string'}               // Padding to shift extra bit to last for Schemapack
]);
var iphdr2 = sp.build([
  { saddr: {0:'uint8',1:'uint8',2:'uint8',3:'uint8'} },   // Source IP address (Server)
  { daddr: {0:'uint8',1:'uint8',2:'uint8',3:'uint8'} },   // Destination IP address (BB)
  { pad: 'string'}
]); 

// UDP Packet for encoding
var udp_e = sp.build([
  { udpSrc: 'uint16'},            // Server UDP port
  { udpDst: 'uint16'},            // BB UDP port
  { udpLen: 'uint16'},            // UDP data length + UDP header length
  { chkSum: 'uint16'},            // Checksum
  { pad: 'string'}
]);

// BOOTP packet 
var bootp1 = sp.build([
  { opcode: 'uint8'},             // Operation code, 1: BOOTREQUEST, 2: BOOTREPLY
  { hw: 'uint8'},                 // Hardware Type, 1: Ethernet
  { hw_length: 'uint8'},          // Hardware Address length
  { hopcount: 'uint8'},           // Set to 0 by client before transmitting
  { xid: 'uint32'},               // Transaction ID
  { secs: 'uint16'},              // Seconds since client started trying to boot
  { flags: 'uint16'},             // Optional flag, not used 
  { ciaddr: {0:'uint8', 1:'uint8', 2:'uint8', 3:'uint8'}},    // Client IP Address
  { pad: 'string'}
]);
var bootp2 = sp.build([
  { yiaddr: {0:'uint8', 1:'uint8', 2:'uint8', 3:'uint8'}},        // Your IP Address ( Server assigns to client )
  { server_ip: {0:'uint8', 1:'uint8', 2:'uint8', 3:'uint8'}},     // Server IP Address
  { bootp_gw_ip: {0:'uint8', 1:'uint8', 2:'uint8', 3:'uint8'}},   // Gateway IP Address
  { hwaddr: {0:'uint8', 1:'uint8', 2:'uint8', 3:'uint8', 4:'uint8', 5:'uint8'}},  // MAC Address of client (BB)
  { pad: 'string'}
]);
var bootp_servername = sp.build([
  { servername: {0:'uint8', 1:'uint8', 2:'uint8', 3:'uint8', 4:'uint8', 5:'uint8', 6:'uint8', 7:'uint8',
        8:'uint8', 9:'uint8',}},                                    // Server Name
  { pad: 'string'}
]);
var bootp_bootfile = sp.build([ // Name of File (max 72 char here) to boot, splitted in 8 parts as max object size supported is 9
  { bootfile1: {0:'uint8', 1:'uint8', 2:'uint8', 3:'uint8', 4:'uint8', 5:'uint8', 6:'uint8', 7:'uint8', 8:'uint8'}},   
  { bootfile2: {0:'uint8', 1:'uint8', 2:'uint8', 3:'uint8', 4:'uint8', 5:'uint8', 6:'uint8', 7:'uint8', 8:'uint8'}},
  { bootfile3: {0:'uint8', 1:'uint8', 2:'uint8', 3:'uint8', 4:'uint8', 5:'uint8', 6:'uint8', 7:'uint8', 8:'uint8'}},
  { bootfile4: {0:'uint8', 1:'uint8', 2:'uint8', 3:'uint8', 4:'uint8', 5:'uint8', 6:'uint8', 7:'uint8', 8:'uint8'}},
  { bootfile5: {0:'uint8', 1:'uint8', 2:'uint8', 3:'uint8', 4:'uint8', 5:'uint8', 6:'uint8', 7:'uint8', 8:'uint8'}},
  { bootfile6: {0:'uint8', 1:'uint8', 2:'uint8', 3:'uint8', 4:'uint8', 5:'uint8', 6:'uint8', 7:'uint8', 8:'uint8'}},
  { bootfile7: {0:'uint8', 1:'uint8', 2:'uint8', 3:'uint8', 4:'uint8', 5:'uint8', 6:'uint8', 7:'uint8', 8:'uint8'}},
  { bootfile8: {0:'uint8', 1:'uint8', 2:'uint8', 3:'uint8', 4:'uint8', 5:'uint8', 6:'uint8', 7:'uint8', 8:'uint8'}},
  { pad: 'string'}
]);
// Max array size supported is 9, splitting vendor field in two parts
var bootp_vendor1 = sp.build([       // Vendor extensions (4 Byte MAGIC COOKIE and DHCP OPTIONS)
  { vendor1: {0:'uint8', 1:'uint8', 2:'uint8', 3:'uint8', 4:'uint8', 5:'uint8', 6:'uint8', 7:'uint8', 8:'uint8'}},
  { pad: 'string'}
]);
var bootp_vendor2 = sp.build([       
  { vendor2: {0:'uint8', 1:'uint8', 2:'uint8', 3:'uint8', 4:'uint8', 5:'uint8', 6:'uint8', 7:'uint8', 8:'uint8'}},
  { pad: 'string'}
]);
var bootp_vendor3 = sp.build([       
  { vendor3: {0:'uint8', 1:'uint8', 2:'uint8', 3:'uint8', 4:'uint8', 5:'uint8', 6:'uint8', 7:'uint8', 8:'uint8'}}, 
  { pad: 'string'}
]);
var bootp_vendor4 = sp.build([       
  { vendor4: {0:'uint8', 1:'uint8', 2:'uint8', 3:'uint8', 4:'uint8'}}, 
  { pad: 'string'}
]);


// ARP header for response
var arphdr_e = sp.build([
  { htype: 'uint16'},                     // Hardware type
  { ptype: 'uint16'},                     // Protocol type
  { hlen: 'uint8'},                       // Hardware Address length
  { plen: 'uint8'},                       // Protocol Address length
  { opcode: 'uint16'},                    // Operation code, here 2 for reply
  { hw_source: { 0:'uint8', 1:'uint8', 2:'uint8', 3:'uint8', 4:'uint8', 5:'uint8'}},      // Source MAC address
  { ip_source: { 0:'uint8', 1:'uint8', 2:'uint8', 3:'uint8'}},                            // Source IP address
  { hw_dest: { 0:'uint8', 1:'uint8', 2:'uint8', 3:'uint8', 4:'uint8', 5:'uint8'}},        // Destination MAC address
  { ip_dest: { 0:'uint8', 1:'uint8', 2:'uint8', 3:'uint8'}},                              // Destination IP address
  { pad: 'string'}
]);


// TFTP packet --- this is only for ACK packets
var tftp = sp.build([
  { opcode: 'uint16'},                    // Operation code, here 3 for read/write next block of data
  { blk_number: 'uint16'},                // Block number
  { pad: 'string'}
]);


// TFTP ERROR packet
var tftp_error = sp.build([
  { opcode: 'uint16'},
  { err_code: 'uint16'},
  { err_mesg: 'string'},
  { pad: 'string'}
]);

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////// Headers for parsing (Binary-Praser) /////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////

// ether header
var ethhdr = new Parser()
  .array('h_dest',{
        type: 'uint8',
        length: 6
  })
  .array('h_source',{
        type: 'uint8',
        length: 6
  })
  .uint16be('h_proto'); 

// ARP header
var arphdr = new Parser()
  .uint16be('htype')
  .uint16be('ptype')
  .uint8('hlen')
  .uint8('plen')
  .uint16be('opcode')
  .array('hw_source',{
        type: 'uint8',
        length: 6
  })
  .array('ip_source',{
        type: 'uint8',
        length: 4
  })
  .array('hw_dest',{
        type: 'uint8',
        length: 6
  })
  .array('ip_dest',{
        type: 'uint8',
        length: 4
  });

// UDP packet
var udp = new Parser()
  .uint16be('udpSrc')
  .uint16be('udpDest')
  .uint16be('udpLen')
  .uint16be('chkSum');

// BOOTP packet
var bootp = new Parser()
  .uint8('opcode')
  .uint8('hw')
  .uint8('hwlength')
  .uint8('hopcount')
  .uint32be('xid')
  .uint16be('secs')
  .uint16be('flags')
  .array('ciaddr',{
        type: 'uint8',
        length: 4
  })
  .array('yiaddr',{
        type: 'uint8',
        length: 4
  })
  .array('server_ip',{
        type: 'uint8',
        length: 4
  })
  .array('bootp_gw_ip',{
        type: 'uint8',
        length: 4
  })
  .array('hwaddr',{
        type: 'uint8',
        length: 16
  })
  .array('servername',{
        type: 'uint8',
        length: 64
  })
  .array('bootfile',{
        type: 'uint8',
        length: 128
  })
  .array('vendor',{
        type: 'uint8',
        length: 64
  });


///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////// Packet make functions /////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////

// Function for rndis data packet
function make_rndis(data_length){
  var rndis1 = [
    { msg_type: 0x00000001},
    { msg_len: data_length+44},
    { data_offset: 0x24},
    { data_len: data_length},
    { band_offset: 0}
  ];
  var rndis2 =[
    { band_len: 0},
    { out_band_elements: 0},
    { packet_offset: 0},
    { packet_info_len: 0},
    { reserved_first: 0},
    { reserved_second: 0}
  ];

  var buf1 = fix_buff(rndis_1.encode(rndis1));
  var buf2 = fix_buff(rndis_2.encode(rndis2));
  var data = Buffer.concat([buf1, buf2], 44);
  return toggle(data, 32);    // convert byte order to little endian
}


// Function for ether2 data packet
function make_ether2(dest, source, proto){
  var eth = [
    { h_dest: dest},
    { h_source: source},
    { h_proto: proto}
  ];
  var data = fix_buff(ethhdr_e.encode(eth));
  return data;
}


// Function for ipv4 header packet
function make_ipv4(src_addr, dst_addr, proto, id_, total_len, chksum){
  var ip1 = [
    { ver_hl: 69},
    { tos: 0},
    { tot_len: total_len},
    { id: id_},
    { frag_off: 0},
    { ttl: 64},
    { protocol: proto},
    { check: chksum}
  ];
  var ip2 = [
    { saddr: src_addr},
    { daddr: dst_addr}
  ];
  var buf1 = fix_buff(iphdr1.encode(ip1));
  var buf2 = fix_buff(iphdr2.encode(ip2));
  var data = Buffer.concat([buf1, buf2], 20);

  // Calculating Checksum and adding it in packet
  if (!chksum){
    var ip = new Parser()           // Parsing packet data as array of 2 byte words
      .array('data', {
            type: 'uint16be',
            length: 10
      });
    var ip_packet = ip.parse(data);
    // Checksum calculation
    var i = 0;
    var sum = 0;
    while (i<10){
      sum += ip_packet.data[i++];
      var a = sum.toString(16);
      if (a.length > 4){
        sum = parseInt(a[1]+a[2]+a[3]+a[4], 16) + 1; 
      }
    }
    a = (~sum >>> 0).toString(16);          // Invert bitwise and unsign the number
    sum = parseInt(a[4]+a[5]+a[6]+a[7], 16);    // Taking 2 bytes out of the inverted bytes
    data = make_ipv4(src_addr, dst_addr, proto, id_, total_len, sum);   // Making packet again with checksum
  }

  return data;
}


// Function for UDP packet
function make_udp(udpData_len, srcPort, dstPort){
  var udp = [
    { udpSrc: srcPort},         
    { udpDst: dstPort},         
    { udpLen: udpData_len+8},       
    { chkSum: 0}                
  ];
  return fix_buff(udp_e.encode(udp));
}


// Function for BOOTP packet
function make_bootp(server_name, file_name, xid_, hw_dest, BB_ip, serverIP){
  var bootp_1 =[
    { opcode: 2},
    { hw: 1},
    { hw_length: 6},
    { hopcount: 0},
    { xid: xid_},
    { secs: 0},
    { flags: 0},
    { ciaddr: [0,0,0,0]}
  ];
  var bootp_2 = [
    { yiaddr: BB_ip},
    { server_ip: serverIP},
    { bootp_gw_ip: serverIP},
    { hwaddr: hw_dest}
  ];
  var servername = [ { servername: server_name} ];
  var filename = stringToAscii(file_name);
  var bootfile = [ 
    { bootfile1: filename.slice(0,9)}, 
    { bootfile2: filename.slice(9,18)}, 
    { bootfile3: filename.slice(18,27)},
    { bootfile4: filename.slice(27,36)},
    { bootfile5: filename.slice(36,45)},
    { bootfile6: filename.slice(45,54)},
    { bootfile7: filename.slice(54,63)},
    { bootfile8: filename.slice(63,72)},
  ];
  var vendor1 = [ { vendor1: [ 99, 130, 83, 99, 53, 1, 5, 1, 4] } ];  // 4 Byte MAGIC COOKIE and DHCP OPTIONS
  var vendor2 = [ { vendor2: [ 225, 255, 255, 0, 3, 4, 192, 168, 1] } ];
  var vendor3 = [ { vendor3: [ 9, 51, 4, 255, 255, 255, 255, 54, 4]}];
  var vendor4 = [ { vendor4: [192, 168, 1, 9, 0xFF]}];
  var buf1 = fix_buff(bootp1.encode(bootp_1));
  var buf2 = fix_buff(bootp2.encode(bootp_2));
  var buf2_ = Buffer.alloc(10);           // Remaining 10 bytes out of 16 of hwaddr
  var buf3 = fix_buff(bootp_servername.encode(servername));
  var buf3_ = Buffer.alloc(54);           // Remaining 54 bytes out of 64 of servername
  var buf4 = fix_buff(bootp_bootfile.encode(bootfile));
  var buf4_ = Buffer.alloc(56);          // Remaining 56 bytes out of 128 of bootfile
  var buf5 = fix_buff(bootp_vendor1.encode(vendor1));
  var buf5a = fix_buff(bootp_vendor2.encode(vendor2));
  var buf5b = fix_buff(bootp_vendor3.encode(vendor3));
  var buf5c = fix_buff(bootp_vendor4.encode(vendor4));
  var buf5d = Buffer.alloc(32);           // Remaining 32 bytes out of 64 of vendor
  return Buffer.concat([buf1, buf2, buf2_, buf3, buf3_, buf4, buf4_, buf5, buf5a, buf5b, buf5c, buf5d], 300);

}

function stringToAscii(filename){
  var x = 0;
  var file_name = [];
  while(x <= 72){
    x = file_name.push((x < filename.length)? filename.charCodeAt(x): 0);
  }
  return file_name;
}

// Function for ARP response
function make_arp(opcode, hw_source, ip_source, hw_dest, ip_dest){
  var arp = [
    { htype: 1},
    { ptype: 0x0800},
    { hlen: 6},
    { plen: 4},
    { opcode: opcode},
    { hw_source: hw_source},
    { ip_source: ip_source},
    { hw_dest: hw_dest},
    { ip_dest: ip_dest}
  ];
  return fix_buff(arphdr_e.encode(arp));
} 


// Function for TFTP packet --- this is only for ACK packets
function make_tftp(opcode, blk_number){
  var tftp_data = [
    { opcode: opcode},
    { blk_number: blk_number}
  ];
  return fix_buff(tftp.encode(tftp_data));
}

// Function for TFTP error packet
function make_tftp_error(opcode, err_code, desc){
  var my_tftp_error = [
    { opcode: 5 },
    { err_code: err_code },
    { err_msg: desc },
  ];
  return fix_buff(tftp_error.encode(my_tftp_error));
}

function encodeEther(packet) {
  return ethhdr.encode(packet);
}


///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////// Packet decode functions ///////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////

// Decode ether packet
function decode_ether(buf){
  return ethhdr.parse(buf);
}

// Parse ARP header
function parse_arp(buf){
  return arphdr.parse(buf);
}

// Parse udp packet
function parse_udp(buf){
  return udp.parse(buf);
}

// Parse bootp packet
function parse_bootp(buf){
  return bootp.parse(buf);
}


///////////////////////////////////////// Function to remove extra byte from last /////////////////////////////////
function fix_buff(buf){
  var buf_fix = Buffer.alloc(buf.length-1,0,'hex');
  buf.copy(buf_fix, 0, 0, buf.length-1);
  return buf_fix;
}


exports.make_rndis = make_rndis;
exports.decode_ether = decode_ether;
exports.make_ether2 = make_ether2;
exports.make_ipv4 = make_ipv4;
exports.make_udp = make_udp;
exports.make_bootp = make_bootp;
exports.parse_arp = parse_arp;
exports.make_arp = make_arp;
exports.parse_udp = parse_udp;
exports.make_tftp = make_tftp;
exports.make_tftp_error = make_tftp_error;
exports.parse_bootp = parse_bootp;
exports.parse_dns = mDns.decodeDNS;
exports.parseIpv6 = ip.parseIpv6;
exports.parseIpv4 = ip.parseIpv4;
exports.parseIcmp = icmp.parseIcmp;
exports.encodeIpv4 = ip.encodeIpv4;
exports.encodeEther = encodeEther;
exports.encodeBootp = bootP.encodeBootp;
exports.parseBootp = bootP.parseBootp;
exports.encodeIpv6 = ip.encodeIpv6;
exports.parseIpv6Option = ip.parseIpv6Option;
exports.encodeIcmp = icmp.encodeIcmp;
exports.encodeMdns = mDns.encodeMdns;
exports.regenerateTcpChecksum = tcp.regenerateTcpChecksum;
