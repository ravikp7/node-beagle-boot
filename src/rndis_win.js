var sp = require('schemapack');             // Serialization module
var bp = require('binary-parser');          // Binary parser module
var Parser = bp.Parser;
var toggle = require('endian-toggle');      


///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////// Headers for encoding (Schemapack) //////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////

// RNDIS Initialize Header (https://msdn.microsoft.com/en-us/library/ms919811.aspx)
var rndis_init_hdr = sp.build([
    { msg_type: 'uint32'},  
    { msg_len: 'uint32'},    
    { request_id: 'uint32'},  
    { major_version: 'uint32'},     
    { minor_version: 'uint32'},   
    { max_transfer_size: 'uint32'},
    { pad: 'string'}    // For schemapack encoding fix
]);


// RNDIS Set Header (https://msdn.microsoft.com/en-us/library/ms919826.aspx)
var rndis_set_hdr = sp.build([
    { msg_type: 'uint32'},  
    { msg_len: 'uint32'},    
    { request_id: 'uint32'},  
    { oid: 'uint32'},     
    { len: 'uint32'},   
    { offset: 'uint32'},
    { reserved: 'uint32'},
    { pad: 'string'}
]);




///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////// Packet make functions /////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////

// Function for rndis_init_msg packet
function make_rndis_init(){
    var rndis_init = [
        { msg_type: 2},
        { msg_len: 24},
        { request_id: 1},
        { major_version: 1},
        { minor_version: 1},
        { max_transfer_size: 64}
    ];

    var data = fix_buff(rndis_init_hdr.encode(rndis_init));
    return toggle(data, 32);    // convert byte order to little endian
}



///////////////////////////////////////// Function to remove extra byte from last /////////////////////////////////
function fix_buff(buf){
    var buf_fix = Buffer.alloc(buf.length-1,0,'hex');
    buf.copy(buf_fix, 0, 0, buf.length-1);
    return buf_fix;
}




exports.make_rndis_init = make_rndis_init;