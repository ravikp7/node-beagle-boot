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