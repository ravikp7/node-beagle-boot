const ROMVID = 0x0451;
const ROMPID = 0x6141;
const BOOTPS = 67;
const BOOTPC = 68;
const IPUDP = 17;
const SPLVID = 0x0451;
const SPLPID = 0xd022;
const ETHIPP = 0x0800;
const ETHARPP = 0x0806;
const MAXBUF = 450;
const server_hwaddr = [0x9a, 0x1f, 0x85, 0x1c, 0x3d, 0x0e];
const server_ip = [0xc0, 0xa8, 0x01, 0x09];     // 192.168.1.9
const BB_ip = [0xc0, 0xa8, 0x01, 0x03];         // 192.168.1.3
const servername = [66, 69, 65, 71, 76, 69, 66, 79, 79, 84];       // ASCII ['B','E','A','G','L','E','B','O','O','T']

// Size of all protocol headers
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
const emitterMod = new EventEmitter();    // Emitter for module status

var progress = {
	percent: 0,   // Percentage for progress
	increment: 5
};

// Set usb debug log
//usb.setDebugLevel(4);   

// TFTP server for USB Mass Storage, binaries must be placed in 'bin/'
exports.usbMassStorage = function(){
    return exports.tftpServer([
        {vid: ROMVID, pid: ROMPID, bootpFile: 'u-boot-spl.bin'},
        {vid: SPLVID, pid: SPLPID, bootpFile: 'u-boot.img'}
    ]);
};


// TFTP server for any file transfer
exports.tftpServer = function(serverConfigs){

    var foundDevice;
    progress.increment = (100 / (serverConfigs.length * 10));
    usb.on('attach', function(device){

        switch(device){
            case usb.findByIds(ROMVID, ROMPID): foundDevice = 'ROM';
            break;

            case usb.findByIds(SPLVID, SPLPID): {
                foundDevice = (device.deviceDescriptor.bNumConfigurations == 2)? 'SPL': 'UMS';}
            break;

            case usb.findByIds(UMSVID, UMSPID): foundDevice = 'UMS';
            break;

            default: foundDevice = 'Device '+device.deviceDescriptor;
        }

        emitterMod.emit('connect', foundDevice);

        // Setup BOOTP/ARP/TFTP servers
        serverConfigs.forEach(function(server){
            if(device === usb.findByIds(server.vid, server.pid) && foundDevice != 'UMS'){ 
                server.device = device;
                server.foundDevice = foundDevice;
                var timeout = (foundDevice == 'ROM')? 0: 500;
                setTimeout(()=>{transfer(server);}, timeout);
            }   
        });
    });

    usb.on('detach', function(device){
        emitterMod.emit('disconnect', foundDevice);
    });

    return emitterMod;  // Event Emitter for progress
};


// Function for device initialization
function transfer(server){
    if(server.foundDevice == 'ROM') progress.percent = progress.increment;
    updateProgress(server.foundDevice +" =>");

    if(server.foundDevice == 'SPL' && platform != 'linux'){
        server.device.open(false);
        server.device.setConfiguration(2, function(err){if(err) emitterMod.emit('error', "Can't set configuration " +err);});
        server.device.__open();
        server.device.__claimInterface(0);
    }

    try{
        server.device.open();
        var interface = server.device.interface(1);    // Select interface 1 for BULK transfers

        if(platform != 'win32'){                // Not supported in Windows
            // Detach Kernel Driver
            if(interface && interface.isKernelDriverActive()){
                interface.detachKernelDriver();
            }
        }

        interface.claim();
    }
    catch(err){
        emitterMod.emit('error', "Can't claim interface " +err);
	return;
    }

    updateProgress("Interface claimed");

    // Code to initialize RNDIS device on Windows and OSX
    if(platform != 'linux' && server.foundDevice == 'ROM'){
        var intf0 = server.device.interface(0);    // Select interface 0 for CONTROL transfer
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
        server.device.controlTransfer(bmRequestType_send, 0, 0, 0, rndis_buf, function(error, data){
            // This error doesn't affect the functionality, so ignoring
            //if(error) emitterMod.emit('error', "Control transfer error on SEND_ENCAPSULATED " +error);
        });

        // Receive rndis_init_cmplt (GET_ENCAPSULATED_RESPONSE)
        server.device.controlTransfer(bmRequestType_receive, 0x01, 0, 0, CONTROL_BUFFER_SIZE, function(error, data){
            if(error) emitterMod.emit('error', "Control transfer error on GET_ENCAPSULATED " +error);
        });


        var set_msg = rndis_win.make_rndis_set();
        set_msg.copy(rndis_buf, 0, 0, rndis_set_size+4);

        // Send rndis_set_msg (SEND_ENCAPSULATED_COMMAND)
        server.device.controlTransfer(bmRequestType_send, 0, 0, 0, rndis_buf, function(error, data){
            // This error doesn't affect the functionality, so ignoring
            //if(error) emitterMod.emit('error', "Control transfer error on SEND_ENCAPSULATED " +error);
        });

        // Receive rndis_init_cmplt (GET_ENCAPSULATED_RESPONSE)
        server.device.controlTransfer(bmRequestType_receive, 0x01, 0, 0, CONTROL_BUFFER_SIZE, function(error, data){
            if(error) emitterMod.emit('error', "Control transfer error on GET_ENCAPSULATED " +error);
        });

    }                      

    // Set endpoints for usb transfer
    server.inEndpoint = interface.endpoint(interface.endpoints[0].address);
    server.outEndpoint = interface.endpoint(interface.endpoints[1].address);

    // Set endpoint transfer type
    server.inEndpoint.transferType = usb.LIBUSB_TRANSFER_TYPE_BULK;
    server.outEndpoint.transferType = usb.LIBUSB_TRANSFER_TYPE_BULK;

    emitter.emit('inTransfer', server);
}



// Event for inEnd transfer
emitter.on('inTransfer', function(server){

    server.inEndpoint.transfer(MAXBUF, function(error, data){
        if(!error){
            var request = identifyRequest(data);

            if(request == 'notIdentified') emitter.emit('inTransfer', server);

            else {

                if(request != 'TFTP_Data') updateProgress(request + " request received");
                
                if(request == 'TFTP') emitter.emit('processTFTP', server, data);
                else{
                    switch(request){
                        case 'BOOTP': emitter.emit('outTransfer', server, processBOOTP(server, data), request);
                        break;
    
                        case 'ARP': emitter.emit('outTransfer', server, processARP(server, data), request);
                        break;
    
                        case 'TFTP_Data': {
                            if(server.tftp.i <= server.tftp.blocks){     // Transfer until all blocks of file are transferred
                                emitter.emit('outTransfer', server, processTFTP_Data(server, data), request);
                            }
                            else{
                                updateProgress(server.foundDevice+" TFTP transfer complete");
                            }
                        }
                        break;
                    }
                }
            }
        }

        else {
            emitterMod.emit('error', "ERROR in inTransfer");
        }
    });
});


// Event for outEnd Transfer
emitter.on('outTransfer', function(server, data, request){

    server.outEndpoint.transfer(data, function(error){
        
        if(!error){
            if(request == 'BOOTP' || request == 'ARP'){
		updateProgress(request + " reply done");
            }

            emitter.emit('inTransfer', server);
        }
        else {
            emitterMod.emit('error', "ERROR sending " + request);
        }  
    });
    
});


// Function to identify request packet
function identifyRequest(buff){

    // Checking Ether Type

    if (buff[rndisSize + 12] == 0x08 && buff[rndisSize + 13] == 0x06) return 'ARP';      // 0x0806 for ARP

    if (buff[rndisSize + 12] == 0x08 && buff[rndisSize + 13] == 0x00)                    // 0x0800 for IPv4
    {
        // Checking IPv4 protocol for UDP
        if (buff[rndisSize + etherSize + 9] == IPUDP){                                   // 0x11 for UDP in IPv4
            
            // UDP, So now checking for BOOTP or TFTP ports
            var port = rndisSize + etherSize + ipSize;
            
            if (buff[port+1] == BOOTPC && buff[port+3] == BOOTPS) return 'BOOTP';        // Port 68: BOOTP Client, Port 67: BOOTP Server

            if (buff[port+3] == 69){                                                     // Port 69: TFTP
                
                // Handling TFTP requests
                var opcode = buff[rndisSize + etherSize + ipSize + udpSize + 1];

                if (opcode == 1) return 'TFTP';                                          // Opcode = 1 for Read Request (RRQ)
                if (opcode == 4) return 'TFTP_Data';                                     // Opcode = 4 for Acknowledgement (ACK)

            }
        }
        
    }
    
    return 'notIdentified';

}

// Function to process BOOTP request
function processBOOTP(server, data){

    var ether_buf = Buffer.alloc(MAXBUF-rndisSize); 

    var udp_buf = Buffer.alloc(udpSize);
                
    var bootp_buf = Buffer.alloc(bootpSize);

    data.copy(udp_buf, 0, rndisSize + etherSize + ipSize, MAXBUF);

    data.copy(bootp_buf, 0, rndisSize + etherSize + ipSize + udpSize, MAXBUF);
        
    data.copy(ether_buf, 0, rndisSize, MAXBUF);

    server.ether = protocols.decode_ether(ether_buf);      // Gets decoded ether packet data

    var udpUboot = protocols.parse_udp(udp_buf);       // parsed udp header

    var bootp = protocols.parse_bootp(bootp_buf);   // parsed bootp header

    var rndis = protocols.make_rndis(fullSize - rndisSize);

    var eth2 = protocols.make_ether2(server.ether.h_source, server_hwaddr, ETHIPP);

    var ip = protocols.make_ipv4(server_ip, BB_ip, IPUDP, 0, ipSize + udpSize + bootpSize, 0);

    var udp = protocols.make_udp(bootpSize, udpUboot.udpDest, udpUboot.udpSrc);

    var bootreply = protocols.make_bootp(servername, server.bootpFile, bootp.xid, server.ether.h_source, BB_ip, server_ip);

    return Buffer.concat([rndis, eth2, ip, udp, bootreply], fullSize);
}

// Function to process ARP request
function processARP(server, data){

    var arp_buf = Buffer.alloc(arp_Size);

    data.copy(arp_buf, 0, rndisSize + etherSize, rndisSize + etherSize + arp_Size);
        
    server.receivedARP = protocols.parse_arp(arp_buf);         // Parsed received ARP request

    // ARP response
    var arpResponse = protocols.make_arp(2, server_hwaddr, server.receivedARP.ip_dest, server.receivedARP.hw_source, server.receivedARP.ip_source );

    var rndis = protocols.make_rndis(etherSize + arp_Size);

    var eth2 = protocols.make_ether2(server.ether.h_source, server_hwaddr, ETHARPP);

    return Buffer.concat([rndis, eth2, arpResponse], rndisSize + etherSize + arp_Size);
}

// Function to process TFTP request
emitter.on('processTFTP', function(server, data){

    var udpTFTP_buf = Buffer.alloc(udpSize);

    data.copy(udpTFTP_buf, 0, rndisSize + etherSize + ipSize, rndisSize + etherSize + ipSize + udpSize);
            
    server.tftp = {};                                                                       // Object containing TFTP parameters
    server.tftp.i = 1;                                                                      // Keeps count of File Blocks transferred
    server.tftp.receivedUdp = protocols.parse_udp(udpTFTP_buf);                             // Received UDP packet for SPL tftp
    server.tftp.eth2 = protocols.make_ether2(server.ether.h_source, server_hwaddr, ETHIPP); // Making ether header here, as it remains same for all tftp block transfers
    var fileName = extractName(data);
    server.filePath = path.join('bin', fileName);

    updateProgress(fileName+" transfer starts");

    fs.readFile(server.filePath, function(error, file_data){
        if(!error){
            server.tftp.blocks = Math.ceil((file_data.length+1)/512);         // Total number of blocks of file
            server.tftp.start = 0;
            server.tftp.fileData = file_data;
            emitter.emit('outTransfer', server, processTFTP_Data(server, data), 'TFTP');
        }
        else{
            emitter.emit('outTransfer', server, processTFTP_Error(server, data), 'TFTP');
	    emitterMod.emit('error', "Error reading "+server.filePath+" : "+error);
	}
    });

});

// Function to process File data for TFTP
function processTFTP_Data(server, data){

    var blockSize = server.tftp.fileData.length - server.tftp.start;
    if(blockSize > 512) blockSize = 512;

    var blockData = Buffer.alloc(blockSize);
    server.tftp.fileData.copy(blockData, 0, server.tftp.start, server.tftp.start + blockSize);                            // Copying data to block
    server.tftp.start += blockSize;                                                                                       // Keep counts of bytes transferred upto

    var rndis = protocols.make_rndis(etherSize + ipSize + udpSize + tftpSize + blockSize);
    var ip = protocols.make_ipv4(server.receivedARP.ip_dest, server.receivedARP.ip_source, IPUDP, 0, ipSize + udpSize + tftpSize + blockSize, 0);
    var udp = protocols.make_udp(tftpSize + blockSize, server.tftp.receivedUdp.udpDest, server.tftp.receivedUdp.udpSrc);
    var tftp = protocols.make_tftp(3, server.tftp.i);
    server.tftp.i++;
    return Buffer.concat([rndis, server.tftp.eth2, ip, udp, tftp, blockData], rndisSize + etherSize + ipSize + udpSize + tftpSize + blockSize);
}

function processTFTP_Error(server, data){
    var error_msg = "File not found";
    var rndis = protocols.make_rndis(etherSize + ipSize + udpSize + tftpSize + error_msg.length + 1);
    var ip = protocols.make_ipv4(server.receivedARP.ip_dest, server.receivedARP.ip_source, IPUDP, 0, ipSize + udpSize + tftpSize + error_msg.length + 1, 0);
    var udp = protocols.make_udp(tftpSize + error_msg.length + 1, server.tftp.receivedUdp.udpDest, server.tftp.receivedUdp.udpSrc);
    var tftp = protocols.make_tftp(5, 1, error_msg);
    return Buffer.concat([rndis, server.tftp.eth2, ip, udp, tftp], rndisSize + etherSize + ipSize + udpSize + tftpSize + error_msg.length + 1);
}

// Function for progress update
function updateProgress(description){
    emitterMod.emit('progress', {description: description, complete: +progress.percent.toFixed(2)});

    if(progress.percent <= 100) {
        progress.percent += progress.increment;
    }
}

// Function to extract FileName from TFTP packet
function extractName(data){
        
    var fv = rndisSize + etherSize + ipSize + udpSize + 2;  
    var nameCount = 0;
    var name = '';
     while (data[fv + nameCount] != 0){
        name += String.fromCharCode(data[fv + nameCount]);
        nameCount++;
    }
    return name;
}
