const ROMVID = 0x0451;
const ROMPID = 0x6141;
const BOOTPS = 67;
const BOOTPC = 68;
const IPUDP = 17;
const SPLVID = 0x0525;
const SPLPID = 0xA4A2;
const ETHIPP = 0x0800;
const ETHARPP = 0x0806;
const MAXBUF = 450;
const server_hwaddr = [0x9a, 0x1f, 0x85, 0x1c, 0x3d, 0x0e];
const server_ip = [0xc0, 0xa8, 0x01, 0x09];     // 192.168.1.9
const BB_ip = [0xc0, 0xa8, 0x01, 0x03];         // 192.168.1.3
const servername = [66, 69, 65, 71, 76, 69, 66, 79, 79, 84];       // ASCII ['B','E','A','G','L','E','B','O','O','T']
const UMSVID = 0x0451;
const UMSPID = 0xd022;
const UBOOTVID = 0x0525;
const UBOOTPID = 0xa4a5;

// Size of all packets
const rndisSize = 44;
const etherSize = 14;
const arp_Size = 28;
const ipSize = 20;
const udpSize = 8;
const bootpSize = 300;
const tftpSize = 4;
const fullSize = 386;


// Include modules
const usb = require('usb');
const protocols = require('./src/protocols');
const EventEmitter = require('events').EventEmitter;
const emitter = new EventEmitter();
const fs = require('fs');
const path = require('path');
const os = require('os');
const platform = os.platform();
const rndis_win = require('./src/rndis_win');
var inEndpoint, outEndpoint, Data, ether, rndis, eth2, ip, udp, bootreply, increment;
const emitterMod = new EventEmitter();    // Emitter for module status
var percent;    // Percentage for progress
var description;    // Description for current status

// Set usb debug log
//usb.setDebugLevel(4);   

exports.usbMassStorage = function(){
    exports.tftpServer([
        {vid: ROMVID, pid: ROMPID, file_path: path.join(__dirname, 'bin', 'spl')},
        {vid: SPLVID, pid: SPLPID, file_path: path.join(__dirname, 'bin', 'uboot')}
    ]);
};

// Event Emitter for progress
exports.eventEmitter = emitterMod;


// TFTP server for any file transfer
exports.tftpServer = function(transferFiles){

    var foundDevice;
    increment = (100 / (transferFiles.length * 9));
    usb.on('attach', function(device){

        switch(device){
            case usb.findByIds(ROMVID, ROMPID): foundDevice = 'ROM';
            break;

            case usb.findByIds(SPLVID, SPLPID): foundDevice = 'SPL';
            break;

            case usb.findByIds(UBOOTVID, UBOOTPID): foundDevice = 'UBOOT';
            break;

            case usb.findByIds(UMSVID, UMSPID): foundDevice = 'UMS';
            break;

            default: foundDevice = 'Device';
        }

        emitterMod.emit('connect', foundDevice);

        // Transfer files
        transferFiles.forEach(function(entry){

            if(device === usb.findByIds(entry.vid, entry.pid)){ 
                transfer(entry.file_path, device);
            }   
        });
    });

    usb.on('detach', function(device){

        emitterMod.emit('disconnect', foundDevice);
    });
};


// Function for device initialization
function transfer(filePath, device){
    if(device === usb.findByIds(ROMVID, ROMPID)) percent = increment;
    i = 1;          // Keeps count of File Blocks transferred
    blocks = 2;     // Number of blocks of file, assigned greater than i here
    description = path.basename(filePath)+" =>";
    emitterMod.emit('progress', {description: description, complete: +percent.toFixed(2)});
    percent += increment;

    if(path.basename(filePath) != 'spl' && platform != 'linux'){
        device.open(false);
        device.setConfiguration(2, function(err){if(err) console.log(err);});
        device.__open();
        device.__claimInterface(0);
    }

    device.open();
    var interface = device.interface(1);    // Select interface 1 for BULK transfers

    windows = 0;
    if(platform == 'win32') windows = 1; 

    if(!windows){                // Not supported in Windows
        // Detach Kernel Driver
        if(interface.isKernelDriverActive()){
            interface.detachKernelDriver();
        }
    }

    try{
        interface.claim();
    }

    catch(err){
        emitterMod.emit('error', "Can't claim interface " +err);
    }

    description = "Interface claimed";
    emitterMod.emit('progress', {description: description, complete: +percent.toFixed(2)});
    percent += increment;

    // Code to initialize RNDIS device on Windows and OSX
    if(platform != 'linux' && file == 'spl'){
        var intf0 = device.interface(0);    // Select interface 0 for CONTROL transfer
        intf0.claim();

        var CONTROL_BUFFER_SIZE = 1025;  
        var rndis_init_size = 24;
        var rndis_set_size = 28;

        var rndis_buf = Buffer.alloc(CONTROL_BUFFER_SIZE);
        var init_msg = rndis_win.make_rndis_init();
        init_msg.copy(rndis_buf, 0, 0, rndis_init_size);


        // Windows Control Transfer
        // https://msdn.microsoft.com/en-us/library/aa447434.aspx
        // http://www.beyondlogic.org/usbnutshell/usb6.shtml

        var bmRequestType_send = 0x21; // USB_TYPE=CLASS | USB_RECIPIENT=INTERFACE
        var bmRequestType_receive = 0xA1; // USB_DATA=DeviceToHost | USB_TYPE=CLASS | USB_RECIPIENT=INTERFACE

        // Sending rndis_init_msg (SEND_ENCAPSULATED_COMMAND)
        device.controlTransfer(bmRequestType_send, 0, 0, 0, rndis_buf, function(error, data){
            console.log(error);
        });

        // Receive rndis_init_cmplt (GET_ENCAPSULATED_RESPONSE)
        device.controlTransfer(bmRequestType_receive, 0x01, 0, 0, CONTROL_BUFFER_SIZE, function(error, data){
            console.log(data);
        });


        var set_msg = rndis_win.make_rndis_set();
        set_msg.copy(rndis_buf, 0, 0, rndis_set_size+4);

        // Send rndis_set_msg (SEND_ENCAPSULATED_COMMAND)
        device.controlTransfer(bmRequestType_send, 0, 0, 0, rndis_buf, function(error, data){
            console.log(error);
        });

        // Receive rndis_init_cmplt (GET_ENCAPSULATED_RESPONSE)
        device.controlTransfer(bmRequestType_receive, 0x01, 0, 0, CONTROL_BUFFER_SIZE, function(error, data){
            console.log(data);
        });

    }                      

    // Set endpoints for usb transfer
    inEndpoint = interface.endpoint(interface.endpoints[0].address);
    outEndpoint = interface.endpoint(interface.endpoints[1].address);

    // Set endpoint transfer type
    inEndpoint.transferType = usb.LIBUSB_TRANSFER_TYPE_BULK;
    outEndpoint.transferType = usb.LIBUSB_TRANSFER_TYPE_BULK;

    emitter.emit('inTransfer', filePath);
}



// Event for inEnd transfer
emitter.on('inTransfer', function(filePath){

    inEndpoint.transfer(MAXBUF, function(error, data){
        
        if(!error){           
            var request = identifyRequest(data, path.basename(filePath).length);
            
            if(request == 'notIdentified') emitter.emit('inTransfer', filePath);

            else {

                if(request == 'BOOTP') Data = processBOOTP(filePath, data);

                if(request == 'ARP') Data = processARP(data);

                if(request == 'TFTP_Data') Data = processTFTP_Data();
                else{    
                    emitterMod.emit('progress', {description: request + " request received", complete: +percent.toFixed(2)});
                    percent += increment;
                }

                if(request == 'TFTP') {
                    emitterMod.emit('progress', {description: path.basename(filePath)+" transfer starts", complete: +percent.toFixed(2)});
                    percent += increment;

                    emitter.emit('processTFTP', data, filePath);
                }

                else if(i <= blocks+1){     // Transfer until all blocks of file are transferred
                        emitter.emit('outTransfer', filePath, Data, request);
                    }
                    else{
                        emitterMod.emit('progress', {description: path.basename(filePath)+" transfer complete", complete: +percent.toFixed(2)});
                        percent += increment;
                    }
            }
        }

        else {
            emitterMod.emit('error', "ERROR in inTransfer");
            console.log(error);
        }
    });
});


// Event for outEnd Transfer
emitter.on('outTransfer', function(filePath, data, request){

    outEndpoint.transfer(data, function(error){
        
        if(!error){
            if(request == 'BOOTP' || request == 'ARP'){
                emitterMod.emit('progress', {description: request + " reply done", complete: +percent.toFixed(2)});
                percent += increment;
            }

            emitter.emit('inTransfer', filePath);
        }
        else {
            emitterMod.emit('error', "ERROR sending " + request);
            console.log(error);
        }  
    });
    
});


// Function to identify request packet
function identifyRequest(buff, len){
    var val = buff[4];

    if(val == 0xc2 || val == 0x6c) return 'BOOTP';

    if(val == 0x56) return 'ARP';

    if(val == (0x5f + len) || val == (0x76 + len)) return 'TFTP';

    if(val == 0x5a) return 'TFTP_Data';
    console.log(val);
    return 'notIdentified';

}

// Function to process BOOTP request
function processBOOTP(filePath, data){

    var ether_buf = Buffer.alloc(MAXBUF-rndisSize); 

    var udp_buf = Buffer.alloc(udpSize);
                
    var bootp_buf = Buffer.alloc(bootpSize);

    data.copy(udp_buf, 0, rndisSize + etherSize + ipSize, MAXBUF);

    data.copy(bootp_buf, 0, rndisSize + etherSize + ipSize + udpSize, MAXBUF);
        
    data.copy(ether_buf, 0, rndisSize, MAXBUF);

    ether = protocols.decode_ether(ether_buf);      // Gets decoded ether packet data

    var udpUboot = protocols.parse_udp(udp_buf);       // parsed udp header

    var bootp = protocols.parse_bootp(bootp_buf);   // parsed bootp header

    rndis = protocols.make_rndis(fullSize - rndisSize);

    eth2 = protocols.make_ether2(ether.h_source, server_hwaddr, ETHIPP);

    ip = protocols.make_ipv4(server_ip, BB_ip, IPUDP, 0, ipSize + udpSize + bootpSize, 0);

    udp = protocols.make_udp(bootpSize, udpUboot.udpDest, udpUboot.udpSrc);

    bootreply = protocols.make_bootp(servername, path.basename(filePath), bootp.xid, ether.h_source, BB_ip, server_ip);

    buff = Buffer.concat([rndis, eth2, ip, udp, bootreply], fullSize);
    
    return buff;
}

// Function to process ARP request
function processARP(data){

    var arp_buf = Buffer.alloc(arp_Size);

    data.copy(arp_buf, 0, rndisSize + etherSize, rndisSize + etherSize + arp_Size);
        
    receivedARP = protocols.parse_arp(arp_buf);         // Parsed received ARP request

    // ARP response
    var arpResponse = protocols.make_arp(2, server_hwaddr, receivedARP.ip_dest, receivedARP.hw_source, receivedARP.ip_source );

    rndis = protocols.make_rndis(etherSize + arp_Size);

    eth2 = protocols.make_ether2(ether.h_source, server_hwaddr, ETHARPP);

    buff = Buffer.concat([rndis, eth2, arpResponse], rndisSize + etherSize + arp_Size);

    return buff;
}

// Function to process TFTP request
emitter.on('processTFTP', function(data, filePath){

    var udpSPL_buf = Buffer.alloc(udpSize);

    data.copy(udpSPL_buf, 0, rndisSize + etherSize + ipSize, rndisSize + etherSize + ipSize + udpSize);
            
    udpSPL = protocols.parse_udp(udpSPL_buf);           // Received UDP packet for SPL tftp

    fs.readFile(filePath, function(error, file_data){
        if(!error){
            fileData = file_data;
            blocks = Math.ceil(fileData.length/512);         // Total number of blocks of file
            eth2 = protocols.make_ether2(ether.h_source, server_hwaddr, ETHIPP);
            start = 0;
            emitter.emit('outTransfer', filePath, processTFTP_Data(), undefined);
        }
        
        else emitterMod.emit('error', "Error reading "+path.basename(filePath)+" : "+error);
    });

});

// Function to process File data for TFTP
function processTFTP_Data(){

    var blk_size = (i==blocks)? fileData.length - (blocks-1)*512 : 512;  // Different block size for last block

    var blk_data = Buffer.alloc(blk_size);
    fileData.copy(blk_data, 0, start, start + blk_size);                 // Copying data to block
    start += blk_size; 

    rndis = protocols.make_rndis(etherSize + ipSize + udpSize + tftpSize + blk_size);
    ip = protocols.make_ipv4(server_ip, BB_ip, IPUDP, 0, ipSize + udpSize + tftpSize + blk_size, 0);
    udp = protocols.make_udp(tftpSize + blk_size, udpSPL.udpDest, udpSPL.udpSrc);
    tftp = protocols.make_tftp(3, i);
    i++;
    return Buffer.concat([rndis, eth2, ip, udp, tftp, blk_data], rndisSize + etherSize + ipSize + udpSize + tftpSize + blk_size);
}