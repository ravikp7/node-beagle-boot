var sp = require('schemapack');


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



///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////// packet make functions /////////////////////////////////////////////////
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

exports.make_rndis = make_rndis;
