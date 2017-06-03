var sp = require('schemapack');             // Serialization module
var bp = require('binary-parser');          // Binary parser module
var Parser = bp.Parser;


///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////// Headers for encoding (Schemapack) //////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////

// rndis header for encoding
var rndis_e = sp.build({
    msg_type: 'uint32',      // always
    msg_len: 'uint32',       // length of header + data + payload
    data_offset: 'uint32',   // offset from data until payload
    data_len: 'uint32',      // length of payload
    band_offset: 'uint32',   // not used here
    band_len: 'uint32',      // not used here
    out_band_elements: 'uint32', //not used here
    packet_offset: 'uint32',     // not used here
    packet_info_len: 'uint32',   // not used here
    reserved_first: 'uint32',    // not used here
    reserved_second: 'uint32'   // not used here
    });

// ether2 header for encoding
var ethhdr_e = sp.build([
    { h_dest:{0:'uint8',1:'uint8',2:'uint8',3:'uint8',4:'uint8',5:'uint8'} },       // Destination address
    { h_source:{0:'uint8',1:'uint8',2:'uint8',3:'uint8',4:'uint8',5:'uint8'} },     // Source address
    { h_proto : 'uint16' },        // Protocol Id
    { pad: 'string' }              // Padding to shift extra bit to last for Schemapack
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
    .int16be('h_proto'); 






///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////// Packet make functions /////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////

// Function for rndis data packet
function make_rndis(data_length){
    var rndis = {
        msg_type: 0x00000001,
        msg_len: data_length+44,
        data_offset: 0x24,
        data_len: data_length,
        band_offset: 0,
        band_len: 0,
        out_band_elements: 0,
        packet_offset: 0,
        packet_info_len: 0,
        reserved_first: 0,
        reserved_second: 0
    };

    var buf = rndis_e.encode(rndis);
    return buf;
}


// Function for ether2 data packet
function make_ether2(dest, source){
    var eth = [
        { h_dest: dest},
        { h_source: source},
        { h_proto: 0x0008}
    ];
    var buf = ethhdr_e.encode(eth);
    var data = Buffer.alloc(buf.length-1,0,'hex');
    buf.copy(data, 0, 0, buf.length-1);
    return data;
}





///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////// Packet decode functions ///////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////

// Decode ether packet
function decode_ether(buf){
    return ethhdr.parse(buf);
}



exports.make_rndis = make_rndis;
exports.decode_ether = decode_ether;
exports.make_ether2 = make_ether2;
